// src/services/SolanaMonitor.ts - С ДЕТЕКТОРОМ АГРЕГАЦИИ ПОЗИЦИЙ + НОВЫЕ МЕТОДЫ
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
  
  // 🆕 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ ДЛЯ АНАЛИЗА
  similarSizeCount: number;
  walletAgeDays: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  detectionMethod: string;
  confidenceLevel: number;
}

// 🆕 НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ РАСШИРЕННОГО АНАЛИЗА
interface WalletAnalysis {
  address: string;
  ageDays: number;
  totalTransactions: number;
  avgTransactionSize: number;
  suspiciousPatterns: string[];
  riskScore: number;
}

interface TokenAnalysis {
  address: string;
  symbol: string;
  ageDays: number;
  totalHolders: number;
  suspiciousActivity: boolean;
  riskFactors: string[];
}

export class SolanaMonitor {
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  
  // 🎯 АКТИВНЫЕ ПОЗИЦИИ ДЛЯ АГРЕГАЦИИ
  private activePositions = new Map<string, AggregatedPosition>();
  
  // 🆕 КЕШИ ДЛЯ АНАЛИЗА
  private walletAnalysisCache = new Map<string, WalletAnalysis>();
  private tokenAnalysisCache = new Map<string, TokenAnalysis>();
  
  // 🔧 НАСТРОЙКИ ДЕТЕКЦИИ
  private readonly config = {
    // Временное окно для агрегации
    timeWindowMinutes: 180,        // 3 часа для агрегации покупок
    
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
    maxWalletActivity: 100,       // Максимум 100 транзакций за день (анти-бот)
    
    // 🆕 НОВЫЕ НАСТРОЙКИ
    highRiskThreshold: 85,        // Порог высокого риска
    autoReportThreshold: 90,      // Автоматическая отправка при высоком риске
    cacheExpiryMinutes: 30,       // Время жизни кеша анализа
    maxActivePositions: 1000,     // Максимум активных позиций в памяти
    positionCleanupInterval: 10   // Интервал очистки в минутах
  };

  // 🆕 СТАТИСТИКА РАБОТЫ
  private stats = {
    totalPositionsDetected: 0,
    highRiskPositions: 0,
    alertsSent: 0,
    cacheHits: 0,
    cacheMisses: 0,
    positionsProcessed: 0,
    avgProcessingTime: 0
  };

