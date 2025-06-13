// src/services/JupiterService.ts
import axios from 'axios';
import { Logger } from '../utils/Logger';

interface JupiterToken {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}

interface SwapInfo {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: any;
  priceImpactPct: string;
  routePlan: any[];
}

interface VolumeData {
  token: string;
  volume24h: number;
  volumeChange24h: number;
  swapCount24h: number;
  uniqueUsers24h: number;
}

export class JupiterService {
  private baseURL = 'https://quote-api.jup.ag/v6';
  private priceURL = 'https://price.jup.ag/v4';
  private logger: Logger;
  private requestCount = 0;
  private lastReset = Date.now();
  private maxRequestsPerMinute = 600; // Jupiter более щедрый лимит
  
  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Получает список всех токенов доступных на Jupiter
   */
  async getAllTokens(): Promise<JupiterToken[]> {
    try {
      await this.enforceRateLimit();
      
      this.logger.info('📋 Fetching all tokens from Jupiter...');
      const response = await axios.get(`${this.baseURL}/tokens`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data && Array.isArray(response.data)) {
        const tokens = response.data.filter((token: any) => 
          token.address && 
          token.symbol && 
          token.name &&
          !token.tags?.includes('unknown') // Фильтруем неизвестные токены
        );
        
        this.logger.info(`✅ Found ${tokens.length} verified tokens on Jupiter`);
        return tokens;
      }

      return [];
    } catch (error) {
      this.logger.error('❌ Error fetching Jupiter tokens:', error);
      return [];
    }
  }

