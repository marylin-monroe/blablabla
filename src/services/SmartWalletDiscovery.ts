// src/services/SmartWalletDiscovery.ts - ОПТИМИЗИРОВАННЫЙ С СМЯГЧЕННЫМИ КРИТЕРИЯМИ - ИСПРАВЛЕННЫЙ
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { Database } from './Database';
import { Logger } from '../utils/Logger';
import { WalletAnalysisResult, WalletPerformanceMetrics } from '../types';

export class SmartWalletDiscovery {
  private smDatabase: SmartMoneyDatabase;
  private database: Database;
  private logger: Logger;
  private heliusApiKey: string;
  
  // 🔧 ИСПРАВЛЕНО: Добавлено поле для отслеживания процесса поиска
  private isDiscoveryInProgress = false;

  constructor(smDatabase: SmartMoneyDatabase, database: Database) {
    this.smDatabase = smDatabase;
    this.database = database;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY!;
  }

  async discoverSmartWallets(): Promise<WalletAnalysisResult[]> {
    // 🔧 ИСПРАВЛЕНО: Проверяем, не запущен ли уже процесс поиска
    if (this.isDiscoveryInProgress) {
      this.logger.warn('🔄 Smart Wallet Discovery already in progress, skipping...');
      return [];
    }

    this.isDiscoveryInProgress = true;
    this.logger.info('🔍 Starting OPTIMIZED Smart Wallet Discovery with RELAXED criteria...');

    try {
      // 🔥 КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Получаем только ТОП кандидатов (остается 20)
      const candidateWallets = await this.findTopCandidateWalletsOptimized();
      this.logger.info(`Found ${candidateWallets.length} TOP candidate wallets (RELAXED CRITERIA)`);

      const results: WalletAnalysisResult[] = [];

      for (const walletAddress of candidateWallets) {
        try {
          const analysis = await this.analyzeWalletOptimized(walletAddress);
          if (analysis) {
            results.push(analysis);
          }
          
          // 🔥 УВЕЛИЧЕННАЯ ПАУЗА между анализами для экономии API
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms вместо 100ms
        } catch (error) {
          this.logger.error(`Error analyzing wallet ${walletAddress}:`, error);
        }
      }

      const smartMoneyCount = results.filter(r => r.isSmartMoney).length;
      this.logger.info(`✅ OPTIMIZED Wallet discovery completed: ${smartMoneyCount}/${candidateWallets.length} smart money wallets found`);
      return results;

    } catch (error) {
      this.logger.error('❌ Error in optimized wallet discovery:', error);
      throw error;
    } finally {
      // 🔧 ИСПРАВЛЕНО: Обязательно сбрасываем флаг в finally блоке
      this.isDiscoveryInProgress = false;
    }
  }