  constructor(database: Database, telegramNotifier: TelegramNotifier) {
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    
    // Запускаем периодическую проверку завершенных позиций
    this.startPositionMonitoring();
    
    // 🆕 ЗАПУСКАЕМ АВТОМАТИЧЕСКУЮ ОБРАБОТКУ ДЕТЕКЦИЙ
    this.startAutomaticProcessing();
    
    // 🆕 ЗАПУСКАЕМ ОЧИСТКУ КЕШЕЙ
    this.startCacheCleanup();
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
    const startTime = Date.now();
    
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
        // 🆕 РАСШИРЕННЫЙ АНАЛИЗ ПРИ СОЗДАНИИ ПОЗИЦИИ
        const walletAnalysis = await this.getWalletAnalysis(swap.walletAddress);
        const tokenAnalysis = await this.getTokenAnalysis(swap.tokenAddress, swap.tokenSymbol);
        
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
          suspicionScore: 0,
          // 🆕 НОВЫЕ ПОЛЯ
          similarSizeCount: 0,
          walletAgeDays: walletAnalysis.ageDays,
          riskLevel: 'LOW',
          detectionMethod: 'position_aggregation',
          confidenceLevel: 0
        };
        this.activePositions.set(positionKey, position);
      }

      // Проверяем временное окно
      const timeDiffMinutes = (swap.timestamp.getTime() - position.firstBuyTime.getTime()) / (1000 * 60);
      
      if (timeDiffMinutes > this.config.timeWindowMinutes) {
        // Если вышли за временное окно - анализируем старую позицию и начинаем новую
        await this.analyzePosition(position);
        
        // Создаем новую позицию
        const walletAnalysis = await this.getWalletAnalysis(swap.walletAddress);
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
          suspicionScore: 0,
          similarSizeCount: 0,
          walletAgeDays: walletAnalysis.ageDays,
          riskLevel: 'LOW',
          detectionMethod: 'position_aggregation',
          confidenceLevel: 0
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

      // 🆕 УЛУЧШЕННАЯ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНОСТЬ
      if (position.purchaseCount >= this.config.minPurchaseCount) {
        if (position.suspicionScore >= this.config.minSuspicionScore) {
          this.logger.info(`🎯 Suspicious position pattern detected: ${position.tokenSymbol} - $${position.totalUSD} in ${position.purchaseCount} purchases (score: ${position.suspicionScore})`);
          
          // 🆕 АВТОМАТИЧЕСКАЯ ОТПРАВКА ПРИ ОЧЕНЬ ВЫСОКОМ РИСКЕ
          if (position.suspicionScore >= this.config.autoReportThreshold) {
            await this.sendPositionSplittingAlert(position);
            this.stats.alertsSent++;
          }
        }
      }

      // Обновляем статистику
      const processingTime = Date.now() - startTime;
      this.stats.avgProcessingTime = (this.stats.avgProcessingTime + processingTime) / 2;
      this.stats.positionsProcessed++;

    } catch (error) {
      this.logger.error('Error adding to position aggregation:', error);
    }
  }

  // 🆕 НОВЫЙ МЕТОД: АНАЛИЗ КОШЕЛЬКА С КЕШИРОВАНИЕМ
  private async getWalletAnalysis(walletAddress: string): Promise<WalletAnalysis> {
    // Проверяем кеш
    const cached = this.walletAnalysisCache.get(walletAddress);
    if (cached && Date.now() - cached.ageDays < this.config.cacheExpiryMinutes * 60 * 1000) {
      this.stats.cacheHits++;
      return cached;
    }

    this.stats.cacheMisses++;

    // Получаем информацию о кошельке
    const walletInfo = await this.database.getWalletInfo(walletAddress);
    const recentTxs = await this.database.getWalletTransactions(walletAddress, 50);
    
    const ageDays = walletInfo ? 
      (Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60 * 24) : 1;
    
    const avgTxSize = recentTxs.length > 0 ? 
      recentTxs.reduce((sum, tx) => sum + tx.amountUSD, 0) / recentTxs.length : 0;

    // 🆕 ДЕТЕКЦИЯ ПОДОЗРИТЕЛЬНЫХ ПАТТЕРНОВ
    const suspiciousPatterns: string[] = [];
    let riskScore = 0;

    // Очень новый кошелек
    if (ageDays < 1) {
      suspiciousPatterns.push('very_new_wallet');
      riskScore += 30;
    } else if (ageDays < 7) {
      suspiciousPatterns.push('new_wallet');
      riskScore += 15;
    }

    // Высокая активность
    if (recentTxs.length > 50) {
      suspiciousPatterns.push('high_activity');
      riskScore += 20;
    }

    // Крупные транзакции
    if (avgTxSize > 50000) {
      suspiciousPatterns.push('large_transactions');
      riskScore += 10;
    }

    const analysis: WalletAnalysis = {
      address: walletAddress,
      ageDays,
      totalTransactions: recentTxs.length,
      avgTransactionSize: avgTxSize,
      suspiciousPatterns,
      riskScore
    };

    // Кешируем результат
    this.walletAnalysisCache.set(walletAddress, analysis);
    
    return analysis;
  }

  // 🆕 НОВЫЙ МЕТОД: АНАЛИЗ ТОКЕНА С КЕШИРОВАНИЕМ
  private async getTokenAnalysis(tokenAddress: string, tokenSymbol: string): Promise<TokenAnalysis> {
    // Проверяем кеш
    const cached = this.tokenAnalysisCache.get(tokenAddress);
    if (cached && Date.now() - cached.ageDays < this.config.cacheExpiryMinutes * 60 * 1000) {
      this.stats.cacheHits++;
      return cached;
    }

    this.stats.cacheMisses++;

    // Получаем транзакции по токену
    const tokenTxs = await this.database.getTransactionsByTokenAddress(tokenAddress, 100);
    
    // Примерный возраст токена
    const ageDays = tokenTxs.length > 0 ? 
      (Date.now() - Math.min(...tokenTxs.map(tx => tx.timestamp.getTime()))) / (1000 * 60 * 60 * 24) : 1;

    // Уникальные держатели
    const uniqueHolders = new Set(tokenTxs.map(tx => tx.walletAddress)).size;

    // 🆕 ДЕТЕКЦИЯ ПОДОЗРИТЕЛЬНОЙ АКТИВНОСТИ
    const riskFactors: string[] = [];
    let suspiciousActivity = false;

    // Очень новый токен
    if (ageDays < 1) {
      riskFactors.push('very_new_token');
      suspiciousActivity = true;
    }

    // Мало держателей при высокой активности
    if (tokenTxs.length > 50 && uniqueHolders < 10) {
      riskFactors.push('concentrated_trading');
      suspiciousActivity = true;
    }

    const analysis: TokenAnalysis = {
      address: tokenAddress,
      symbol: tokenSymbol,
      ageDays,
      totalHolders: uniqueHolders,
      suspiciousActivity,
      riskFactors
    };

    // Кешируем результат
    this.tokenAnalysisCache.set(tokenAddress, analysis);
    
    return analysis;
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
    const similarSizeAnalysis = this.detectSimilarSizes(amounts);
    position.hasSimilarSizes = similarSizeAnalysis.hasSimilar;
    position.similarSizeCount = similarSizeAnalysis.count;
    position.sizeTolerance = this.calculateSizeTolerance(amounts);
    
    // 🎯 РАСЧЕТ ПОДОЗРИТЕЛЬНОСТИ
    position.suspicionScore = this.calculateSuspicionScore(position);
    
    // 🆕 ОПРЕДЕЛЕНИЕ УРОВНЯ РИСКА
    position.riskLevel = this.determineRiskLevel(position.suspicionScore);
    
    // 🆕 РАСЧЕТ УВЕРЕННОСТИ В ДЕТЕКЦИИ
    position.confidenceLevel = this.calculateConfidenceLevel(position);
  }

  // 🎯 ДЕТЕКЦИЯ ПОХОЖИХ СУММ (КЛЮЧЕВАЯ ЛОГИКА!)
  private detectSimilarSizes(amounts: number[]): { hasSimilar: boolean; count: number } {
    if (amounts.length < this.config.minSimilarPurchases) {
      return { hasSimilar: false, count: 0 };
    }
    
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
    let maxGroupSize = 0;
    for (const [_, groupAmounts] of groups) {
      if (groupAmounts.length >= this.config.minSimilarPurchases) {
        maxGroupSize = Math.max(maxGroupSize, groupAmounts.length);
      }
    }
    
    return {
      hasSimilar: maxGroupSize >= this.config.minSimilarPurchases,
      count: maxGroupSize
    };
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

  // 🎯 РАСЧЕТ ПОДОЗРИТЕЛЬНОСТИ (0-100) - УЛУЧШЕННЫЙ
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
      
      // 🆕 БОНУС ЗА КОЛИЧЕСТВО ПОХОЖИХ ПОКУПОК
      score += Math.min(position.similarSizeCount * 2, 10);
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
    
    // 🆕 7. ДОПОЛНИТЕЛЬНЫЕ ФАКТОРЫ РИСКА
    
    // Возраст кошелька
    if (position.walletAgeDays < 1) score += 20;
    else if (position.walletAgeDays < 7) score += 10;
    
    // Размер отдельных покупок близок к лимиту
    const avgCloseToLimit = position.avgPurchaseSize / this.config.maxIndividualUSD;
    if (avgCloseToLimit > 0.8) score += 15; // Очень близко к лимиту
    else if (avgCloseToLimit > 0.6) score += 10;
    
    return Math.min(Math.max(score, 0), 100);
  }

  // 🆕 ОПРЕДЕЛЕНИЕ УРОВНЯ РИСКА
  private determineRiskLevel(suspicionScore: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (suspicionScore >= this.config.highRiskThreshold) return 'HIGH';
    if (suspicionScore >= this.config.minSuspicionScore) return 'MEDIUM';
    return 'LOW';
  }

  // 🆕 РАСЧЕТ УВЕРЕННОСТИ В ДЕТЕКЦИИ
  private calculateConfidenceLevel(position: AggregatedPosition): number {
    let confidence = 50; // Базовая уверенность
    
    // Увеличиваем уверенность при наличии сильных сигналов
    if (position.hasSimilarSizes) confidence += 30;
    if (position.sizeCoefficient < 0.15) confidence += 20;
    if (position.purchaseCount >= 5) confidence += 15;
    if (position.timeWindowMinutes <= 60) confidence += 10;
    
    // Снижаем уверенность при слабых сигналах
    if (position.purchaseCount < 4) confidence -= 20;
    if (position.sizeTolerance > 5) confidence -= 15;
    if (position.timeWindowMinutes > 120) confidence -= 10;
    
    return Math.min(Math.max(confidence, 0), 100);
  }

  // 🔍 ПРОВЕРКА ФИЛЬТРОВ КОШЕЛЬКА
  private async checkWalletFilters(walletAddress: string): Promise<{
    passed: boolean;
    reason?: string;
  }> {
    try {
      // Используем кешированный анализ
      const analysis = await this.getWalletAnalysis(walletAddress);
      
      // Проверяем возраст кошелька
      if (analysis.ageDays < this.config.minWalletAge) {
        return { passed: false, reason: `Wallet too new (${analysis.ageDays.toFixed(1)} days)` };
      }
      
      // Проверяем активность (анти-бот)
      if (analysis.totalTransactions > this.config.maxWalletActivity) {
        return { passed: false, reason: `Too active (${analysis.totalTransactions} txs)` };
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

      // 🆕 СОХРАНЯЕМ В БАЗУ ДАННЫХ
      const aggregationId = await this.database.savePositionAggregation({
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
          transactionId: p.transactionId,
          amountUSD: p.amountUSD,
          timestamp: p.timestamp
        })),
        // 🆕 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ
        maxPurchaseSize: position.maxPurchaseSize,
        minPurchaseSize: position.minPurchaseSize,
        sizeStdDeviation: position.sizeStandardDeviation,
        sizeCoefficient: position.sizeCoefficient,
        similarSizeCount: position.similarSizeCount,
        walletAgeDays: position.walletAgeDays,
        riskLevel: position.riskLevel
      });

      // Отправляем алерт о подозрительной позиции
      await this.sendPositionSplittingAlert(position);
      
      this.logger.info(`🚨 Position splitting detected and saved: ${position.tokenSymbol} - $${position.totalUSD.toFixed(0)} in ${position.purchaseCount} purchases (score: ${position.suspicionScore}, ID: ${aggregationId})`);

      // Обновляем статистику
      this.stats.totalPositionsDetected++;
      if (position.riskLevel === 'HIGH') {
        this.stats.highRiskPositions++;
      }

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
           position.timeWindowMinutes <= this.config.timeWindowMinutes &&
           position.confidenceLevel >= 60; // 🆕 МИНИМАЛЬНАЯ УВЕРЕННОСТЬ
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

      this.stats.alertsSent++;

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

  // 🆕 АВТОМАТИЧЕСКАЯ ОБРАБОТКА ДЕТЕКЦИЙ
  private startAutomaticProcessing(): void {
    // Обрабатываем необработанные позиции каждые 2 минуты
    setInterval(async () => {
      await this.processUnhandledDetections();
    }, 2 * 60 * 1000); // 2 минуты

    this.logger.info('🤖 Automatic processing started: every 2 minutes');
  }

  // 🆕 ОЧИСТКА КЕШЕЙ
  private startCacheCleanup(): void {
    // Очищаем кеши каждые 30 минут
    setInterval(() => {
      this.cleanupCaches();
      this.cleanupActivePositions();
    }, 30 * 60 * 1000); // 30 минут

    this.logger.info('🧹 Cache cleanup started: every 30 minutes');
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

  // 🆕 ОБРАБОТКА НЕОБРАБОТАННЫХ ДЕТЕКЦИЙ
  private async processUnhandledDetections(): Promise<void> {
    try {
      const unprocessed = await this.database.getUnprocessedPositionAggregations(20);
      
      for (const detection of unprocessed) {
        if (detection.suspicionScore >= this.config.autoReportThreshold) {
          // Отправляем алерт для высокорисковых позиций
          await this.telegramNotifier.sendCycleLog(
            `🚨 <b>HIGH RISK POSITION DETECTED</b>\n\n` +
            `💰 Total: <code>$${this.formatNumber(detection.totalUSD)}</code>\n` +
            `🪙 Token: <code>#${detection.tokenSymbol}</code>\n` +
            `👤 Wallet: <code>${detection.walletAddress.slice(0, 8)}...${detection.walletAddress.slice(-4)}</code>\n` +
            `🎯 Risk Score: <code>${detection.suspicionScore}/100</code>\n` +
            `🔢 Purchases: <code>${detection.purchaseCount}</code>\n\n` +
            `<a href="https://solscan.io/token/${detection.tokenAddress}">Token</a> | <a href="https://solscan.io/account/${detection.walletAddress}">Wallet</a>`
          );
          
          await this.database.markPositionAggregationAsProcessed(detection.id, true);
        } else {
          // Просто помечаем как обработанное
          await this.database.markPositionAggregationAsProcessed(detection.id, false);
        }
      }
      
      if (unprocessed.length > 0) {
        this.logger.info(`🤖 Processed ${unprocessed.length} unhandled detections`);
      }
      
    } catch (error) {
      this.logger.error('Error processing unhandled detections:', error);
    }
  }

  // 🆕 ОЧИСТКА КЕШЕЙ
  private cleanupCaches(): void {
    const now = Date.now();
    const expiryMs = this.config.cacheExpiryMinutes * 60 * 1000;
    
    // Очищаем кеш анализа кошельков
    let walletCacheCleared = 0;
    for (const [key, analysis] of this.walletAnalysisCache) {
      if (now - analysis.ageDays > expiryMs) {
        this.walletAnalysisCache.delete(key);
        walletCacheCleared++;
      }
    }
    
    // Очищаем кеш анализа токенов
    let tokenCacheCleared = 0;
    for (const [key, analysis] of this.tokenAnalysisCache) {
      if (now - analysis.ageDays > expiryMs) {
        this.tokenAnalysisCache.delete(key);
        tokenCacheCleared++;
      }
    }
    
    if (walletCacheCleared > 0 || tokenCacheCleared > 0) {
      this.logger.debug(`🧹 Cache cleanup: ${walletCacheCleared} wallets, ${tokenCacheCleared} tokens`);
    }
  }

  // 🆕 ОЧИСТКА АКТИВНЫХ ПОЗИЦИЙ
  private cleanupActivePositions(): void {
    if (this.activePositions.size > this.config.maxActivePositions) {
      // Удаляем самые старые позиции
      const sortedPositions = Array.from(this.activePositions.entries())
        .sort(([,a], [,b]) => a.firstBuyTime.getTime() - b.firstBuyTime.getTime());
      
      const toRemove = sortedPositions.slice(0, this.activePositions.size - this.config.maxActivePositions);
      
      for (const [key] of toRemove) {
        this.activePositions.delete(key);
      }
      
      this.logger.info(`🧹 Removed ${toRemove.length} old active positions (limit: ${this.config.maxActivePositions})`);
    }
  }

  // 🆕 ФОРМАТИРОВАНИЕ ЧИСЕЛ
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    } else {
      return num.toFixed(0);
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
      stats: this.stats,
      cacheStats: {
        walletAnalysisCache: this.walletAnalysisCache.size,
        tokenAnalysisCache: this.tokenAnalysisCache.size,
        cacheHitRate: this.stats.cacheHits > 0 ? 
          (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(1) + '%' : '0%'
      },
      positions: Array.from(this.activePositions.values()).map(p => ({
        wallet: `${p.walletAddress.slice(0, 8)}...${p.walletAddress.slice(-4)}`,
        token: p.tokenSymbol,
        purchases: p.purchaseCount,
        totalUSD: p.totalUSD,
        suspicionScore: p.suspicionScore,
        hasSimilarSizes: p.hasSimilarSizes,
        timeWindow: p.timeWindowMinutes,
        riskLevel: p.riskLevel,
        confidence: p.confidenceLevel
      }))
    };
  }

  // 🆕 НОВЫЕ МЕТОДЫ ДЛЯ ВНЕШНЕГО ИСПОЛЬЗОВАНИЯ

  // Получение статистики детекций
  getDetectionStats() {
    return {
      totalDetected: this.stats.totalPositionsDetected,
      highRiskDetected: this.stats.highRiskPositions,
      alertsSent: this.stats.alertsSent,
      avgProcessingTime: this.stats.avgProcessingTime,
      activePositions: this.activePositions.size
    };
  }

  // Принудительная проверка всех активных позиций
  async forceCheckAllPositions(): Promise<number> {
    let processed = 0;
    
    for (const [key, position] of this.activePositions) {
      if (position.suspicionScore >= this.config.minSuspicionScore) {
        await this.analyzePosition(position);
        this.activePositions.delete(key);
        processed++;
      }
    }
    
    this.logger.info(`🔍 Force-checked all positions: ${processed} analyzed`);
    return processed;
  }

  // Получение позиции по ключу
  getActivePosition(walletAddress: string, tokenAddress: string): AggregatedPosition | null {
    const key = `${walletAddress}-${tokenAddress}`;
    return this.activePositions.get(key) || null;
  }

  // 🆕 МЕТОД ПРОВЕРКИ НА АГРЕГАЦИЮ (ДЛЯ ДРУГИХ СЕРВИСОВ)
  async checkForPositionAggregation(walletAddress: string, tokenAddress: string, amountUSD: number): Promise<{
    isPartOfAggregation: boolean;
    suspicionScore: number;
    aggregationId?: number;
  }> {
    try {
      const positionKey = `${walletAddress}-${tokenAddress}`;
      const position = this.activePositions.get(positionKey);
      
      if (position && position.purchaseCount >= this.config.minPurchaseCount) {
        return {
          isPartOfAggregation: true,
          suspicionScore: position.suspicionScore,
          aggregationId: undefined // Будет установлен при сохранении в БД
        };
      }
      
      return {
        isPartOfAggregation: false,
        suspicionScore: 0
      };
      
    } catch (error) {
      this.logger.error('Error checking for position aggregation:', error);
      return {
        isPartOfAggregation: false,
        suspicionScore: 0
      };
    }
  }
}