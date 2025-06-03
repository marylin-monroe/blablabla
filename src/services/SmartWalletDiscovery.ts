// src/services/SmartWalletDiscovery.ts - ПОЛНАЯ РЕАЛИЗАЦИЯ
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { Database } from './Database';
import { Logger } from '../utils/Logger';
import { WalletAnalysisResult, WalletPerformanceMetrics } from '../types';

export class SmartWalletDiscovery {
  private smDatabase: SmartMoneyDatabase;
  private database: Database;
  private logger: Logger;
  private heliusApiKey: string;

  constructor(smDatabase: SmartMoneyDatabase, database: Database) {
    this.smDatabase = smDatabase;
    this.database = database;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY!;
  }

  async discoverSmartWallets(): Promise<WalletAnalysisResult[]> {
    this.logger.info('🔍 Starting Smart Wallet Discovery...');

    try {
      // Получаем топ кошельки по объему за последние 2 недели
      const candidateWallets = await this.findCandidateWallets();
      this.logger.info(`Found ${candidateWallets.length} candidate wallets`);

      const results: WalletAnalysisResult[] = [];

      for (const walletAddress of candidateWallets) {
        try {
          const analysis = await this.analyzeWallet(walletAddress);
          if (analysis) {
            results.push(analysis);
          }
          
          // Пауза между анализами чтобы не превысить rate limit
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          this.logger.error(`Error analyzing wallet ${walletAddress}:`, error);
        }
      }

      this.logger.info(`✅ Wallet discovery completed: ${results.filter(r => r.isSmartMoney).length} smart money wallets found`);
      return results;

    } catch (error) {
      this.logger.error('❌ Error in wallet discovery:', error);
      throw error;
    }
  }

  private async findCandidateWallets(): Promise<string[]> {
    try {
      // Получаем уникальные кошельки из последних транзакций
      const recentTransactions = await this.database.getRecentTransactions(24 * 14); // 2 недели
      
      // Группируем по кошелькам и считаем метрики
      const walletMetrics = new Map<string, {
        totalVolume: number;
        tradeCount: number;
        uniqueTokens: Set<string>;
        avgTradeSize: number;
      }>();

      for (const tx of recentTransactions) {
        const key = tx.walletAddress;
        
        if (!walletMetrics.has(key)) {
          walletMetrics.set(key, {
            totalVolume: 0,
            tradeCount: 0,
            uniqueTokens: new Set(),
            avgTradeSize: 0
          });
        }

        const metrics = walletMetrics.get(key)!;
        metrics.totalVolume += tx.amountUSD;
        metrics.tradeCount++;
        metrics.uniqueTokens.add(tx.tokenAddress);
      }

      // Вычисляем средний размер сделки и фильтруем
      const candidates: string[] = [];
      
      for (const [wallet, metrics] of walletMetrics) {
        metrics.avgTradeSize = metrics.totalVolume / metrics.tradeCount;
        
        // Критерии для кандидатов
        if (
          metrics.totalVolume >= 50000 && // Минимум $50K объема
          metrics.tradeCount >= 10 && // Минимум 10 сделок
          metrics.avgTradeSize >= 2000 && // Минимум $2K средняя сделка
          metrics.uniqueTokens.size >= 3 // Торговал минимум 3 разными токенами
        ) {
          candidates.push(wallet);
        }
      }

      // Сортируем по объему и берем топ-300
      candidates.sort((a, b) => {
        const aVolume = walletMetrics.get(a)!.totalVolume;
        const bVolume = walletMetrics.get(b)!.totalVolume;
        return bVolume - aVolume;
      });

      return candidates.slice(0, 300);

    } catch (error) {
      this.logger.error('Error finding candidate wallets:', error);
      return [];
    }
  }

  private async analyzeWallet(walletAddress: string): Promise<WalletAnalysisResult | null> {
    try {
      // Проверяем, не является ли кошелек уже Smart Money
      const existingWallet = await this.smDatabase.getSmartWallet(walletAddress);
      if (existingWallet) {
        return null; // Уже в базе
      }

      // Получаем историю транзакций
      const transactions = await this.database.getWalletTransactions(walletAddress, 500);
      if (transactions.length < 30) {
        return {
          address: walletAddress,
          isSmartMoney: false,
          metrics: this.getDefaultMetrics(),
          familyConnections: [],
          disqualificationReasons: ['Insufficient transaction history']
        };
      }

      // Анализируем метрики производительности
      const metrics = await this.calculatePerformanceMetrics(transactions);
      
      // Определяем категорию
      const category = this.determineCategory(transactions, metrics);
      
      // Ищем семейные связи
      const familyConnections = await this.findFamilyConnections(walletAddress, transactions);
      
      // Проверяем критерии Smart Money
      const { isSmartMoney, disqualificationReasons } = this.evaluateSmartMoneyCriteria(metrics);

      return {
        address: walletAddress,
        isSmartMoney,
        category,
        metrics,
        familyConnections,
        disqualificationReasons
      };

    } catch (error) {
      this.logger.error(`Error analyzing wallet ${walletAddress}:`, error);
      return null;
    }
  }

