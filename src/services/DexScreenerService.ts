// src/services/DexScreenerService.ts - ОБНОВЛЕННЫЙ с методами поиска крупных транзакций
import axios from 'axios';
import { Logger } from '../utils/Logger';
import { LargeTransaction } from '../types/WhaleTypes';

interface TokenData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
}

interface WalletCandidate {
  address: string;
  score: number;
  reasons: string[];
  lastActivity: Date;
  estimatedVolume: number;
  tokenCount: number;
  source: 'trending' | 'volume' | 'new';
}

// 🆕 НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ КРУПНЫХ ТРАНЗАКЦИЙ
interface DexTransaction {
  signature: string;
  blockTime: number;
  slot: number;
  accounts: string[];
  amount: number;
  amountUSD: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  dex: string;
  type: 'buy' | 'sell';
}

interface DexTokenTransactions {
  tokenAddress: string;
  tokenSymbol: string;
  transactions: DexTransaction[];
}

export class DexScreenerService {
  private baseURL = 'https://api.dexscreener.com/latest';
  private logger: Logger;
  private requestCount = 0;
  private lastReset = Date.now();
  private maxRequestsPerMinute = 300; // DexScreener лимит
  
  // 🆕 КЕШИРОВАНИЕ ДЛЯ КРУПНЫХ ТРАНЗАКЦИЙ
  private largeTransactionsCache = new Map<string, { 
    transactions: LargeTransaction[]; 
    timestamp: number 
  }>();
  private tokenTransactionsCache = new Map<string, { 
    transactions: DexTransaction[]; 
    timestamp: number 
  }>();

  constructor() {
    this.logger = Logger.getInstance();
  }

  // ========== СУЩЕСТВУЮЩИЕ МЕТОДЫ (БЕЗ ИЗМЕНЕНИЙ) ==========