  /**
   * Получает цены токенов (можно передать до 100 адресов за раз)
   */
  async getTokenPrices(tokenAddresses: string[]): Promise<Record<string, { price: number; timestamp: number }>> {
    try {
      await this.enforceRateLimit();
      
      // Jupiter Price API может обработать до 100 токенов за раз
      const chunks = this.chunkArray(tokenAddresses, 100);
      const allPrices: Record<string, { price: number; timestamp: number }> = {};
      
      for (const chunk of chunks) {
        try {
          const ids = chunk.join(',');
          const response = await axios.get(`${this.priceURL}/price`, {
            params: { ids },
            timeout: 10000,
            headers: {
              'User-Agent': 'SmartMoneyBot/1.0',
            }
          });

          this.requestCount++;
          
          if (response.data && response.data.data) {
            Object.assign(allPrices, response.data.data);
          }

          // Небольшая пауза между запросами
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (chunkError) {
          this.logger.warn(`⚠️ Error fetching prices for chunk: ${chunkError}`);
        }
      }
      
      this.logger.info(`✅ Fetched prices for ${Object.keys(allPrices).length} tokens`);
      return allPrices;
    } catch (error) {
      this.logger.error('❌ Error fetching token prices:', error);
      return {};
    }
  }

  /**
   * Получает топовые токены по объему свапов
   * Jupiter не предоставляет этот эндпоинт напрямую, но мы можем использовать
   * список популярных токенов и проверить их активность
   */
  async getTopVolumeTokens(): Promise<string[]> {
    try {
      this.logger.info('📊 Identifying high-volume tokens on Jupiter...');
      
      // Популярные токены на Solana, которые часто торгуются
      const popularTokens = [
        'So11111111111111111111111111111111111111112', // SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
        'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
        '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETHER
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
        'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
        '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
        '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', // INF
        'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
        '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk', // RAY
        'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', // HNT
        'CKaKtYvz6dKPyMvYq9Rh3UBrnNqYZAyd7iF4hJtjUvks', // GMT
        'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', // GST
      ];

      // Получаем цены для проверки активности
      const prices = await this.getTokenPrices(popularTokens);
      
      // Фильтруем токены, для которых удалось получить цены (признак активности)
      const activeTokens = popularTokens.filter(token => prices[token]);
      
      this.logger.info(`✅ Identified ${activeTokens.length} active high-volume tokens`);
      return activeTokens;
      
    } catch (error) {
      this.logger.error('❌ Error identifying top volume tokens:', error);
      return [];
    }
  }

  /**
   * Симулирует свап для получения лучшего маршрута
   * Полезно для определения ликвидности и популярности пар
   */
  async getSwapQuote(
    inputMint: string, 
    outputMint: string, 
    amount: number
  ): Promise<SwapInfo | null> {
    try {
      await this.enforceRateLimit();
      
      const response = await axios.get(`${this.baseURL}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: amount.toString(),
          slippageBps: 50, // 0.5% slippage
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartMoneyBot/1.0',
        }
      });

      this.requestCount++;
      
      if (response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.debug(`❌ Error getting swap quote for ${inputMint} -> ${outputMint}:`, error);
      return null;
    }
  }

  /**
   * Получает токены с лучшей ликвидностью путем тестирования свапов
   */
  async getHighLiquidityTokens(): Promise<string[]> {
    try {
      this.logger.info('💧 Testing token liquidity on Jupiter...');
      
      const testTokens = await this.getTopVolumeTokens();
      const solMint = 'So11111111111111111111111111111111111111112';
      const testAmount = 1000000000; // 1 SOL в lamports
      
      const liquidTokens: string[] = [];
      
      for (const token of testTokens) {
        if (token === solMint) {
          liquidTokens.push(token);
          continue;
        }
        
        try {
          // Тестируем свап SOL -> Token
          const quote = await this.getSwapQuote(solMint, token, testAmount);
          
          if (quote && quote.outAmount) {
            const outputAmount = parseInt(quote.outAmount);
            const priceImpact = parseFloat(quote.priceImpactPct);
            
            // Считаем токен ликвидным если:
            // 1. Можно получить выходную сумму
            // 2. Price impact < 5%
            if (outputAmount > 0 && priceImpact < 5) {
              liquidTokens.push(token);
            }
          }
          
          // Пауза между запросами
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          this.logger.debug(`⚠️ Could not test liquidity for ${token}`);
        }
      }
      
      this.logger.info(`✅ Found ${liquidTokens.length} highly liquid tokens`);
      return liquidTokens;
      
    } catch (error) {
      this.logger.error('❌ Error testing token liquidity:', error);
      return [];
    }
  }

  /**
   * Получает кандидатов кошельков через анализ Jupiter активности
   * Возвращает адреса токенов для дальнейшего RPC анализа
   */
  async getWalletCandidatesFromActivity(): Promise<string[]> {
    try {
      this.logger.info('🔍 Analyzing Jupiter activity for wallet candidates...');
      
      const candidates = new Set<string>();
      
      // 1. Получаем топовые токены по объему
      const volumeTokens = await this.getTopVolumeTokens();
      volumeTokens.forEach(token => candidates.add(token));
      
      // 2. Получаем токены с высокой ликвидностью
      const liquidTokens = await this.getHighLiquidityTokens();
      liquidTokens.forEach(token => candidates.add(token));
      
      // 3. Получаем новые токены из общего списка
      const allTokens = await this.getAllTokens();
      const recentTokens = allTokens
        .filter(token => 
          !token.tags?.includes('unknown') &&
          !token.tags?.includes('deprecated') &&
          token.symbol.length <= 10 // Разумная длина символа
        )
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .slice(0, 100) // Топ 100 новых токенов
        .map(token => token.address);
      
      recentTokens.forEach(token => candidates.add(token));
      
      const result = Array.from(candidates);
      this.logger.info(`✅ Collected ${result.length} token candidates from Jupiter analysis`);
      
      return result;
      
    } catch (error) {
      this.logger.error('❌ Error analyzing Jupiter activity:', error);
      return [];
    }
  }

  /**
   * Rate limiting для соблюдения лимитов Jupiter API
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
      this.logger.warn(`⏸️ Jupiter rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastReset = Date.now();
    }
  }

  /**
   * Разбивает массив на чанки
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
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