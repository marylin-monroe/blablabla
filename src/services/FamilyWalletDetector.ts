// src/services/FamilyWalletDetector.ts
/*import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { Database } from './Database';
import { Logger } from '../utils/Logger';
import { FamilyWalletCluster, SmartMoneyWallet, WalletPerformanceMetrics } from '../types';

interface SuspiciousPattern {
  wallets: string[];
  detectionMethod: string;
  score: number;
  evidence: any;
}

interface TimingAnalysis {
  wallet1: string;
  wallet2: string;
  tokenAddress: string;
  simultaneousCount: number;
  avgTimeDiff: number;
  maxTimeDiff: number;
}

interface FundingChain {
  fromWallet: string;
  toWallet: string;
  amount: number;
  fundingTime: Date;
  firstTradeTime: Date;
  minutesToTrade: number;
}

export class FamilyWalletDetector {
  private smDatabase: SmartMoneyDatabase;
  private mainDatabase: Database;
  private logger: Logger;

  constructor(smDatabase: SmartMoneyDatabase, mainDatabase: Database) {
    this.smDatabase = smDatabase;
    this.mainDatabase = mainDatabase;
    this.logger = Logger.getInstance();
  }

  // Главный метод детекции семейных кошельков
  async detectFamilyWallets(): Promise<FamilyWalletCluster[]> {
    this.logger.info('🕵️ Starting family wallet detection...');
    
    const clusters: FamilyWalletCluster[] = [];
    
    // 1. Детекция по синхронным транзакциям (самый сильный сигнал)
    const timingClusters = await this.detectTimingSimilarity();
    clusters.push(...timingClusters);
    
    // 2. Детекция по цепочкам финансирования
    const fundingClusters = await this.detectFundingChains();
    clusters.push(...fundingClusters);
    
    // 3. Детекция по зеркальным портфелям
    const mirrorClusters = await this.detectMirrorTrading();
    clusters.push(...mirrorClusters);
    
    // 4. Детекция по координированным дампам
    const dumpClusters = await this.detectCoordinatedDumps();
    clusters.push(...dumpClusters);
    
    // 5. Объединяем пересекающиеся кластеры
    const mergedClusters = this.mergeClusters(clusters);
    
    // 6. Фильтруем по минимальному score
    const validClusters = mergedClusters.filter(cluster => cluster.suspicionScore >= 75);
    
    this.logger.info(`🎯 Found ${validClusters.length} family wallet clusters`);
    
    // Сохраняем в базу
    for (const cluster of validClusters) {
      await this.smDatabase.saveFamilyCluster(cluster);
    }
    
    return validClusters;
  }

  // 1. Детекция по синхронным транзакциям
  private async detectTimingSimilarity(): Promise<FamilyWalletCluster[]> {
    this.logger.info('⏰ Detecting timing similarity...');
    
    const clusters: FamilyWalletCluster[] = [];
    const timeWindows = [30, 60, 120, 300]; // секунды
    
    for (const windowSeconds of timeWindows) {
      // Ищем транзакции в одном временном окне
      const recentTxs = await this.mainDatabase.getRecentTransactions(24 * 7); // неделя
      
      // Группируем по токенам и временным окнам
      const timingGroups = new Map<string, Map<number, any[]>>();
      
      for (const tx of recentTxs) {
        if (tx.amountUSD < 1000) continue; // только значимые транзакции
        
        const tokenKey = tx.tokenAddress;
        const timeSlot = Math.floor(new Date(tx.timestamp).getTime() / (windowSeconds * 1000));
        
        if (!timingGroups.has(tokenKey)) {
          timingGroups.set(tokenKey, new Map());
        }
        
        const tokenGroup = timingGroups.get(tokenKey)!;
        if (!tokenGroup.has(timeSlot)) {
          tokenGroup.set(timeSlot, []);
        }
        
        tokenGroup.get(timeSlot)!.push(tx);
      }
      
      // Анализируем группы с множественными кошельками
      for (const [tokenAddress, timeSlots] of timingGroups) {
        for (const [timeSlot, transactions] of timeSlots) {
          if (transactions.length >= 2) {
            const wallets = [...new Set(transactions.map(tx => tx.walletAddress))];
            
            if (wallets.length >= 2) {
              const cluster = await this.createTimingCluster(
                wallets, 
                tokenAddress, 
                transactions, 
                windowSeconds
              );
              
              if (cluster.suspicionScore >= 60) {
                clusters.push(cluster);
              }
            }
          }
        }
      }
    }
    
    return this.deduplicateClusters(clusters);
  }

  // 2. Детекция цепочек финансирования
  private async detectFundingChains(): Promise<FamilyWalletCluster[]> {
    this.logger.info('💰 Detecting funding chains...');
    
    const clusters: FamilyWalletCluster[] = [];
    
    // Ищем паттерны: Кошелек А -> финансирует -> Кошелек Б -> торгует
    // Это требует анализа нативных трансферов, которые мы пока не отслеживаем
    // Упрощенная версия: ищем кошельки с одинаковыми первыми токенами
    
    const recentTxs = await this.mainDatabase.getRecentTransactions(24 * 14); // 2 недели
    const walletFirstTokens = new Map<string, { token: string; timestamp: Date; amount: number }>();
    
    // Находим первую сделку каждого кошелька
    for (const tx of recentTxs) {
      const wallet = tx.walletAddress;
      const txTime = new Date(tx.timestamp);
      
      if (!walletFirstTokens.has(wallet) || 
          txTime < walletFirstTokens.get(wallet)!.timestamp) {
        walletFirstTokens.set(wallet, {
          token: tx.tokenAddress,
          timestamp: txTime,
          amount: tx.amountUSD
        });
      }
    }
    
    // Группируем кошельки по первому токену
    const tokenGroups = new Map<string, string[]>();
    
    for (const [wallet, firstTrade] of walletFirstTokens) {
      const token = firstTrade.token;
      
      if (!tokenGroups.has(token)) {
        tokenGroups.set(token, []);
      }
      
      tokenGroups.get(token)!.push(wallet);
    }
    
    // Анализируем группы с подозрительно одинаковыми первыми покупками
    for (const [tokenAddress, wallets] of tokenGroups) {
      if (wallets.length >= 2) {
        const firstTrades = wallets.map(w => walletFirstTokens.get(w)!);
        
        // Проверяем, покупали ли они в течение короткого времени
        const timestamps = firstTrades.map(t => t.timestamp.getTime());
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        const timeDiff = (maxTime - minTime) / (1000 * 60); // минуты
        
        if (timeDiff <= 60) { // в течение часа
          const cluster = await this.createFundingCluster(wallets, tokenAddress, firstTrades);
          
          if (cluster.suspicionScore >= 65) {
            clusters.push(cluster);
          }
        }
      }
    }
    
    return clusters;
  }

  // 3. Детекция зеркальной торговли
  private async detectMirrorTrading(): Promise<FamilyWalletCluster[]> {
    this.logger.info('🪞 Detecting mirror trading...');
    
    const clusters: FamilyWalletCluster[] = [];
    const recentTxs = await this.mainDatabase.getRecentTransactions(24 * 30); // месяц
    
    // Создаем портфели кошельков
    const walletPortfolios = new Map<string, Map<string, number>>();
    
    for (const tx of recentTxs) {
      if (tx.amountUSD < 500) continue;
      
      const wallet = tx.walletAddress;
      const token = tx.tokenAddress;
      
      if (!walletPortfolios.has(wallet)) {
        walletPortfolios.set(wallet, new Map());
      }
      
      const portfolio = walletPortfolios.get(wallet)!;
      const currentAmount = portfolio.get(token) || 0;
      
      if (tx.swapType === 'buy') {
        portfolio.set(token, currentAmount + tx.amountUSD);
      } else {
        portfolio.set(token, currentAmount - tx.amountUSD);
      }
    }
    
    // Сравниваем портфели между собой
    const wallets = Array.from(walletPortfolios.keys());
    
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const wallet1 = wallets[i];
        const wallet2 = wallets[j];
        
        const similarity = this.calculatePortfolioSimilarity(
          walletPortfolios.get(wallet1)!,
          walletPortfolios.get(wallet2)!
        );
        
        if (similarity.score >= 0.8 && similarity.commonTokens >= 5) {
          const cluster = await this.createMirrorCluster([wallet1, wallet2], similarity);
          
          if (cluster.suspicionScore >= 70) {
            clusters.push(cluster);
          }
        }
      }
    }
    
    return this.deduplicateClusters(clusters);
  }

  // 4. Детекция координированных дампов
  private async detectCoordinatedDumps(): Promise<FamilyWalletCluster[]> {
    this.logger.info('📉 Detecting coordinated dumps...');
    
    const clusters: FamilyWalletCluster[] = [];
    const recentTxs = await this.mainDatabase.getRecentTransactions(24 * 7); // неделя
    
    // Группируем продажи по токенам и времени
    const sellGroups = new Map<string, any[]>();
    
    for (const tx of recentTxs) {
      if (tx.swapType !== 'sell' || tx.amountUSD < 2000) continue;
      
      const token = tx.tokenAddress;
      
      if (!sellGroups.has(token)) {
        sellGroups.set(token, []);
      }
      
      sellGroups.get(token)!.push(tx);
    }
    
    // Анализируем координированные продажи
    for (const [tokenAddress, sells] of sellGroups) {
      if (sells.length < 3) continue;
      
      // Сортируем по времени
      sells.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Ищем кластеры продаж в короткие временные окна
      const timeWindow = 30 * 60 * 1000; // 30 минут
      
      for (let i = 0; i < sells.length; i++) {
        const windowSells = [];
        const startTime = new Date(sells[i].timestamp).getTime();
        
        for (let j = i; j < sells.length; j++) {
          const sellTime = new Date(sells[j].timestamp).getTime();
          
          if (sellTime <= startTime + timeWindow) {
            windowSells.push(sells[j]);
          } else {
            break;
          }
        }
        
        if (windowSells.length >= 3) {
          const wallets = [...new Set(windowSells.map(s => s.walletAddress))];
          
          if (wallets.length >= 2) {
            const cluster = await this.createDumpCluster(wallets, tokenAddress, windowSells);
            
            if (cluster.suspicionScore >= 75) {
              clusters.push(cluster);
            }
          }
        }
      }
    }
    
    return this.deduplicateClusters(clusters);
  }

  // Создание кластера на основе синхронности
  private async createTimingCluster(
    wallets: string[], 
    tokenAddress: string, 
    transactions: any[], 
    windowSeconds: number
  ): Promise<FamilyWalletCluster> {
    const timestamps = transactions.map(tx => new Date(tx.timestamp).getTime());
    const avgTimingDiff = this.calculateAvgTimingDiff(timestamps);
    
    // Базовый score за синхронность
    let suspicionScore = 40;
    
    // Бонусы
    if (avgTimingDiff < 60000) suspicionScore += 25; // < 1 минуты = +25
    if (avgTimingDiff < 30000) suspicionScore += 15; // < 30 секунд = +15
    if (wallets.length >= 3) suspicionScore += 10; // 3+ кошелька = +10
    if (windowSeconds <= 60) suspicionScore += 10; // очень маленькое окно = +10
    
    const totalVolume = transactions.reduce((sum, tx) => sum + tx.amountUSD, 0);
    const avgVolume = totalVolume / transactions.length;
    
    // Анализ сумм транзакций
    const amounts = transactions.map(tx => tx.amountUSD);
    const amountSimilarity = this.calculateAmountSimilarity(amounts);
    if (amountSimilarity > 0.8) suspicionScore += 15;
    
    return {
      id: this.generateClusterId(),
      wallets,
      suspicionScore: Math.min(suspicionScore, 100),
      coordinationScore: this.calculateCoordinationScore(transactions),
      detectionMethods: ['timing_similarity'],
      totalPnL: 0, // TODO: вычислить комбинированный PnL
      combinedVolume: totalVolume,
      avgTimingDiff,
      commonTokens: [tokenAddress],
      createdAt: new Date()
    };
  }

  // Создание кластера финансирования
  private async createFundingCluster(
    wallets: string[], 
    tokenAddress: string, 
    firstTrades: any[]
  ): Promise<FamilyWalletCluster> {
    let suspicionScore = 50;
    
    // Анализ временных интервалов
    const timestamps = firstTrades.map(t => t.timestamp.getTime());
    const avgTimingDiff = this.calculateAvgTimingDiff(timestamps);
    
    if (avgTimingDiff < 10 * 60 * 1000) suspicionScore += 20; // < 10 минут
    if (avgTimingDiff < 5 * 60 * 1000) suspicionScore += 15; // < 5 минут
    
    // Анализ сумм
    const amounts = firstTrades.map(t => t.amount);
    const amountSimilarity = this.calculateAmountSimilarity(amounts);
    if (amountSimilarity > 0.7) suspicionScore += 15;
    
    return {
      id: this.generateClusterId(),
      wallets,
      suspicionScore: Math.min(suspicionScore, 100),
      coordinationScore: amountSimilarity * 100,
      detectionMethods: ['funding_pattern'],
      totalPnL: 0,
      combinedVolume: amounts.reduce((a, b) => a + b, 0),
      avgTimingDiff,
      commonTokens: [tokenAddress],
      createdAt: new Date()
    };
  }

  // Создание зеркального кластера
  private async createMirrorCluster(wallets: string[], similarity: any): Promise<FamilyWalletCluster> {
    let suspicionScore = 60;
    
    // Чем больше сходство, тем выше score
    suspicionScore += similarity.score * 30;
    
    // Бонус за количество общих токенов
    if (similarity.commonTokens >= 8) suspicionScore += 10;
    if (similarity.commonTokens >= 12) suspicionScore += 10;
    
    return {
      id: this.generateClusterId(),
      wallets,
      suspicionScore: Math.min(suspicionScore, 100),
      coordinationScore: similarity.score * 100,
      detectionMethods: ['mirror_trading'],
      totalPnL: 0,
      combinedVolume: similarity.totalVolume || 0,
      avgTimingDiff: 0,
      commonTokens: similarity.tokens || [],
      createdAt: new Date()
    };
  }

  // Создание кластера координированного дампа
  private async createDumpCluster(
    wallets: string[], 
    tokenAddress: string, 
    sells: any[]
  ): Promise<FamilyWalletCluster> {
    let suspicionScore = 70; // высокий базовый score для координированных дампов
    
    const totalVolume = sells.reduce((sum, s) => sum + s.amountUSD, 0);
    const avgVolume = totalVolume / sells.length;
    
    // Бонусы
    if (avgVolume > 10000) suspicionScore += 10; // крупные дампы
    if (wallets.length >= 4) suspicionScore += 10; // много участников
    
    const timestamps = sells.map(s => new Date(s.timestamp).getTime());
    const avgTimingDiff = this.calculateAvgTimingDiff(timestamps);
    
    return {
      id: this.generateClusterId(),
      wallets,
      suspicionScore: Math.min(suspicionScore, 100),
      coordinationScore: 90, // дампы всегда очень координированы
      detectionMethods: ['coordinated_dump'],
      totalPnL: 0,
      combinedVolume: totalVolume,
      avgTimingDiff,
      commonTokens: [tokenAddress],
      createdAt: new Date()
    };
  }

  // Вспомогательные методы
  private calculateAvgTimingDiff(timestamps: number[]): number {
    if (timestamps.length < 2) return 0;
    
    timestamps.sort((a, b) => a - b);
    let totalDiff = 0;
    
    for (let i = 1; i < timestamps.length; i++) {
      totalDiff += timestamps[i] - timestamps[i - 1];
    }
    
    return totalDiff / (timestamps.length - 1);
  }

  private calculateAmountSimilarity(amounts: number[]): number {
    if (amounts.length < 2) return 0;
    
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, amount) => sum + Math.pow(amount - avg, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const coefficient = stdDev / avg;
    
    // Возвращаем инвертированный коэффициент вариации (чем меньше разброс, тем выше сходство)
    return Math.max(0, 1 - coefficient);
  }

  private calculatePortfolioSimilarity(portfolio1: Map<string, number>, portfolio2: Map<string, number>): any {
    const tokens1 = new Set(portfolio1.keys());
    const tokens2 = new Set(portfolio2.keys());
    const commonTokens = new Set([...tokens1].filter(x => tokens2.has(x)));
    
    if (commonTokens.size === 0) {
      return { score: 0, commonTokens: 0, tokens: [] };
    }
    
    let totalSimilarity = 0;
    let totalVolume = 0;
    
    for (const token of commonTokens) {
      const amount1 = portfolio1.get(token) || 0;
      const amount2 = portfolio2.get(token) || 0;
      
      if (amount1 > 0 && amount2 > 0) {
        const ratio = Math.min(amount1, amount2) / Math.max(amount1, amount2);
        totalSimilarity += ratio;
        totalVolume += amount1 + amount2;
      }
    }
    
    const avgSimilarity = totalSimilarity / commonTokens.size;
    
    return {
      score: avgSimilarity,
      commonTokens: commonTokens.size,
      tokens: Array.from(commonTokens),
      totalVolume
    };
  }

  private calculateCoordinationScore(transactions: any[]): number {
    // Простой расчет координации на основе временной синхронности
    const timestamps = transactions.map(tx => new Date(tx.timestamp).getTime());
    const avgDiff = this.calculateAvgTimingDiff(timestamps);
    
    // Чем меньше разброс во времени, тем выше координация
    const maxDiff = 5 * 60 * 1000; // 5 минут
    return Math.max(0, (maxDiff - avgDiff) / maxDiff * 100);
  }

  private mergeClusters(clusters: FamilyWalletCluster[]): FamilyWalletCluster[] {
    // Объединяем кластеры с пересекающимися кошельками
    const merged: FamilyWalletCluster[] = [];
    const processed = new Set<string>();
    
    for (const cluster of clusters) {
      if (processed.has(cluster.id)) continue;
      
      let mergedCluster = { ...cluster };
      processed.add(cluster.id);
      
      // Ищем пересекающиеся кластеры
      for (const otherCluster of clusters) {
        if (processed.has(otherCluster.id)) continue;
        
        const hasOverlap = mergedCluster.wallets.some((w: string) => otherCluster.wallets.includes(w));
        
        if (hasOverlap) {
          // Объединяем кластеры
          mergedCluster = this.combineCluster(mergedCluster, otherCluster);
          processed.add(otherCluster.id);
        }
      }
      
      merged.push(mergedCluster);
    }
    
    return merged;
  }

  private combineCluster(cluster1: FamilyWalletCluster, cluster2: FamilyWalletCluster): FamilyWalletCluster {
    const combinedWallets = [...new Set([...cluster1.wallets, ...cluster2.wallets])];
    const combinedMethods = [...new Set([...cluster1.detectionMethods, ...cluster2.detectionMethods])];
    const combinedTokens = [...new Set([...cluster1.commonTokens, ...cluster2.commonTokens])];
    
    return {
      id: this.generateClusterId(),
      wallets: combinedWallets,
      suspicionScore: Math.max(cluster1.suspicionScore, cluster2.suspicionScore),
      coordinationScore: (cluster1.coordinationScore + cluster2.coordinationScore) / 2,
      detectionMethods: combinedMethods,
      totalPnL: cluster1.totalPnL + cluster2.totalPnL,
      combinedVolume: cluster1.combinedVolume + cluster2.combinedVolume,
      avgTimingDiff: (cluster1.avgTimingDiff + cluster2.avgTimingDiff) / 2,
      commonTokens: combinedTokens,
      createdAt: new Date()
    };
  }

  private deduplicateClusters(clusters: FamilyWalletCluster[]): FamilyWalletCluster[] {
    const unique: FamilyWalletCluster[] = [];
    const seen = new Set<string>();
    
    for (const cluster of clusters) {
      const signature = cluster.wallets.sort().join(',');
      
      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(cluster);
      }
    }
    
    return unique;
  }

  private generateClusterId(): string {
    return `family_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
} */