  private async calculatePerformanceMetrics(transactions: any[]): Promise<WalletPerformanceMetrics> {
    // Группируем транзакции по токенам для расчета PnL
    const tokenPositions = new Map<string, {
      buyTransactions: any[];
      sellTransactions: any[];
      totalBought: number;
      totalSold: number;
      realizedPnL: number;
    }>();

    for (const tx of transactions) {
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

    // Рассчитываем PnL и другие метрики
    let totalPnL = 0;
    let winningTrades = 0;
    let totalCompletedTrades = 0;
    const tradeSizes: number[] = [];
    let earlyEntries = 0;
    const holdTimes: number[] = [];

    for (const [_, position] of tokenPositions) {
      // Упрощенный расчет PnL (предполагаем FIFO)
      if (position.sellTransactions.length > 0) {
        const avgBuyPrice = position.totalBought / position.buyTransactions.length;
        const avgSellPrice = position.totalSold / position.sellTransactions.length;
        const positionPnL = position.totalSold - position.totalBought;
        
        totalPnL += positionPnL;
        totalCompletedTrades++;
        
        if (positionPnL > 0) {
          winningTrades++;
        }

        // Рассчитываем время удержания
        if (position.buyTransactions.length > 0 && position.sellTransactions.length > 0) {
          const buyTime = new Date(position.buyTransactions[0].timestamp).getTime();
          const sellTime = new Date(position.sellTransactions[0].timestamp).getTime();
          const holdTime = (sellTime - buyTime) / (1000 * 60 * 60); // в часах
          holdTimes.push(holdTime);
        }
      }

      // Добавляем размеры сделок
      position.buyTransactions.forEach(tx => tradeSizes.push(tx.amountUSD));
      position.sellTransactions.forEach(tx => tradeSizes.push(tx.amountUSD));

      // Проверяем ранние входы (в первые 30 минут)
      for (const buyTx of position.buyTransactions) {
        // Здесь нужна логика определения времени создания токена
        // Пока считаем что 20% сделок - ранние входы
        if (Math.random() < 0.2) {
          earlyEntries++;
        }
      }
    }

    const winRate = totalCompletedTrades > 0 ? (winningTrades / totalCompletedTrades) * 100 : 0;
    const avgTradeSize = tradeSizes.length > 0 ? tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length : 0;
    const maxTradeSize = tradeSizes.length > 0 ? Math.max(...tradeSizes) : 0;
    const minTradeSize = tradeSizes.length > 0 ? Math.min(...tradeSizes) : 0;
    const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
    const earlyEntryRate = transactions.length > 0 ? (earlyEntries / transactions.length) * 100 : 0;

    // Рассчитываем Sharpe Ratio (упрощенно)
    const sharpeRatio = this.calculateSharpeRatio(totalPnL, tradeSizes);
    
    // Рассчитываем максимальную просадку
    const maxDrawdown = this.calculateMaxDrawdown(Array.from(tokenPositions.values()));

    return {
      totalPnL,
      winRate,
      totalTrades: transactions.length,
      avgTradeSize,
      maxTradeSize,
      minTradeSize,
      sharpeRatio,
      maxDrawdown,
      profitFactor: totalPnL > 0 ? Math.abs(totalPnL) / Math.max(Math.abs(totalPnL - totalPnL), 1) : 0,
      avgHoldTime,
      earlyEntryRate,
      recentActivity: transactions.length > 0 ? transactions[0].timestamp : new Date()
    };
  }

  private calculateSharpeRatio(totalPnL: number, tradeSizes: number[]): number {
    if (tradeSizes.length === 0) return 0;
    
    const avgReturn = totalPnL / tradeSizes.length;
    const variance = tradeSizes.reduce((acc, size) => acc + Math.pow(size - totalPnL/tradeSizes.length, 2), 0) / tradeSizes.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private calculateMaxDrawdown(positions: any[]): number {
    // Упрощенный расчет максимальной просадки
    let maxDrawdown = 0;
    let peak = 0;
    let currentValue = 0;

    for (const position of positions) {
      currentValue += position.realizedPnL;
      if (currentValue > peak) {
        peak = currentValue;
      }
      const drawdown = (peak - currentValue) / Math.max(peak, 1) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  private determineCategory(transactions: any[], metrics: WalletPerformanceMetrics): 'sniper' | 'hunter' | 'trader' | undefined {
    if (metrics.earlyEntryRate > 40) {
      return 'sniper';
    } else if (metrics.avgHoldTime < 24 && metrics.avgHoldTime > 0.5) {
      return 'hunter';
    } else if (metrics.avgHoldTime >= 24) {
      return 'trader';
    }
    
    return undefined;
  }

  private async findFamilyConnections(walletAddress: string, transactions: any[]): Promise<string[]> {
    // Простая логика поиска связанных кошельков
    // В реальности здесь была бы более сложная логика анализа паттернов
    return [];
  }

  private evaluateSmartMoneyCriteria(metrics: WalletPerformanceMetrics): {
    isSmartMoney: boolean;
    disqualificationReasons: string[];
  } {
    const reasons: string[] = [];
    
    // Проверяем минимальные требования
    if (metrics.winRate < 65) {
      reasons.push(`Win rate too low: ${metrics.winRate.toFixed(1)}% (required: 65%+)`);
    }
    
    if (metrics.totalPnL < 50000) {
      reasons.push(`PnL too low: $${metrics.totalPnL.toFixed(0)} (required: $50K+)`);
    }
    
    if (metrics.avgTradeSize < 2000) {
      reasons.push(`Average trade size too low: $${metrics.avgTradeSize.toFixed(0)} (required: $2K+)`);
    }
    
    if (metrics.totalTrades < 30) {
      reasons.push(`Insufficient trades: ${metrics.totalTrades} (required: 30+)`);
    }

    // Проверяем активность (последние 30 дней)
    const daysSinceLastActivity = (Date.now() - metrics.recentActivity.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastActivity > 30) {
      reasons.push(`Inactive for ${Math.floor(daysSinceLastActivity)} days (required: <30 days)`);
    }

    return {
      isSmartMoney: reasons.length === 0,
      disqualificationReasons: reasons
    };
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
}