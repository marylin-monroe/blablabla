// src/services/SolanaMonitor.ts - С ДЕТЕКТОРОМ АГРЕГАЦИИ ПОЗИЦИЙ
import { Database } from './Database';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';
import { TokenSwap, WalletInfo } from '../types';

// 🎯 ИНТЕРФЕЙСЫ ДЛЯ АГРЕГАЦИИ ПОЗИЦИЙ
interface PositionPurchase {
  transactionId: string;
  amountUSD: number;
  tokenAmount: number;
  price: number;
  timestamp: Date;
}

interface AggregatedPosition {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  
  // Покупки
  purchases: PositionPurchase[];
  totalUSD: number;
  totalTokens: number;
  avgPrice: number;
  purchaseCount: number;
  
  // Временные рамки
  firstBuyTime: Date;
  lastBuyTime: Date;
  timeWindowMinutes: number;
  
  // Метрики разбивки
  avgPurchaseSize: number;
  maxPurchaseSize: number;
  minPurchaseSize: number;
  sizeStandardDeviation: number;
  sizeCoefficient: number; // Коэффициент вариации
  
  // Детекция паттерна
  hasSimilarSizes: boolean;
  sizeTolerance: number; // В процентах
  suspicionScore: number; // 0-100
}

export class SolanaMonitor {
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  
  // 🎯 АКТИВНЫЕ ПОЗИЦИИ ДЛЯ АГРЕГАЦИИ
  private activePositions = new Map<string, AggregatedPosition>();
  
  // 🔧 НАСТРОЙКИ ДЕТЕКЦИИ
  private readonly config = {
    // Временное окно для агрегации
    timeWindowMinutes: 90,        // 1.5 часа для агрегации покупок
    
    // Критерии разбивки позиции
    minPurchaseCount: 3,          // Минимум 3 покупки
    minTotalUSD: 10000,           // Минимум $10K общая сумма
    maxIndividualUSD: 8000,       // Максимум $8K за одну покупку
    
    // Детекция похожих сумм
    similarSizeTolerance: 2.0,    // 2% отклонение считается "одинаковой суммой"
    minSimilarPurchases: 3,       // Минимум 3 похожие покупки
    
    // Другие фильтры
    positionTimeoutMinutes: 180,  // 3 часа таймаут для закрытия позиции
    minSuspicionScore: 75,        // Минимальный score для алерта
    
    // Фильтры кошельков
    minWalletAge: 7,             // Минимум 7 дней возраст кошелька
    maxWalletActivity: 100        // Максимум 100 транзакций за день (анти-бот)
  };

  constructor(database: Database, telegramNotifier: TelegramNotifier) {
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    
    // Запускаем периодическую проверку завершенных позиций
    this.startPositionMonitoring();
  }

  async processTransaction(txData: any): Promise<void> {
    try {
      // Базовая обработка транзакций
      this.logger.debug(`Processing transaction: ${txData.signature}`);
      
      // Проверяем, обрабатывали ли уже эту транзакцию
      if (await this.database.isTransactionProcessed(txData.signature)) {
        return;
      }

      // Извлекаем информацию о свапе
      const swapInfo = this.extractSwapInfo(txData);
      if (!swapInfo) return;

      // 🎯 НОВАЯ ЛОГИКА: ДОБАВЛЯЕМ В АГРЕГАЦИЮ ПОЗИЦИЙ
      if (swapInfo.swapType === 'buy' && swapInfo.amountUSD >= 500) { // Минимум $500 для анализа
        await this.addToPositionAggregation(swapInfo);
      }

      // Анализируем кошелек
      const walletInfo = await this.analyzeWallet(swapInfo.walletAddress);
      
      // Сохраняем транзакцию
      await this.database.saveTransaction(swapInfo);
      
      // Сохраняем информацию о кошельке
      if (walletInfo) {
        await this.database.saveWalletInfo(walletInfo);
      }

      this.logger.debug(`Transaction processed: ${swapInfo.tokenSymbol} - $${swapInfo.amountUSD}`);
      
    } catch (error) {
      this.logger.error('Error processing transaction:', error);
    }
  }