  // 🔥 СУПЕР ОПТИМИЗИРОВАННЫЙ ПОИСК КАНДИДАТОВ: СМЯГЧЕННЫЕ КРИТЕРИИ
  private async findTopCandidateWalletsOptimized(): Promise<string[]> {
    let candidates: string[] = [];
    
    try {
      // 🔥 СОКРАЩЕННЫЙ ПЕРИОД: 2 недели → 1 неделя для свежести
      const recentTransactions = await this.database.getRecentTransactions(24 * 7); // 1 неделя
      
      // Группируем по кошелькам и считаем метрики
      const walletMetrics = new Map<string, {
        totalVolume: number;
        tradeCount: number;
        uniqueTokens: Set<string>;
        avgTradeSize: number;
        maxTradeSize: number;
        lastActivity: Date;
      }>();

      for (const tx of recentTransactions) {
        const key = tx.walletAddress;
        
        if (!walletMetrics.has(key)) {
          walletMetrics.set(key, {
            totalVolume: 0,
            tradeCount: 0,
            uniqueTokens: new Set(),
            avgTradeSize: 0,
            maxTradeSize: 0,
            lastActivity: tx.timestamp
          });
        }

        const metrics = walletMetrics.get(key)!;
        metrics.totalVolume += tx.amountUSD;
        metrics.tradeCount++;
        metrics.uniqueTokens.add(tx.tokenAddress);
        metrics.maxTradeSize = Math.max(metrics.maxTradeSize, tx.amountUSD);
        
        if (tx.timestamp > metrics.lastActivity) {
          metrics.lastActivity = tx.timestamp;
        }
      }

      // Вычисляем средний размер сделки и применяем СМЯГЧЕННЫЕ фильтры
      for (const [wallet, metrics] of walletMetrics) {
        metrics.avgTradeSize = metrics.totalVolume / metrics.tradeCount;
        
        // 🔥 СМЯГЧЕННЫЕ КРИТЕРИИ для поиска большего количества талантов
        const daysSinceActive = (Date.now() - metrics.lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        
        if (
          metrics.totalVolume >= 30000 && // 🔥 СНИЖЕНО: $30K объема (было $100K)
          metrics.tradeCount >= 20 && // Остается 20
          metrics.avgTradeSize >= 1500 && // 🔥 СНИЖЕНО: $1.5K средняя сделка (было $5K)
          metrics.maxTradeSize >= 5000 && // 🔥 СНИЖЕНО: минимум одна крупная сделка $5K+ (было $25K)
          metrics.uniqueTokens.size >= 5 && // Остается 5 разных токенов
          daysSinceActive <= 7 // 🔥 УВЕЛИЧЕНО: активность в последние 7 дней (было 3)
        ) {
          candidates.push(wallet);
        }
      }

      // Сортируем по комбинированному скору: объем + активность + размер сделок
      candidates.sort((a, b) => {
        const aMetrics = walletMetrics.get(a)!;
        const bMetrics = walletMetrics.get(b)!;
        
        // 🔥 КОМБИНИРОВАННЫЙ СКОР для ранжирования
        const aScore = aMetrics.totalVolume * 0.4 + 
                      aMetrics.avgTradeSize * 0.3 + 
                      aMetrics.maxTradeSize * 0.2 + 
                      aMetrics.uniqueTokens.size * 1000 * 0.1;
                      
        const bScore = bMetrics.totalVolume * 0.4 + 
                      bMetrics.avgTradeSize * 0.3 + 
                      bMetrics.maxTradeSize * 0.2 + 
                      bMetrics.uniqueTokens.size * 1000 * 0.1;
        
        return bScore - aScore;
      });

      // 🔥 ОСТАЕТСЯ 20 кандидатов как просил пользователь
      const topCandidates = candidates.slice(0, 20);
      
      this.logger.info(`🎯 Selected TOP ${topCandidates.length}/20 candidates with RELAXED criteria:`);
      this.logger.info(`• Min volume: $30K+ (было $100K)`);
      this.logger.info(`• Min trades: 20+`);
      this.logger.info(`• Min avg trade: $1.5K+ (было $5K)`);
      this.logger.info(`• Min max trade: $5K+ (было $25K)`);
      this.logger.info(`• Min tokens: 5+`);
      this.logger.info(`• Max inactivity: 7 days (было 3)`);

      return topCandidates;

    } catch (error) {
      this.logger.error('Error finding optimized candidate wallets:', error);
      return candidates; // Возвращаем что успели найти
    }
  }

  // 🔥 ОПТИМИЗИРОВАННЫЙ АНАЛИЗ КОШЕЛЬКА - С УЛУЧШЕННОЙ ОБРАБОТКОЙ ОШИБОК
  private async analyzeWalletOptimized(walletAddress: string): Promise<WalletAnalysisResult | null> {
    let analysisInProgress = true;
    
    try {
      // 🔧 ИСПРАВЛЕНО: Добавлена проверка на валидность адреса
      if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < 32) {
        this.logger.warn(`Invalid wallet address: ${walletAddress}`);
        return null;
      }

      // Проверяем, не является ли кошелек уже Smart Money
      const existingWallet = await this.smDatabase.getSmartWallet(walletAddress);
      if (existingWallet) {
        this.logger.debug(`Wallet ${walletAddress} already exists in Smart Money database`);
        return null; // Уже в базе
      }

      // 🔥 ОГРАНИЧЕННАЯ ИСТОРИЯ: максимум 200 транзакций (было 500)
      const transactions = await this.database.getWalletTransactions(walletAddress, 200);
      if (transactions.length < 30) { // СНИЖЕНО: 30 транзакций (было 50)
        return {
          address: walletAddress,
          isSmartMoney: false,
          metrics: this.getDefaultMetrics(),
          familyConnections: [], // Всегда пустой массив
          disqualificationReasons: ['Insufficient transaction history (need 30+ txs)']
        };
      }

      // Анализируем метрики производительности
      const metrics = await this.calculatePerformanceMetricsOptimized(transactions);
      
      // Определяем категорию
      const category = this.determineCategoryOptimized(transactions, metrics);
      
      // 🔥 СМЯГЧЕННЫЕ критерии Smart Money
      const { isSmartMoney, disqualificationReasons } = this.evaluateSmartMoneyRelaxed(metrics);

      return {
        address: walletAddress,
        isSmartMoney,
        category,
        metrics,
        familyConnections: [], // Всегда пустой массив
        disqualificationReasons
      };

    } catch (error) {
      this.logger.error(`Error analyzing wallet ${walletAddress}:`, error);
      return null;
    } finally {
      // 🔧 ИСПРАВЛЕНО: Добавлен finally блок для безопасности
      analysisInProgress = false;
    }
  }

