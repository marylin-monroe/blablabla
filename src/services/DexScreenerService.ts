// src/services/DexScreenerService.ts
import axios from 'axios';
import { Logger } from '../utils/Logger';

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
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info: {
    imageUrl?: string;
    websites?: Array<{ label: string; url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

interface WalletCandidate {
  address: string;
  volume24h: number;
  tradeCount: number;
  lastSeen: Date;
  tokens: string[];
  score: number;
}

export class DexScreenerService {
  private baseURL = 'https://api.dexscreener.com/latest';
  private logger: Logger;
  private requestCount = 0;
  private lastReset = Date.now();
  private maxRequestsPerMinute = 300; // DexScreener лимит
  
  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Получает топовые токены по объему торговли
   */
  async getTrendingTokens(chainId: string = 'solana'): Promise<TokenData[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('🔍 Fetching trending tokens from DexScreener...');
      const response = await axios.get(`${this.baseURL}/dex/tokens/trending/${chainId}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && response.data.pairs) {
        const tokens = response.data.pairs.slice(0, 50); // Топ 50 токенов
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
   * Получает токены по объему торгов за последние 24 часа
   */
  async getTopVolumeTokens(chainId: string = 'solana'): Promise<TokenData[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('📊 Fetching top volume tokens from DexScreener...');
      const response = await axios.get(`${this.baseURL}/dex/search`, {
        params: {
          q: chainId,
          order: 'volume24h',
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
          .slice(0, 30);
        
        this.logger.info(`✅ Found ${newTokens.length} new promising tokens`);
        return newTokens;
      }

      return [];
    } catch (error) {
      this.logger.error('❌ Error fetching new tokens:', error);
      return [];
    }
  }

  /**
   * Получает информацию о конкретном токене и его топовых трейдерах
   * ВНИМАНИЕ: DexScreener не предоставляет информацию о трейдерах напрямую
   * Этот метод возвращает информацию о токене для дальнейшего анализа
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenData | null> {
    try {
      await this.enforceRateLimit();
      
      this.logger.debug(`🔍 Fetching token info for ${tokenAddress}...`);
      const response = await axios.get(`${this.baseURL}/dex/tokens/${tokenAddress}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        // Берем пару с наибольшей ликвидностью
        const bestPair = response.data.pairs
          .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        
        return bestPair;
      }

      return null;
    } catch (error) {
      this.logger.error(`❌ Error fetching token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Комбинированный метод для получения кандидатов кошельков
   * Возвращает адреса токенов для дальнейшего анализа через blockchain RPC
   */
  async getWalletCandidatesFromTokens(): Promise<string[]> {
    try {
      this.logger.info('🚀 Starting comprehensive token analysis for wallet candidates...');
      
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

  /**
   * Получает статистику использования API
   */
  getUsageStats(): { requestCount: number; resetTime: Date } {
    return {
      requestCount: this.requestCount,
      resetTime: new Date(this.lastReset + 60000)
    };
  }
}