  // 🎯 ОСНОВНОЙ МЕТОД АГРЕГАЦИИ ПОЗИЦИЙ
  private async addToPositionAggregation(swap: TokenSwap): Promise<void> {
    try {
      // Фильтруем слишком крупные покупки (не разбивка)
      if (swap.amountUSD > this.config.maxIndividualUSD) {
        return;
      }

      // Проверяем базовые фильтры кошелька
      const walletFilters = await this.checkWalletFilters(swap.walletAddress);
      if (!walletFilters.passed) {
        this.logger.debug(`Wallet filtered out: ${walletFilters.reason}`);
        return;
      }

      const positionKey = `${swap.walletAddress}-${swap.tokenAddress}`;
      const price = swap.amountUSD / swap.amount;
      
      const newPurchase: PositionPurchase = {
        transactionId: swap.transactionId,
        amountUSD: swap.amountUSD,
        tokenAmount: swap.amount,
        price,
        timestamp: swap.timestamp
      };

      // Получаем или создаем позицию
      let position = this.activePositions.get(positionKey);
      
      if (!position) {
        // Создаем новую позицию
        position = {
          walletAddress: swap.walletAddress,
          tokenAddress: swap.tokenAddress,
          tokenSymbol: swap.tokenSymbol,
          tokenName: swap.tokenName,
          purchases: [],
          totalUSD: 0,
          totalTokens: 0,
          avgPrice: 0,
          purchaseCount: 0,
          firstBuyTime: swap.timestamp,
          lastBuyTime: swap.timestamp,
          timeWindowMinutes: 0,
          avgPurchaseSize: 0,
          maxPurchaseSize: 0,
          minPurchaseSize: Infinity,
          sizeStandardDeviation: 0,
          sizeCoefficient: 0,
          hasSimilarSizes: false,
          sizeTolerance: 0,
          suspicionScore: 0
        };
        this.activePositions.set(positionKey, position);
      }

      // Проверяем временное окно
      const timeDiffMinutes = (swap.timestamp.getTime() - position.firstBuyTime.getTime()) / (1000 * 60);
      
      if (timeDiffMinutes > this.config.timeWindowMinutes) {
        // Если вышли за временное окно - анализируем старую позицию и начинаем новую
        await this.analyzePosition(position);
        
        // Создаем новую позицию
        position = {
          walletAddress: swap.walletAddress,
          tokenAddress: swap.tokenAddress,
          tokenSymbol: swap.tokenSymbol,
          tokenName: swap.tokenName,
          purchases: [],
          totalUSD: 0,
          totalTokens: 0,
          avgPrice: 0,
          purchaseCount: 0,
          firstBuyTime: swap.timestamp,
          lastBuyTime: swap.timestamp,
          timeWindowMinutes: 0,
          avgPurchaseSize: 0,
          maxPurchaseSize: 0,
          minPurchaseSize: Infinity,
          sizeStandardDeviation: 0,
          sizeCoefficient: 0,
          hasSimilarSizes: false,
          sizeTolerance: 0,
          suspicionScore: 0
        };
        this.activePositions.set(positionKey, position);
      }

      // Добавляем покупку к позиции
      position.purchases.push(newPurchase);
      position.totalUSD += swap.amountUSD;
      position.totalTokens += swap.amount;
      position.purchaseCount++;
      position.lastBuyTime = swap.timestamp;
      position.timeWindowMinutes = timeDiffMinutes;

      // Пересчитываем метрики
      this.recalculatePositionMetrics(position);

      this.logger.debug(`Added to position: ${swap.tokenSymbol} - $${swap.amountUSD} (${position.purchaseCount} purchases, score: ${position.suspicionScore})`);

      // Если достигли минимального количества покупок - проверяем на подозрительность
      if (position.purchaseCount >= this.config.minPurchaseCount) {
        if (position.suspicionScore >= this.config.minSuspicionScore) {
          this.logger.info(`🎯 Suspicious position pattern detected: ${position.tokenSymbol} - $${position.totalUSD} in ${position.purchaseCount} purchases`);
        }
      }

    } catch (error) {
      this.logger.error('Error adding to position aggregation:', error);
    }
  }