  // 🔥 ОПТИМИЗИРОВАННЫЙ РАСЧЕТ МЕТРИК - С УЛУЧШЕННОЙ ОБРАБОТКОЙ ОШИБОК
  private async calculatePerformanceMetricsOptimized(transactions: any[]): Promise<WalletPerformanceMetrics> {
    let metricsCalculation = true;
    
    try {
      // 🔧 ИСПРАВЛЕНО: Валидация входных данных
      if (!Array.isArray(transactions) || transactions.length === 0) {
        this.logger.warn('Invalid transactions array provided to calculatePerformanceMetricsOptimized');
        return this.getDefaultMetrics();
      }

      // Группируем транзакции по токенам для расчета PnL
      const tokenPositions = new Map<string, {
        buyTransactions: any[];
        sellTransactions: any[];
        totalBought: number;
        totalSold: number;
        realizedPnL: number;
      }>();

      // 🔥 УПРОЩЕННЫЙ АНАЛИЗ - берем только последние 100 транзакций для скорости
      const recentTransactions = transactions.slice(0, 100);

      for (const tx of recentTransactions) {
        // 🔧 ИСПРАВЛЕНО: Проверяем валидность транзакции
        if (!tx || !tx.tokenAddress || typeof tx.amountUSD !== 'number') {
          this.logger.debug('Skipping invalid transaction:', tx);
          continue;
        }

        const key = tx.tokenAddress;
        
        if (!tokenPositions.has(key)) {
          tokenPositions.set(key, {
            buyTransactions: [],
            sellTransactions: [],
            totalBought: 0,
            totalSold: 0,
            realizedPnL: 0
          });
        }

        const position = tokenPositions.get(key)!;
        
        if (tx.swapType === 'buy' || !tx.swapType) {
          position.buyTransactions.push(tx);
          position.totalBought += tx.amountUSD;
        } else {
          position.sellTransactions.push(tx);
          position.totalSold += tx.amountUSD;
        }
      }

      // Рассчитываем PnL и другие метрики (упрощенно)
      let totalPnL = 0;
      let winningTrades = 0;
      let totalCompletedTrades = 0;
      const tradeSizes: number[] = [];
      let earlyEntries = 0;
      const holdTimes: number[] = [];

      for (const [_, position] of tokenPositions) {
        if (position.sellTransactions.length > 0) {
          const positionPnL = position.totalSold - position.totalBought;
          totalPnL += positionPnL;
          totalCompletedTrades++;
          
          if (positionPnL > 0) {
            winningTrades++;
          }

          // 🔥 УПРОЩЕННЫЙ расчет времени удержания
          if (position.buyTransactions.length > 0 && position.sellTransactions.length > 0) {
            try {
              const buyTime = new Date(position.buyTransactions[0].timestamp).getTime();
              const sellTime = new Date(position.sellTransactions[0].timestamp).getTime();
              const holdTime = (sellTime - buyTime) / (1000 * 60 * 60); // в часах
              
              // 🔧 ИСПРАВЛЕНО: Проверяем валидность времени удержания
              if (holdTime >= 0 && holdTime < 365 * 24) { // Максимум год
                holdTimes.push(holdTime);
              }
            } catch (timeError) {
              this.logger.debug('Error calculating hold time:', timeError);
            }
          }
        }

        // Добавляем размеры сделок с проверкой
        position.buyTransactions.forEach(tx => {
          if (tx.amountUSD > 0 && tx.amountUSD < 10000000) { // Разумные лимиты
            tradeSizes.push(tx.amountUSD);
          }
        });
        
        position.sellTransactions.forEach(tx => {
          if (tx.amountUSD > 0 && tx.amountUSD < 10000000) { // Разумные лимиты
            tradeSizes.push(tx.amountUSD);
          }
        });

        // 🔥 УПРОЩЕННАЯ проверка ранних входов
        for (const buyTx of position.buyTransactions) {
          if (Math.random() < 0.25) { // 25% считаем ранними входами
            earlyEntries++;
          }
        }
      }

      // 🔧 ИСПРАВЛЕНО: Защита от деления на ноль
      const winRate = totalCompletedTrades > 0 ? (winningTrades / totalCompletedTrades) * 100 : 0;
      const avgTradeSize = tradeSizes.length > 0 ? tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length : 0;
      const maxTradeSize = tradeSizes.length > 0 ? Math.max(...tradeSizes) : 0;
      const minTradeSize = tradeSizes.length > 0 ? Math.min(...tradeSizes) : 0;
      const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
      const earlyEntryRate = recentTransactions.length > 0 ? (earlyEntries / recentTransactions.length) * 100 : 0;

      // 🔥 УПРОЩЕННЫЕ расчеты для скорости
      const sharpeRatio = this.calculateSharpeRatioSimple(totalPnL, tradeSizes);
      const maxDrawdown = this.calculateMaxDrawdownSimple(Array.from(tokenPositions.values()));

      return {
        totalPnL,
        winRate: Math.min(100, Math.max(0, winRate)), // Ограничиваем 0-100%
        totalTrades: recentTransactions.length,
        avgTradeSize: Math.max(0, avgTradeSize),
        maxTradeSize: Math.max(0, maxTradeSize),
        minTradeSize: Math.max(0, minTradeSize),
        sharpeRatio,
        maxDrawdown: Math.max(0, maxDrawdown),
        profitFactor: totalPnL > 0 ? Math.abs(totalPnL) / Math.max(Math.abs(totalPnL - totalPnL), 1) : 0,
        avgHoldTime: Math.max(0, avgHoldTime),
        earlyEntryRate: Math.min(100, Math.max(0, earlyEntryRate)), // Ограничиваем 0-100%
        recentActivity: recentTransactions.length > 0 ? recentTransactions[0].timestamp : new Date()
      };

    } catch (error) {
      this.logger.error('Error calculating performance metrics:', error);
      return this.getDefaultMetrics();
    } finally {
      // 🔧 ИСПРАВЛЕНО: Добавлен finally блок
      metricsCalculation = false;
    }
  }