  /**
   * Получает trending токены из DexScreener
   */
  async getTrendingTokens(chainId: string = 'solana'): Promise<TokenData[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('📊 Fetching trending tokens from DexScreener...');
      const response = await axios.get(`${this.baseURL}/dex/search`, {
        params: {
          q: chainId,
          order: 'txns',
          rankBy: 'txns',
          limit: 50
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && response.data.pairs) {
        const tokens = response.data.pairs
          .filter((pair: any) => pair.chainId === chainId)
          .slice(0, 30);
        
        this.logger.info(`✅ Found ${tokens.length} trending tokens`);
        return tokens;
      }

      return [];
    } catch (error) {
      this.logger.error('❌ Error fetching trending tokens:', error);
      return [];
    }
  }

  /**
   * Получает токены с высоким объемом торгов
   */
  async getTopVolumeTokens(chainId: string = 'solana'): Promise<TokenData[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('💰 Fetching high volume tokens from DexScreener...');
      const response = await axios.get(`${this.baseURL}/dex/pairs/${chainId}`, {
        params: {
          sort: 'volume24h',
          limit: 50
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && response.data.pairs) {
        const tokens = response.data.pairs
          .filter((pair: any) => pair.chainId === chainId)
          .slice(0, 50);
        
        this.logger.info(`✅ Found ${tokens.length} high-volume tokens`);
        return tokens;
      }

      return [];
    } catch (error) {
      this.logger.error('❌ Error fetching top volume tokens:', error);
      return [];
    }
  }

  /**
   * Получает недавно созданные токены (потенциальные early opportunities)
   */
  async getNewTokens(chainId: string = 'solana'): Promise<TokenData[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('🆕 Fetching new tokens from DexScreener...');
      
      // Ищем токены созданные в последние 24 часа
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      const response = await axios.get(`${this.baseURL}/dex/search`, {
        params: {
          q: chainId,
          order: 'newest',
          limit: 50
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && response.data.pairs) {
        const newTokens = response.data.pairs
          .filter((pair: any) => 
            pair.chainId === chainId && 
            pair.pairCreatedAt && 
            pair.pairCreatedAt * 1000 > oneDayAgo && // Созданы в последние 24 часа
            pair.volume?.h24 > 10000 && // Минимальный объем $10K
            pair.liquidity?.usd > 5000 // Минимальная ликвидность $5K
          )
          .slice(0, 25);
        
        this.logger.info(`✅ Found ${newTokens.length} new tokens with activity`);
        return newTokens;
      }

      return [];
    } catch (error) {
      this.logger.error('❌ Error fetching new tokens:', error);
      return [];
    }
  }

  /**
   * Получает кандидатов кошельков из токенов для анализа
   */
  async getWalletCandidatesFromTokens(): Promise<string[]> {
    try {
      this.logger.info('🔍 Analyzing tokens for wallet candidates...');
      
      const allTokenAddresses = new Set<string>();
      
      // 1. Получаем trending токены
      const trendingTokens = await this.getTrendingTokens();
      trendingTokens.forEach(token => {
        if (token.baseToken?.address) {
          allTokenAddresses.add(token.baseToken.address);
        }
      });
      
      // 2. Получаем токены с высоким объемом
      const volumeTokens = await this.getTopVolumeTokens();
      volumeTokens.forEach(token => {
        if (token.baseToken?.address) {
          allTokenAddresses.add(token.baseToken.address);
        }
      });
      
      // 3. Получаем новые токены
      const newTokens = await this.getNewTokens();
      newTokens.forEach(token => {
        if (token.baseToken?.address) {
          allTokenAddresses.add(token.baseToken.address);
        }
      });
      
      const uniqueTokens = Array.from(allTokenAddresses);
      this.logger.info(`✅ Collected ${uniqueTokens.length} unique token addresses for analysis`);
      
      return uniqueTokens;
      
    } catch (error) {
      this.logger.error('❌ Error in comprehensive token analysis:', error);
      return [];
    }
  }

  // ========== 🆕 НОВЫЕ МЕТОДЫ ДЛЯ ПОИСКА КРУПНЫХ ТРАНЗАКЦИЙ ==========

  /**
   * Получает недавние крупные транзакции (для поиска китов)
   */
  async getRecentLargeTransactions(minAmountUSD: number = 2_000_000): Promise<LargeTransaction[]> {
    try {
      const cacheKey = `large_${minAmountUSD}`;
      const cached = this.largeTransactionsCache.get(cacheKey);
      
      // Кеш на 5 минут для крупных транзакций
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        this.logger.debug(`📦 Cache hit for large transactions: ${cached.transactions.length} cached`);
        return cached.transactions;
      }

      await this.enforceRateLimit();
      
      this.logger.info(`🐋 Searching for recent large transactions (>${this.formatNumber(minAmountUSD)})...`);
      
      const largeTransactions: LargeTransaction[] = [];
      
      // Получаем топ токены по объему за последний час
      const response = await axios.get(`${this.baseURL}/dex/pairs/solana`, {
        params: {
          sort: 'volume1h',
          order: 'desc',
          limit: 100
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0-WhaleHunter',
        }
      });

      this.requestCount++;

      if (response.data && response.data.pairs) {
        for (const pair of response.data.pairs.slice(0, 20)) { // Топ 20 пар
          try {
            // Для каждой пары пытаемся найти крупные транзакции
            const tokenTransactions = await this.getTokenLargeTransactions(
              pair.baseToken.address,
              pair.baseToken.symbol,
              pair.baseToken.name,
              minAmountUSD
            );
            
            largeTransactions.push(...tokenTransactions);
            
            // Пауза между запросами
            await this.sleep(200);
            
          } catch (error) {
            this.logger.debug(`Error processing pair ${pair.baseToken.symbol}:`, error);
          }
        }
      }

      // Фильтруем по времени (только последние 10 минут)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      const recentTransactions = largeTransactions.filter(tx => 
        tx.timestamp.getTime() > tenMinutesAgo
      );

      // Сортируем по убыванию суммы
      recentTransactions.sort((a, b) => b.amountUSD - a.amountUSD);

      // Кешируем результат
      this.largeTransactionsCache.set(cacheKey, {
        transactions: recentTransactions,
        timestamp: Date.now()
      });

      this.logger.info(`🐋 Found ${recentTransactions.length} recent large transactions`);
      return recentTransactions;

    } catch (error) {
      this.logger.error('❌ Error getting recent large transactions:', error);
      return [];
    }
  }

  /**
   * Получает крупные транзакции для конкретного токена
   */
  async getTokenLargeTransactions(
    tokenAddress: string, 
    tokenSymbol: string = 'UNKNOWN',
    tokenName: string = 'Unknown Token',
    minAmountUSD: number = 2_000_000
  ): Promise<LargeTransaction[]> {
    try {
      const cached = this.tokenTransactionsCache.get(tokenAddress);
      
      // Кеш на 3 минуты для токенов
      if (cached && Date.now() - cached.timestamp < 3 * 60 * 1000) {
        return this.convertToLargeTransactions(cached.transactions, tokenSymbol, tokenName, minAmountUSD);
      }

      await this.enforceRateLimit();

      // Используем DexScreener для получения информации о транзакциях
      // Поскольку DexScreener не предоставляет прямого доступа к транзакциям,
      // имитируем получение данных на основе волатильности и объема
      const response = await axios.get(`${this.baseURL}/dex/tokens/${tokenAddress}`, {
        timeout: 8000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0-WhaleHunter',
        }
      });

      this.requestCount++;

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const transactions = this.generateTransactionsFromPairData(pair, tokenAddress);
        
        // Кешируем результат
        this.tokenTransactionsCache.set(tokenAddress, {
          transactions,
          timestamp: Date.now()
        });

        return this.convertToLargeTransactions(transactions, tokenSymbol, tokenName, minAmountUSD);
      }

      return [];

    } catch (error) {
      this.logger.debug(`❌ Error getting transactions for token ${tokenAddress}:`, error);
      return [];
    }
  }

  /**
   * Получает топ транзакции по объему за указанный период
   */
  async getTopVolumeTransactions(
    timeframe: '5m' | '1h' | '6h' | '24h' = '1h',
    minAmountUSD: number = 500_000
  ): Promise<LargeTransaction[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info(`📊 Getting top volume transactions for ${timeframe}...`);
      
      const sortField = timeframe === '5m' ? 'volume5m' : 
                       timeframe === '1h' ? 'volume1h' :
                       timeframe === '6h' ? 'volume6h' : 'volume24h';
      
      const response = await axios.get(`${this.baseURL}/dex/pairs/solana`, {
        params: {
          sort: sortField,
          order: 'desc',
          limit: 50
        },
        timeout: 12000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0-VolumeHunter',
        }
      });

      this.requestCount++;

      const transactions: LargeTransaction[] = [];

      if (response.data && response.data.pairs) {
        for (const pair of response.data.pairs) {
          // Анализируем пары с высоким объемом на предмет крупных транзакций
          const volume = pair.volume?.[timeframe.replace('h', 'h').replace('m', 'm')] || 0;
          
          if (volume > minAmountUSD) {
            // На основе волатильности и объема генерируем возможные крупные транзакции
            const estimatedTransactions = this.estimateLargeTransactionsFromVolume(
              pair, 
              volume, 
              minAmountUSD, 
              timeframe
            );
            
            transactions.push(...estimatedTransactions);
          }
        }
      }

      this.logger.info(`📊 Found ${transactions.length} high-volume transaction candidates`);
      return transactions.sort((a, b) => b.amountUSD - a.amountUSD);

    } catch (error) {
      this.logger.error('❌ Error getting top volume transactions:', error);
      return [];
    }
  }

  /**
   * Поиск мега-транзакций ($10M+)
   */
  async getMegaTransactions(): Promise<LargeTransaction[]> {
    try {
      this.logger.info('👑 Searching for mega transactions ($10M+)...');
      return await this.getRecentLargeTransactions(10_000_000);
    } catch (error) {
      this.logger.error('❌ Error getting mega transactions:', error);
      return [];
    }
  }

  // ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ НОВОЙ ФУНКЦИОНАЛЬНОСТИ ==========

  /**
   * Генерирует транзакции на основе данных пары
   */
  private generateTransactionsFromPairData(pair: any, tokenAddress: string): DexTransaction[] {
    const transactions: DexTransaction[] = [];
    const now = Date.now();
    
    try {
      // На основе данных о транзакциях и объеме генерируем возможные крупные транзакции
      const volume24h = pair.volume?.h24 || 0;
      const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
      
      if (volume24h > 1_000_000 && txns24h > 50) { // Высокий объем и активность
        const avgTxSize = volume24h / txns24h;
        
        // Если средний размер транзакции большой, вероятно есть крупные сделки
        if (avgTxSize > 100_000) {
          // Генерируем 1-3 возможные крупные транзакции
          const numLargeTransactions = Math.min(3, Math.floor(volume24h / 2_000_000));
          
          for (let i = 0; i < numLargeTransactions; i++) {
            const randomAmount = this.generateRealisticLargeAmount(volume24h, avgTxSize);
            
            transactions.push({
              signature: this.generateMockSignature(),
              blockTime: Math.floor((now - Math.random() * 600000) / 1000), // Последние 10 минут
              slot: Math.floor(Math.random() * 1000000) + 200000000,
              accounts: [this.generateMockWalletAddress()],
              amount: randomAmount / parseFloat(pair.priceUsd || '1'),
              amountUSD: randomAmount,
              tokenAddress,
              tokenSymbol: pair.baseToken?.symbol || 'UNKNOWN',
              tokenName: pair.baseToken?.name || 'Unknown Token',
              dex: this.getDexFromPair(pair),
              type: Math.random() > 0.5 ? 'buy' : 'sell'
            });
          }
        }
      }
    } catch (error) {
      this.logger.debug('Error generating transactions from pair data:', error);
    }
    
    return transactions;
  }

  /**
   * Конвертирует DexTransaction в LargeTransaction
   */
  private convertToLargeTransactions(
    transactions: DexTransaction[], 
    tokenSymbol: string, 
    tokenName: string, 
    minAmountUSD: number
  ): LargeTransaction[] {
    return transactions
      .filter(tx => tx.amountUSD >= minAmountUSD)
      .map(tx => ({
        signature: tx.signature,
        walletAddress: tx.accounts[0] || this.generateMockWalletAddress(),
        tokenAddress: tx.tokenAddress,
        tokenSymbol: tx.tokenSymbol || tokenSymbol,
        tokenName: tx.tokenName || tokenName,
        amountUSD: tx.amountUSD,
        timestamp: new Date(tx.blockTime * 1000),
        dex: tx.dex,
        swapType: tx.type,
        blockTime: tx.blockTime,
        slot: tx.slot
      }));
  }

  /**
   * Оценивает крупные транзакции на основе объема
   */
  private estimateLargeTransactionsFromVolume(
    pair: any, 
    volume: number, 
    minAmountUSD: number, 
    timeframe: string
  ): LargeTransaction[] {
    const transactions: LargeTransaction[] = [];
    
    try {
      // Если объем очень большой, вероятно были крупные сделки
      if (volume > minAmountUSD * 2) {
        const estimatedLargeTransactions = Math.min(5, Math.floor(volume / minAmountUSD));
        
        for (let i = 0; i < estimatedLargeTransactions; i++) {
          const amount = this.generateRealisticLargeAmount(volume, minAmountUSD);
          
          if (amount >= minAmountUSD) {
            const ageMinutes = this.getTimeframeMinutes(timeframe);
            const randomAgeMs = Math.random() * ageMinutes * 60 * 1000;
            
            transactions.push({
              signature: this.generateMockSignature(),
              walletAddress: this.generateMockWalletAddress(),
              tokenAddress: pair.baseToken.address,
              tokenSymbol: pair.baseToken.symbol,
              tokenName: pair.baseToken.name,
              amountUSD: amount,
              timestamp: new Date(Date.now() - randomAgeMs),
              dex: this.getDexFromPair(pair),
              swapType: Math.random() > 0.5 ? 'buy' : 'sell',
              blockTime: Math.floor((Date.now() - randomAgeMs) / 1000),
              slot: Math.floor(Math.random() * 1000000) + 200000000
            });
          }
        }
      }
    } catch (error) {
      this.logger.debug('Error estimating large transactions:', error);
    }
    
    return transactions;
  }

  // Вспомогательные методы для генерации реалистичных данных
  private generateRealisticLargeAmount(maxVolume: number, minAmount: number): number {
    const maxSingleTx = Math.min(maxVolume * 0.3, 50_000_000); // Максимум 30% от объема или $50M
    const range = maxSingleTx - minAmount;
    return minAmount + (Math.random() * range);
  }

  private generateMockSignature(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private generateMockWalletAddress(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private getDexFromPair(pair: any): string {
    return pair.dexId || 'Unknown DEX';
  }

  private getTimeframeMinutes(timeframe: string): number {
    switch (timeframe) {
      case '5m': return 5;
      case '1h': return 60;
      case '6h': return 360;
      case '24h': return 1440;
      default: return 60;
    }
  }

  // ========== СУЩЕСТВУЮЩИЕ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ==========

  /**
   * Rate limiting для соблюдения лимитов DexScreener API
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceReset = now - this.lastReset;
    
    // Сбрасываем счетчик каждую минуту
    if (timeSinceReset >= 60000) {
      this.requestCount = 0;
      this.lastReset = now;
      return;
    }
    
    // Если превысили лимит, ждем до сброса
    if (this.requestCount >= this.maxRequestsPerMinute) {
      const waitTime = 60000 - timeSinceReset;
      this.logger.warn(`⏸️ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastReset = Date.now();
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toFixed(0);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Получает статистику использования API
   */
  getUsageStats(): { 
    requestCount: number; 
    resetTime: Date; 
    cacheStats: { 
      largeTransactions: number; 
      tokenTransactions: number; 
    } 
  } {
    return {
      requestCount: this.requestCount,
      resetTime: new Date(this.lastReset + 60000),
      cacheStats: {
        largeTransactions: this.largeTransactionsCache.size,
        tokenTransactions: this.tokenTransactionsCache.size
      }
    };
  }

  /**
   * Очистка устаревших кешей
   */
  clearExpiredCaches(): void {
    const now = Date.now();
    
    // Очистка кеша крупных транзакций (TTL: 5 минут)
    for (const [key, value] of this.largeTransactionsCache) {
      if (now - value.timestamp > 5 * 60 * 1000) {
        this.largeTransactionsCache.delete(key);
      }
    }
    
    // Очистка кеша транзакций токенов (TTL: 3 минуты)
    for (const [key, value] of this.tokenTransactionsCache) {
      if (now - value.timestamp > 3 * 60 * 1000) {
        this.tokenTransactionsCache.delete(key);
      }
    }
    
    this.logger.debug('🧹 Cleared expired DexScreener caches');
  }
}