  // 🔧 ПЕРЕСЧЕТ МЕТРИК ПОЗИЦИИ
  private recalculatePositionMetrics(position: AggregatedPosition): void {
    const purchases = position.purchases;
    const amounts = purchases.map(p => p.amountUSD);
    
    // Базовые метрики
    position.avgPrice = position.totalUSD / position.totalTokens;
    position.avgPurchaseSize = position.totalUSD / position.purchaseCount;
    position.maxPurchaseSize = Math.max(...amounts);
    position.minPurchaseSize = Math.min(...amounts);
    
    // Стандартное отклонение и коэффициент вариации
    const mean = position.avgPurchaseSize;
    const variance = amounts.reduce((sum, amount) => sum + Math.pow(amount - mean, 2), 0) / amounts.length;
    position.sizeStandardDeviation = Math.sqrt(variance);
    position.sizeCoefficient = position.sizeStandardDeviation / mean;
    
    // 🎯 ДЕТЕКЦИЯ ПОХОЖИХ СУММ
    position.hasSimilarSizes = this.detectSimilarSizes(amounts);
    position.sizeTolerance = this.calculateSizeTolerance(amounts);
    
    // 🎯 РАСЧЕТ ПОДОЗРИТЕЛЬНОСТИ
    position.suspicionScore = this.calculateSuspicionScore(position);
  }