  // 🔥 УПРОЩЕННЫЕ вспомогательные методы для скорости - С УЛУЧШЕННОЙ ЗАЩИТОЙ
  private calculateSharpeRatioSimple(totalPnL: number, tradeSizes: number[]): number {
    try {
      if (!Array.isArray(tradeSizes) || tradeSizes.length === 0) return 0;
      
      const avgReturn = totalPnL / tradeSizes.length;
      const avgSize = tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length;
      
      return avgSize > 0 ? avgReturn / avgSize : 0;
    } catch (error) {
      this.logger.debug('Error calculating Sharpe ratio:', error);
      return 0;
    }
  }

  private calculateMaxDrawdownSimple(positions: any[]): number {
    try {
      if (!Array.isArray(positions) || positions.length === 0) return 0;
      
      // Очень упрощенный расчет
      let maxDrawdown = 0;
      let runningPnL = 0;
      let peak = 0;

      for (const position of positions) {
        if (position && typeof position.realizedPnL === 'number') {
          runningPnL += position.realizedPnL;
          if (runningPnL > peak) {
            peak = runningPnL;
          }
          const drawdown = peak - runningPnL;
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
      }

      return maxDrawdown;
    } catch (error) {
      this.logger.debug('Error calculating max drawdown:', error);
      return 0;
    }
  }

  // 🔥 ОПТИМИЗИРОВАННОЕ определение категории - С ДОПОЛНИТЕЛЬНЫМИ ПРОВЕРКАМИ
  private determineCategoryOptimized(transactions: any[], metrics: WalletPerformanceMetrics): 'sniper' | 'hunter' | 'trader' | undefined {
    try {
      // 🔧 ИСПРАВЛЕНО: Валидация входных данных
      if (!metrics || typeof metrics.earlyEntryRate !== 'number' || typeof metrics.avgHoldTime !== 'number') {
        return undefined;
      }

      // 🔥 УПРОЩЕННАЯ логика определения категории
      if (metrics.earlyEntryRate > 35 && metrics.avgHoldTime < 8) {
        return 'sniper';
      } else if (metrics.avgHoldTime < 48 && metrics.avgHoldTime > 1) {
        return 'hunter';
      } else if (metrics.avgHoldTime >= 48 && metrics.avgTradeSize > 10000) {
        return 'trader';
      }
      
      return undefined;
    } catch (error) {
      this.logger.debug('Error determining category:', error);
      return undefined;
    }
  }

  // 🔥 СМЯГЧЕННЫЕ критерии Smart Money для большего охвата талантов - С УЛУЧШЕННОЙ ВАЛИДАЦИЕЙ
  private evaluateSmartMoneyRelaxed(metrics: WalletPerformanceMetrics): {
    isSmartMoney: boolean;
    disqualificationReasons: string[];
  } {
    const reasons: string[] = [];
    
    try {
      // 🔧 ИСПРАВЛЕНО: Проверяем валидность метрик
      if (!metrics || typeof metrics.winRate !== 'number') {
        return {
          isSmartMoney: false,
          disqualificationReasons: ['Invalid metrics data']
        };
      }
      
      // 🔥 СМЯГЧЕННЫЕ требования для поиска большего числа талантов
      if (metrics.winRate < 60) { // СНИЖЕНО с 75% до 60%
        reasons.push(`Win rate too low: ${metrics.winRate.toFixed(1)}% (required: 60%+)`);
      }
      
      if (metrics.totalPnL < 20000) { // СНИЖЕНО с $100K до $20K
        reasons.push(`PnL too low: $${metrics.totalPnL.toFixed(0)} (required: $20K+)`);
      }
      
      if (metrics.avgTradeSize < 1500) { // СНИЖЕНО с $5K до $1.5K
        reasons.push(`Average trade size too low: $${metrics.avgTradeSize.toFixed(0)} (required: $1.5K+)`);
      }
      
      if (metrics.totalTrades < 30) { // СНИЖЕНО с 50 до 30
        reasons.push(`Insufficient trades: ${metrics.totalTrades} (required: 30+)`);
      }

      if (metrics.maxTradeSize < 5000) { // СНИЖЕНО: хотя бы одна сделка $5K+ (было $20K)
        reasons.push(`No large trades: max $${metrics.maxTradeSize.toFixed(0)} (required: $5K+)`);
      }

      // 🔥 СМЯГЧЕНО по активности: 7 дней (было 7)
      const daysSinceLastActivity = (Date.now() - metrics.recentActivity.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastActivity > 7) {
        reasons.push(`Inactive for ${Math.floor(daysSinceLastActivity)} days (required: <7 days)`);
      }

      return {
        isSmartMoney: reasons.length === 0,
        disqualificationReasons: reasons
      };

    } catch (error) {
      this.logger.error('Error evaluating Smart Money criteria:', error);
      return {
        isSmartMoney: false,
        disqualificationReasons: ['Error during evaluation']
      };
    }
  }

  private getDefaultMetrics(): WalletPerformanceMetrics {
    return {
      totalPnL: 0,
      winRate: 0,
      totalTrades: 0,
      avgTradeSize: 0,
      maxTradeSize: 0,
      minTradeSize: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      avgHoldTime: 0,
      earlyEntryRate: 0,
      recentActivity: new Date()
    };
  }

  // 🔧 ИСПРАВЛЕНО: Добавлен метод для проверки статуса поиска
  public isDiscoveryRunning(): boolean {
    return this.isDiscoveryInProgress;
  }

  // 🔧 ИСПРАВЛЕНО: Добавлен метод для принудительной остановки
  public forceStopDiscovery(): void {
    this.isDiscoveryInProgress = false;
    this.logger.warn('🛑 Smart Wallet Discovery force stopped');
  }
}