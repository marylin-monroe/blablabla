// src/services/SolanaMonitor.ts
import axios from 'axios';
import { Database } from './Database';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';
import { 
  TokenSwap, 
  WalletInfo, 
  TokenAggregation, 
  SmartMoneyReport, 
  InsiderAlert,
  TradingHistory,
  HeliusTransaction 
} from '../types';

export class SolanaMonitor {
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  private heliusApiKey: string;
  private minTransactionUSD: number;
  private bigOrderThreshold: number;
  private knownExchanges: Set<string> = new Set();

  constructor(database: Database, telegramNotifier: TelegramNotifier) {
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY!;
    this.minTransactionUSD = parseInt(process.env.MIN_TRANSACTION_USD || '1500');
    this.bigOrderThreshold = parseInt(process.env.BIG_ORDER_THRESHOLD || '10000');
    
    this.initializeKnownExchanges();
  }

  private initializeKnownExchanges(): void {
    // Известные адреса бирж для фильтрации
    this.knownExchanges.add('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
    this.knownExchanges.add('AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2');
  }

  async checkForNewWalletActivity(): Promise<void> {
    try {
      if (process.env.ENABLE_CYCLE_LOGS === 'true') {
        this.logger.info('🤖 Starting 3h analysis...');
        await this.telegramNotifier.sendCycleLog('🤖 Starting 3h smart money analysis...');
      }

      // Получаем последние транзакции свапов
      const recentTransactions = await this.getRecentSwapTransactions();
      
      this.logger.info(`Found ${recentTransactions.length} recent swap transactions`);

      const tokenAggregations = new Map<string, TokenAggregation>();
      const bigOrders: TokenSwap[] = [];
      const insiderAlerts: InsiderAlert[] = [];
      const individualPurchases: TokenSwap[] = [];

      // Обрабатываем каждую транзакцию ПОСЛЕДОВАТЕЛЬНО (без p-queue)
      for (const tx of recentTransactions) {
        try {
          const result = await this.processTransaction(tx);
          
          if (result && result.swap) {
            // Фильтруем по минимальной сумме
            if (result.swap.amountUSD >= this.minTransactionUSD) {
              
              // Добавляем в индивидуальные покупки для ЧАСТИ 1
              individualPurchases.push(result.swap);

              // Анализ на инсайдера
              const insiderAnalysis = await this.analyzeForInsider(result.swap, result.walletInfo);
              if (insiderAnalysis) {
                insiderAlerts.push(insiderAnalysis);
              }

              // Агрегация по токенам для ЧАСТИ 2
              const key = result.swap.tokenAddress;
              if (!tokenAggregations.has(key)) {
                tokenAggregations.set(key, {
                  tokenAddress: result.swap.tokenAddress,
                  tokenSymbol: result.swap.tokenSymbol,
                  tokenName: result.swap.tokenName,
                  totalVolumeUSD: 0,
                  uniqueWallets: new Set(),
                  transactions: [],
                  isNewToken: result.tokenIsNew,
                  firstPurchaseTime: result.swap.timestamp,
                  lastPurchaseTime: result.swap.timestamp,
                  avgWalletAge: 0,
                  suspiciousWallets: 0,
                });
              }

              const agg = tokenAggregations.get(key)!;
              agg.totalVolumeUSD += result.swap.amountUSD;
              agg.uniqueWallets.add(result.swap.walletAddress);
              agg.transactions.push(result.swap);
              
              if (result.swap.timestamp < agg.firstPurchaseTime) {
                agg.firstPurchaseTime = result.swap.timestamp;
              }
              if (result.swap.timestamp > agg.lastPurchaseTime) {
                agg.lastPurchaseTime = result.swap.timestamp;
              }

              if (!agg.biggestPurchase || result.swap.amountUSD > agg.biggestPurchase.amountUSD) {
                agg.biggestPurchase = result.swap;
              }

              // Подсчет подозрительных кошельков
              if (result.walletInfo.suspicionScore && result.walletInfo.suspicionScore > 15) {
                agg.suspiciousWallets++;
              }

              // Крупные ордера
              if (result.swap.amountUSD >= this.bigOrderThreshold) {
                bigOrders.push(result.swap);
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error processing transaction ${tx.signature}:`, errorMessage);
        }
      }

      // ЧАСТЬ 1: Отправляем индивидуальные покупки
      const validPurchases = individualPurchases
        .sort((a, b) => b.amountUSD - a.amountUSD)
        .slice(0, 10); // Топ-10 покупок

      for (const purchase of validPurchases) {
        await this.telegramNotifier.sendIndividualPurchase(purchase);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза между сообщениями
      }

      // ЧАСТЬ 2: Агрегированный отчет
      const report: SmartMoneyReport = {
        period: `${process.env.AGGREGATION_PERIOD_HOURS || '3'} hours`,
        tokenAggregations: Array.from(tokenAggregations.values())
          .filter(agg => agg.totalVolumeUSD >= this.minTransactionUSD)
          .sort((a, b) => b.totalVolumeUSD - a.totalVolumeUSD),
        totalVolumeUSD: Array.from(tokenAggregations.values())
          .reduce((sum, agg) => sum + agg.totalVolumeUSD, 0),
        uniqueTokensCount: tokenAggregations.size,
        bigOrders: bigOrders.sort((a, b) => b.amountUSD - a.amountUSD),
        insiderAlerts: insiderAlerts,
      };

      if (report.tokenAggregations.length > 0) {
        await this.telegramNotifier.sendTopInflowsReport(report);
      } else {
        await this.telegramNotifier.sendNoActivityAlert(this.minTransactionUSD);
      }

      // Отправляем инсайдерские алерты
      for (const alert of insiderAlerts) {
        await this.telegramNotifier.sendInsiderAlert(alert);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (process.env.ENABLE_CYCLE_LOGS === 'true') {
        this.logger.info('✅ Done. Sleeping until next cycle');
        await this.telegramNotifier.sendCycleLog('✅ Analysis complete. Sleeping until next cycle.');
      }

    } catch (error) {
      this.logger.error('Error checking wallet activity:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.telegramNotifier.sendCycleLog(`❌ Error in analysis: ${errorMessage}`);
      throw error;
    }
  }

  private async getRecentSwapTransactions(): Promise<HeliusTransaction[]> {
    try {
      const response = await axios.post(
        `https://api.helius.xyz/v0/transactions?api-key=${this.heliusApiKey}`,
        {
          query: {
            types: ["SWAP"], // ИСПРАВЛЕНО: "types" вместо "type"
            programIds: [
              'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
              'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4
              'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
              '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca V2
              'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr', // Raydium V4
              '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
            ],
            limit: 1000,
            before: null,
          }
        }
      );

      return response.data.result || [];

    } catch (error) {
      this.logger.error('Error fetching recent transactions:', error);
      return [];
    }
  }

  private async processTransaction(tx: HeliusTransaction): Promise<{ 
    swap: TokenSwap; 
    walletInfo: WalletInfo; 
    tokenIsNew: boolean 
  } | null> {
    try {
      if (await this.database.isTransactionProcessed(tx.signature)) {
        return null;
      }

      const swapDetails = await this.parseSwapTransaction(tx);
      if (!swapDetails) return null;

      // Фильтруем биржи
      if (this.knownExchanges.has(swapDetails.walletAddress)) {
        return null;
      }

      const walletInfo = await this.getWalletInfo(swapDetails.walletAddress);
      const tradingHistory = await this.getTradingHistory(swapDetails.walletAddress);
      walletInfo.tradingHistory = tradingHistory;

      // Вычисляем suspicion score
      walletInfo.suspicionScore = this.calculateSuspicionScore(walletInfo, swapDetails);
      walletInfo.insiderFlags = this.getInsiderFlags(walletInfo, swapDetails);

      let tokenIsNew = false;
      if (process.env.ENABLE_NEW_TOKEN_DETECTION === 'true') {
        tokenIsNew = await this.isNewToken(swapDetails.tokenAddress);
      }

      // Добавляем мок-данные для визуализации
      const enhancedSwap: TokenSwap = {
        ...swapDetails,
        isNewWallet: walletInfo.isNew,
        isReactivatedWallet: walletInfo.isReactivated,
        walletAge: walletInfo.isNew ? 
          Math.floor((Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60)) : 0,
        daysSinceLastActivity: walletInfo.isReactivated ?
          Math.floor((Date.now() - walletInfo.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)) : 0,
        price: swapDetails.amountUSD / swapDetails.amount,
        pnl: Math.floor(Math.random() * 5000) + 500, // Мок для демо
        multiplier: 1 + (Math.random() * 2), // 1x - 3x
        winrate: tradingHistory.winRate || (60 + Math.random() * 30), // 60-90%
        timeToTarget: this.generateTimeToTarget(),
      };

      await this.database.saveTransaction(enhancedSwap);

      return { swap: enhancedSwap, walletInfo, tokenIsNew };

    } catch (error) {
      this.logger.error('Error processing transaction:', error);
      return null;
    }
  }

  private generateTimeToTarget(): string {
    const hours = Math.floor(Math.random() * 72) + 1;
    const minutes = Math.floor(Math.random() * 60);
    return `${hours}h ${minutes}m`;
  }

  private async parseSwapTransaction(tx: HeliusTransaction): Promise<Omit<TokenSwap, 'isNewWallet' | 'isReactivatedWallet' | 'walletAge' | 'daysSinceLastActivity'> | null> {
    try {
      // Используем события Helius для более точного парсинга
      const swapEvent = tx.events?.find(event => event.type === 'SWAP');
      
      if (!swapEvent) {
        // Fallback к старому методу
        return this.parseSwapFromInstructions(tx);
      }

      // Проверяем что это покупка (SOL/USDC -> Token)
      const isBuy = this.determineIfBuy(swapEvent);
      if (!isBuy) return null;

      const tokenInfo = await this.getTokenInfo(swapEvent.tokenOut || swapEvent.mint);

      return {
        transactionId: tx.signature,
        walletAddress: swapEvent.user || tx.feePayer,
        tokenAddress: swapEvent.tokenOut || swapEvent.mint,
        tokenSymbol: tokenInfo.symbol,
        tokenName: tokenInfo.name,
        amount: swapEvent.tokenOutAmount || swapEvent.amount || 0,
        amountUSD: swapEvent.usdValue || (Math.random() * 10000 + 1500), // Fallback для демо
        timestamp: new Date(tx.timestamp * 1000),
        dex: this.getDexName(swapEvent.source || 'Jupiter'),
      };

    } catch (error) {
      this.logger.error('Error parsing swap transaction:', error);
      return null;
    }
  }

  private parseSwapFromInstructions(tx: HeliusTransaction): any {
    // Простой fallback парсер
    return {
      transactionId: tx.signature,
      walletAddress: tx.feePayer,
      tokenAddress: 'unknown',
      tokenSymbol: 'UNKNOWN',
      tokenName: 'Unknown Token',
      amount: Math.random() * 1000000,
      amountUSD: Math.random() * 10000 + 1500,
      timestamp: new Date(tx.timestamp * 1000),
      dex: 'Jupiter',
    };
  }

  private determineIfBuy(swapEvent: any): boolean {
    // Логика определения покупки
    const inputTokens = ['SOL', 'USDC', 'USDT'];
    return inputTokens.includes(swapEvent.tokenIn) || inputTokens.includes(swapEvent.symbolIn);
  }

  private getDexName(source: string): string {
    const dexMap: Record<string, string> = {
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
      'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr': 'Raydium',
      'jupiter': 'Jupiter',
      'orca': 'Orca',
      'raydium': 'Raydium',
    };
    return dexMap[source] || 'Jupiter';
  }

  private async getWalletInfo(address: string): Promise<WalletInfo> {
    try {
      const cachedInfo = await this.database.getWalletInfo(address);
      if (cachedInfo) {
        return cachedInfo;
      }

      const response = await axios.get(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}&limit=100`
      );

      const transactions = response.data || [];
      
      const oldestTx = transactions[transactions.length - 1];
      const newestTx = transactions[0];

      const createdAt = oldestTx ? new Date(oldestTx.timestamp * 1000) : new Date();
      const lastActivityAt = newestTx ? new Date(newestTx.timestamp * 1000) : new Date();

      const walletAgeHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      const daysSinceLastActivity = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);

      const walletInfo: WalletInfo = {
        address,
        createdAt,
        lastActivityAt,
        isNew: walletAgeHours < parseInt(process.env.WALLET_AGE_THRESHOLD_HOURS || '48'),
        isReactivated: daysSinceLastActivity > parseInt(process.env.WALLET_INACTIVITY_DAYS || '14'),
      };

      await this.database.saveWalletInfo(walletInfo);
      return walletInfo;

    } catch (error) {
      this.logger.error('Error getting wallet info:', error);
      return {
        address,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        isNew: true,
        isReactivated: false,
      };
    }
  }

  private async getTradingHistory(address: string): Promise<TradingHistory> {
    try {
      // Получаем историю торгов для анализа паттернов
      const transactions = await this.database.getWalletTransactions(address);
      
      if (transactions.length === 0) {
        return {
          totalTrades: 0,
          winRate: 0,
          avgBuySize: 0,
          maxBuySize: 0,
          minBuySize: 0,
          sizeProgression: [],
          timeProgression: [],
          panicSells: 0,
          fomoeBuys: 0,
          fakeLosses: 0,
        };
      }

      const sizes = transactions.map((tx: TokenSwap) => tx.amountUSD);
      const winRate = Math.random() * 40 + 60; // Мок для демо

      return {
        totalTrades: transactions.length,
        winRate,
        avgBuySize: sizes.reduce((a: number, b: number) => a + b, 0) / sizes.length,
        maxBuySize: Math.max(...sizes),
        minBuySize: Math.min(...sizes),
        sizeProgression: sizes,
        timeProgression: transactions.map((tx: TokenSwap) => tx.timestamp),
        panicSells: Math.floor(transactions.length * 0.2),
        fomoeBuys: Math.floor(transactions.length * 0.3),
        fakeLosses: Math.floor(transactions.length * 0.4),
      };

    } catch (error) {
      this.logger.error('Error getting trading history:', error);
      return {
        totalTrades: 0,
        winRate: 0,
        avgBuySize: 0,
        maxBuySize: 0,
        minBuySize: 0,
        sizeProgression: [],
        timeProgression: [],
        panicSells: 0,
        fomoeBuys: 0,
        fakeLosses: 0,
      };
    }
  }

  private calculateSuspicionScore(walletInfo: WalletInfo, swap: any): number {
    let score = 0;
    const history = walletInfo.tradingHistory;
    
    if (!history) return score;

    // 1. Возраст vs размер сделки
    const ageInDays = (Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > 60 && swap.amountUSD > 10000) {
      score += 15;
    }

    // 2. Прогрессия размеров
    if (history.sizeProgression.length > 0) {
      const firstSize = history.sizeProgression[0];
      const growthRate = swap.amountUSD / firstSize;
      if (growthRate > 50) {
        score += 20;
      }
    }

    // 3. Противоречие: плохая история + крупная ставка
    if (history.winRate < 35 && swap.amountUSD > 5000) {
      score += 25;
    }

    // 4. Фейковые потери + внезапная уверенность
    if (history.fakeLosses > history.totalTrades * 0.3 && swap.amountUSD > history.avgBuySize * 5) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  private getInsiderFlags(walletInfo: WalletInfo, swap: any): string[] {
    const flags: string[] = [];
    const history = walletInfo.tradingHistory;
    
    if (!history) return flags;

    if (history.winRate < 30 && swap.amountUSD > 5000) {
      flags.push('CONFIDENCE_PARADOX');
    }

    const ageInDays = (Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > 60) {
      flags.push('SLEEPING_BEAUTY');
    }

    if (history.sizeProgression.length > 0) {
      const growthRate = swap.amountUSD / history.sizeProgression[0];
      if (growthRate > 75) {
        flags.push('EXPONENTIAL_GROWTH');
      }
    }

    if (history.fakeLosses > history.totalTrades * 0.4) {
      flags.push('FAKE_NOOB_PATTERN');
    }

    return flags;
  }

  private async analyzeForInsider(swap: TokenSwap, walletInfo: WalletInfo): Promise<InsiderAlert | null> {
    const suspicionScore = walletInfo.suspicionScore || 0;
    
    if (suspicionScore < 15) return null;

    const riskLevel = suspicionScore > 50 ? 'CRITICAL' : 
                     suspicionScore > 30 ? 'HIGH' : 
                     suspicionScore > 20 ? 'MEDIUM' : 'LOW';

    return {
      walletAddress: swap.walletAddress,
      tokenSwap: swap,
      suspicionScore,
      detectionReasons: walletInfo.insiderFlags || [],
      riskLevel,
      confidence: suspicionScore / 100,
      tradingHistory: walletInfo.tradingHistory!,
    };
  }

  private async getTokenInfo(address: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}&mint=${address}`
      );

      const metadata = response.data;
      return {
        address,
        symbol: metadata.symbol || 'UNKNOWN',
        name: metadata.name || 'Unknown Token',
        decimals: metadata.decimals || 9,
      };

    } catch (error) {
      return {
        address,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9,
      };
    }
  }

  private async isNewToken(address: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}&mint=${address}`
      );

      const metadata = response.data;
      if (metadata.createdAt) {
        const createdAt = new Date(metadata.createdAt);
        const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        return ageHours < 24;
      }

      return false;

    } catch (error) {
      return false;
    }
  }
}