  // 🎯 ДЕТЕКЦИЯ ПОХОЖИХ СУММ (КЛЮЧЕВАЯ ЛОГИКА!)
  private detectSimilarSizes(amounts: number[]): boolean {
    if (amounts.length < this.config.minSimilarPurchases) return false;
    
    // Группируем суммы с учетом толерантности
    const groups = new Map<number, number[]>();
    
    for (const amount of amounts) {
      let foundGroup = false;
      
      for (const [groupKey, groupAmounts] of groups) {
        const tolerance = groupKey * (this.config.similarSizeTolerance / 100);
        
        if (Math.abs(amount - groupKey) <= tolerance) {
          groupAmounts.push(amount);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        groups.set(amount, [amount]);
      }
    }
    
    // Проверяем, есть ли группа с достаточным количеством похожих сумм
    for (const [_, groupAmounts] of groups) {
      if (groupAmounts.length >= this.config.minSimilarPurchases) {
        return true;
      }
    }
    
    return false;
  }

  // 🎯 РАСЧЕТ ТОЛЕРАНТНОСТИ РАЗМЕРОВ
  private calculateSizeTolerance(amounts: number[]): number {
    if (amounts.length < 2) return 0;
    
    // Находим самую большую группу похожих сумм
    const groups = new Map<number, number[]>();
    
    for (const amount of amounts) {
      let foundGroup = false;
      
      for (const [groupKey, groupAmounts] of groups) {
        const tolerance = groupKey * (this.config.similarSizeTolerance / 100);
        
        if (Math.abs(amount - groupKey) <= tolerance) {
          groupAmounts.push(amount);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        groups.set(amount, [amount]);
      }
    }
    
    // Возвращаем максимальное отклонение в самой большой группе
    let maxGroupSize = 0;
    let maxTolerance = 0;
    
    for (const [groupKey, groupAmounts] of groups) {
      if (groupAmounts.length > maxGroupSize) {
        maxGroupSize = groupAmounts.length;
        const deviations = groupAmounts.map(amount => Math.abs(amount - groupKey) / groupKey * 100);
        maxTolerance = Math.max(...deviations);
      }
    }
    
    return maxTolerance;
  }

  // 🎯 РАСЧЕТ ПОДОЗРИТЕЛЬНОСТИ (0-100)
  private calculateSuspicionScore(position: AggregatedPosition): number {
    let score = 0;
    
    // 1. Базовый score за количество покупок
    if (position.purchaseCount >= 3) score += 20;
    if (position.purchaseCount >= 5) score += 15;
    if (position.purchaseCount >= 8) score += 10;
    
    // 2. Score за общую сумму
    if (position.totalUSD >= 10000) score += 15;
    if (position.totalUSD >= 25000) score += 10;
    if (position.totalUSD >= 50000) score += 10;
    
    // 3. 🎯 ГЛАВНЫЙ КРИТЕРИЙ: Похожие размеры покупок
    if (position.hasSimilarSizes) {
      score += 30; // Основной бонус
      
      // Дополнительные баллы за точность
      if (position.sizeTolerance <= 1.0) score += 15; // Очень точно (≤1%)
      else if (position.sizeTolerance <= 2.0) score += 10; // Точно (≤2%)
      else if (position.sizeTolerance <= 5.0) score += 5;  // Приблизительно (≤5%)
    }
    
    // 4. Score за низкую вариативность (равномерность)
    if (position.sizeCoefficient <= 0.1) score += 10; // Очень равномерно
    else if (position.sizeCoefficient <= 0.2) score += 5; // Довольно равномерно
    
    // 5. Score за временные рамки
    if (position.timeWindowMinutes <= 30) score += 10; // В течение 30 минут
    else if (position.timeWindowMinutes <= 60) score += 5; // В течение часа
    
    // 6. Штраф за слишком разные размеры
    if (position.maxPurchaseSize / position.minPurchaseSize > 3) {
      score -= 15; // Штраф за большую разницу в размерах
    }
    
    return Math.min(Math.max(score, 0), 100);
  }

  // 🔍 ПРОВЕРКА ФИЛЬТРОВ КОШЕЛЬКА
  private async checkWalletFilters(walletAddress: string): Promise<{
    passed: boolean;
    reason?: string;
  }> {
    try {
      // Проверяем возраст кошелька и активность
      const walletInfo = await this.database.getWalletInfo(walletAddress);
      
      if (walletInfo) {
        // Проверяем возраст кошелька
        const walletAgeDays = (Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (walletAgeDays < this.config.minWalletAge) {
          return { passed: false, reason: `Wallet too new (${walletAgeDays.toFixed(1)} days)` };
        }
        
        // Проверяем активность (анти-бот)
        const recentTransactions = await this.database.getWalletTransactions(walletAddress, 200);
        const last24hTxs = recentTransactions.filter(tx => 
          Date.now() - tx.timestamp.getTime() < 24 * 60 * 60 * 1000
        );
        
        if (last24hTxs.length > this.config.maxWalletActivity) {
          return { passed: false, reason: `Too active (${last24hTxs.length} txs in 24h)` };
        }
      }
      
      return { passed: true };
      
    } catch (error) {
      this.logger.error('Error checking wallet filters:', error);
      return { passed: true }; // В случае ошибки пропускаем
    }
  }

  // 🔍 АНАЛИЗ ЗАВЕРШЕННОЙ ПОЗИЦИИ
  private async analyzePosition(position: AggregatedPosition): Promise<void> {
    try {
      // Проверяем критерии для отправки алерта
      if (!this.shouldReportPosition(position)) {
        return;
      }

      // Отправляем алерт о подозрительной позиции
      await this.sendPositionSplittingAlert(position);
      
      this.logger.info(`🚨 Position splitting detected: ${position.tokenSymbol} - $${position.totalUSD.toFixed(0)} in ${position.purchaseCount} purchases (score: ${position.suspicionScore})`);

    } catch (error) {
      this.logger.error('Error analyzing position:', error);
    }
  }

  // 🔍 ПРОВЕРКА КРИТЕРИЕВ ДЛЯ АЛЕРТА
  private shouldReportPosition(position: AggregatedPosition): boolean {
    return position.purchaseCount >= this.config.minPurchaseCount &&
           position.totalUSD >= this.config.minTotalUSD &&
           position.suspicionScore >= this.config.minSuspicionScore &&
           position.hasSimilarSizes &&
           position.timeWindowMinutes <= this.config.timeWindowMinutes;
  }

  // 📢 ОТПРАВКА АЛЕРТА О РАЗБИВКЕ ПОЗИЦИИ
  private async sendPositionSplittingAlert(position: AggregatedPosition): Promise<void> {
    try {
      await this.telegramNotifier.sendPositionSplittingAlert({
        walletAddress: position.walletAddress,
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        tokenName: position.tokenName,
        totalUSD: position.totalUSD,
        purchaseCount: position.purchaseCount,
        avgPurchaseSize: position.avgPurchaseSize,
        timeWindowMinutes: position.timeWindowMinutes,
        suspicionScore: position.suspicionScore,
        sizeTolerance: position.sizeTolerance,
        firstBuyTime: position.firstBuyTime,
        lastBuyTime: position.lastBuyTime,
        purchases: position.purchases.map(p => ({
          amountUSD: p.amountUSD,
          timestamp: p.timestamp,
          transactionId: p.transactionId
        }))
      });

    } catch (error) {
      this.logger.error('Error sending position splitting alert:', error);
    }
  }

  // 🕒 МОНИТОРИНГ ПОЗИЦИЙ (ПЕРИОДИЧЕСКАЯ ПРОВЕРКА)
  private startPositionMonitoring(): void {
    // Проверяем завершенные позиции каждые 5 минут
    setInterval(async () => {
      await this.checkExpiredPositions();
    }, 5 * 60 * 1000); // 5 минут

    this.logger.info('🕒 Position monitoring started: checking every 5 minutes');
  }

  // 🕒 ПРОВЕРКА ИСТЕКШИХ ПОЗИЦИЙ
  private async checkExpiredPositions(): Promise<void> {
    const now = Date.now();
    const expiredPositions: string[] = [];
    
    for (const [key, position] of this.activePositions) {
      const timeSinceLastBuy = (now - position.lastBuyTime.getTime()) / (1000 * 60);
      
      if (timeSinceLastBuy > this.config.positionTimeoutMinutes) {
        // Анализируем истекшую позицию
        await this.analyzePosition(position);
        expiredPositions.push(key);
      }
    }
    
    // Удаляем истекшие позиции
    for (const key of expiredPositions) {
      this.activePositions.delete(key);
    }
    
    if (expiredPositions.length > 0) {
      this.logger.debug(`🧹 Cleaned up ${expiredPositions.length} expired positions`);
    }
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ (без изменений)
  private extractSwapInfo(txData: any): TokenSwap | null {
    try {
      // Упрощенная логика извлечения информации о свапе
      return {
        transactionId: txData.signature,
        walletAddress: txData.feePayer,
        tokenAddress: 'sample_token_address',
        tokenSymbol: 'SAMPLE',
        tokenName: 'Sample Token',
        amount: 1000,
        amountUSD: 100,
        timestamp: new Date(txData.timestamp * 1000),
        dex: 'Unknown',
        isNewWallet: false,
        isReactivatedWallet: false,
        walletAge: 0,
        daysSinceLastActivity: 0,
        swapType: 'buy'
      };
    } catch (error) {
      this.logger.error('Error extracting swap info:', error);
      return null;
    }
  }

  private async analyzeWallet(walletAddress: string): Promise<WalletInfo | null> {
    try {
      // Упрощенный анализ кошелька
      return {
        address: walletAddress,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        isNew: false,
        isReactivated: false,
        relatedWallets: [],
        suspicionScore: 0,
        insiderFlags: []
      };
    } catch (error) {
      this.logger.error('Error analyzing wallet:', error);
      return null;
    }
  }

  // 📊 СТАТИСТИКА АГРЕГАТОРА
  getAggregationStats() {
    return {
      activePositions: this.activePositions.size,
      config: this.config,
      positions: Array.from(this.activePositions.values()).map(p => ({
        wallet: `${p.walletAddress.slice(0, 8)}...${p.walletAddress.slice(-4)}`,
        token: p.tokenSymbol,
        purchases: p.purchaseCount,
        totalUSD: p.totalUSD,
        suspicionScore: p.suspicionScore,
        hasSimilarSizes: p.hasSimilarSizes,
        timeWindow: p.timeWindowMinutes
      }))
    };
  }
}