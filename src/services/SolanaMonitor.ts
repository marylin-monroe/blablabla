// src/services/SolanaMonitor.ts
import axios from 'axios';
import { Database } from './Database';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';
import { TokenSwap, WalletInfo, TokenAggregation, SmartMoneyReport } from '../types';
import PQueue from 'p-queue';

export class SolanaMonitor {
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  private heliusApiKey: string;
  private queue: PQueue;
  private minTransactionUSD: number;
  private bigOrderThreshold: number;

  constructor(database: Database, telegramNotifier: TelegramNotifier) {
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY!;
    this.queue = new PQueue({ concurrency: 5 });
    this.minTransactionUSD = parseInt(process.env.MIN_TRANSACTION_USD || '2000');
    this.bigOrderThreshold = parseInt(process.env.BIG_ORDER_THRESHOLD || '10000');
  }

  async checkForNewWalletActivity(): Promise<void> {
    try {
      this.logger.info('Checking for new wallet activity...');

      // Get recent transactions from Helius
      const recentTransactions = await this.getRecentSwapTransactions();
      
      this.logger.info(`Found ${recentTransactions.length} recent swap transactions`);

      // Для агрегации по токенам
      const tokenAggregations = new Map<string, TokenAggregation>();
      const bigOrders: TokenSwap[] = [];

      // Process each transaction
      for (const tx of recentTransactions) {
        await this.queue.add(async () => {
          try {
            const result = await this.processTransaction(tx);
            
            if (result && result.swap) {
              // Фильтруем по минимальной сумме
              if (result.swap.amountUSD >= this.minTransactionUSD) {
                // Агрегация по токенам
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
                  });
                }

                const agg = tokenAggregations.get(key)!;
                agg.totalVolumeUSD += result.swap.amountUSD;
                agg.uniqueWallets.add(result.swap.walletAddress);
                agg.transactions.push(result.swap);
                
                // Обновляем временные метки
                if (result.swap.timestamp < agg.firstPurchaseTime) {
                  agg.firstPurchaseTime = result.swap.timestamp;
                }
                if (result.swap.timestamp > agg.lastPurchaseTime) {
                  agg.lastPurchaseTime = result.swap.timestamp;
                }

                // Отслеживаем самую большую покупку
                if (!agg.biggestPurchase || result.swap.amountUSD > agg.biggestPurchase.amountUSD) {
                  agg.biggestPurchase = result.swap;
                }

                // Проверяем, является ли это крупным ордером
                if (result.swap.amountUSD >= this.bigOrderThreshold) {
                  bigOrders.push(result.swap);
                  // Отправляем срочное уведомление о крупном ордере
                  await this.telegramNotifier.sendBigOrderAlert(result.swap, result.walletInfo);
                }
              }
            }
          } catch (error) {
            this.logger.error(`Error processing transaction ${tx.signature}:`, error);
          }
        });
      }

      await this.queue.onIdle();

      // Создаем отчет по умным деньгам
      const report: SmartMoneyReport = {
        period: `${process.env.AGGREGATION_PERIOD_HOURS || '1'} час`,
        tokenAggregations: Array.from(tokenAggregations.values())
          .filter(agg => agg.totalVolumeUSD >= this.minTransactionUSD)
          .sort((a, b) => b.totalVolumeUSD - a.totalVolumeUSD),
        totalVolumeUSD: Array.from(tokenAggregations.values())
          .reduce((sum, agg) => sum + agg.totalVolumeUSD, 0),
        uniqueTokensCount: tokenAggregations.size,
        bigOrders: bigOrders.sort((a, b) => b.amountUSD - a.amountUSD),
      };

      // Отправляем агрегированный отчет или уведомление об отсутствии активности
      if (report.tokenAggregations.length > 0) {
        await this.telegramNotifier.sendSmartMoneyReport(report);
      } else {
        // Отправляем уведомление, что активности не обнаружено
        await this.telegramNotifier.sendNoActivityAlert(this.minTransactionUSD);
      }

      this.logger.info('Wallet activity check completed');

    } catch (error) {
      this.logger.error('Error checking wallet activity:', error);
      throw error;
    }
  }

  private async getRecentSwapTransactions(): Promise<any[]> {
    try {
      // Query Helius for recent swap transactions
      const response = await axios.post(
        `https://api.helius.xyz/v0/transactions?api-key=${this.heliusApiKey}`,
        {
          query: {
            programIds: [
              'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
              'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4
              'JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph', // Jupiter V3
              'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
              '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca V2
              'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca V1
              'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr', // Raydium V4
              '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
            ],
            type: 'SWAP',
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

  private async processTransaction(tx: any): Promise<{ swap: TokenSwap; walletInfo: WalletInfo; tokenIsNew: boolean } | null> {
    try {
      // Check if we've already processed this transaction
      if (await this.database.isTransactionProcessed(tx.signature)) {
        return null;
      }

      // Parse transaction details
      const swapDetails = await this.parseSwapTransaction(tx);
      if (!swapDetails) return null;

      // Get wallet information
      const walletInfo = await this.getWalletInfo(swapDetails.walletAddress);
      if (!walletInfo.isNew && !walletInfo.isReactivated) {
        return null;
      }

      // Check for related wallets if enabled
      if (process.env.ENABLE_MULTI_WALLET_DETECTION === 'true') {
        walletInfo.relatedWallets = await this.findRelatedWallets(swapDetails.walletAddress);
      }

      // Check if token is new if enabled
      let tokenIsNew = false;
      if (process.env.ENABLE_NEW_TOKEN_DETECTION === 'true') {
        tokenIsNew = await this.isNewToken(swapDetails.tokenAddress);
      }

      // Create TokenSwap object
      const tokenSwap: TokenSwap = {
        ...swapDetails,
        isNewWallet: walletInfo.isNew,
        isReactivatedWallet: walletInfo.isReactivated,
        walletAge: walletInfo.isNew ? 
          Math.floor((Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60)) : 0,
        daysSinceLastActivity: walletInfo.isReactivated ?
          Math.floor((Date.now() - walletInfo.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)) : 0,
      };

      // Save to database
      await this.database.saveTransaction(tokenSwap);

      return { swap: tokenSwap, walletInfo, tokenIsNew };

    } catch (error) {
      this.logger.error('Error processing transaction:', error);
      return null;
    }
  }

  private async parseSwapTransaction(tx: any): Promise<Omit<TokenSwap, 'isNewWallet' | 'isReactivatedWallet' | 'walletAge' | 'daysSinceLastActivity'> | null> {
    try {
      // Extract swap details from transaction
      const instructions = tx.instructions || [];
      const swapInstruction = instructions.find((ix: any) => 
        ix.programId && this.isSwapProgram(ix.programId)
      );

      if (!swapInstruction) return null;

      // Parse based on DEX type
      const dexName = this.getDexName(swapInstruction.programId);
      const swapData = await this.parseSwapData(swapInstruction);

      if (!swapData || !swapData.isBuy) return null;

      // Get token info
      const tokenInfo = await this.getTokenInfo(swapData.tokenAddress);

      return {
        transactionId: tx.signature,
        walletAddress: swapData.walletAddress,
        tokenAddress: swapData.tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        tokenName: tokenInfo.name,
        amount: swapData.amount,
        amountUSD: swapData.amountUSD || 0,
        timestamp: new Date(tx.timestamp * 1000),
        dex: dexName,
      };

    } catch (error) {
      this.logger.error('Error parsing swap transaction:', error);
      return null;
    }
  }

  private isSwapProgram(programId: string): boolean {
    const swapPrograms = [
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
      'JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
      'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
      'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr',
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    ];
    return swapPrograms.includes(programId);
  }

  private getDexName(programId: string): string {
    const dexMap: Record<string, string> = {
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter',
      'JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph': 'Jupiter',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
      'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Orca',
      'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr': 'Raydium',
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
    };
    return dexMap[programId] || 'Unknown';
  }

  private async parseSwapData(instruction: any): Promise<any> {
    // Parse swap data based on DEX type
    // This is a simplified version - you'd need to implement specific parsing for each DEX
    try {
      const accounts = instruction.accounts || [];
      if (accounts.length < 2) return null;

      // Extract wallet and token addresses
      const walletAddress = accounts[0];
      const tokenAddress = accounts[accounts.length - 1];

      // Determine if it's a buy (SOL -> Token) or sell (Token -> SOL)
      // This is simplified - you'd need more complex logic for accurate determination
      const isBuy = true; // Placeholder

      return {
        walletAddress,
        tokenAddress,
        amount: 0, // Would need to decode instruction data
        amountUSD: 0, // Would need price data
        isBuy,
      };

    } catch (error) {
      this.logger.error('Error parsing swap data:', error);
      return null;
    }
  }

  private async getWalletInfo(address: string): Promise<WalletInfo> {
    try {
      // Check database first
      const cachedInfo = await this.database.getWalletInfo(address);
      if (cachedInfo) {
        return cachedInfo;
      }

      // Fetch wallet history from Helius
      const response = await axios.get(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}&limit=100`
      );

      const transactions = response.data || [];
      
      // Determine wallet age and activity
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

      // Save to database
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

  private async getTokenInfo(address: string): Promise<any> {
    try {
      // Get token metadata from Helius
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
      this.logger.error('Error getting token info:', error);
      return {
        address,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9,
      };
    }
  }

  private async findRelatedWallets(address: string): Promise<string[]> {
    try {
      // Analyze transaction patterns to find related wallets
      const response = await axios.get(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}&limit=1000`
      );

      const transactions = response.data || [];
      const relatedAddresses = new Set<string>();

      // Look for common funding sources and destinations
      for (const tx of transactions) {
        if (tx.type === 'TRANSFER') {
          const from = tx.from;
          const to = tx.to;
          
          if (from === address) {
            relatedAddresses.add(to);
          } else if (to === address) {
            relatedAddresses.add(from);
          }
        }
      }

      // Filter out exchange addresses and common contracts
      const filtered = Array.from(relatedAddresses).filter(addr => 
        !this.isKnownExchangeAddress(addr) && addr !== address
      );

      return filtered.slice(0, 5); // Return top 5 related wallets

    } catch (error) {
      this.logger.error('Error finding related wallets:', error);
      return [];
    }
  }

  private isKnownExchangeAddress(address: string): boolean {
    const knownExchanges: string[] = [
      // Add known exchange addresses here
    ];
    return knownExchanges.includes(address);
  }

  private async isNewToken(address: string): Promise<boolean> {
    try {
      // Check token creation date
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
      this.logger.error('Error checking token age:', error);
      return false;
    }
  }
}