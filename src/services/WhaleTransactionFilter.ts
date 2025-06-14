// src/services/WhaleTransactionFilter.ts
import { Logger } from '../utils/Logger';
import axios from 'axios';

interface WhaleFilterCriteria {
  minAmountUSD: number;
  maxTransactionAge: number; // в минутах
  excludeTokenCreators: boolean;
  excludeTopHolders: boolean;
  maxTopHolderPercentage: number;
  minTokenAge: number; // в часах
  minTokenLiquidity: number;
  excludeRelatedWallets: boolean;
  maxRelatedWallets: number;
}

interface ValidationRequest {
  walletAddress: string;
  tokenAddress: string;
  amountUSD: number;
  timestamp: Date;
  swapType: 'buy' | 'sell';
}

interface ValidationResult {
  isValid: boolean;
  validationScore: number; // 0-100
  reason?: string;
  riskFlags: string[];
  details?: {
    isTokenCreator?: boolean;
    isTopHolder?: boolean;
    holdingPercentage?: number;
    tokenAge?: number;
    tokenLiquidity?: number;
    relatedWallets?: number;
  };
}

interface TokenInfo {
  age: number; // в часах
  liquidity: number;
  marketCap: number;
  holders: number;
  isCreatorKnown: boolean;
  creatorAddress?: string;
}

interface WalletAnalysis {
  isTokenCreator: boolean;
  isTopHolder: boolean;
  holdingPercentage: number;
  relatedWallets: string[];
  riskScore: number;
}

export class WhaleTransactionFilter {
  private logger: Logger;
  private criteria: WhaleFilterCriteria;

  // Кеши для оптимизации
  private tokenInfoCache = new Map<string, { info: TokenInfo; timestamp: number }>();
  private walletAnalysisCache = new Map<string, { analysis: WalletAnalysis; timestamp: number }>();
  private relatedWalletsCache = new Map<string, { wallets: string[]; timestamp: number }>();

  // Whitelist проверенных токенов и кошельков
  private trustedTokens = new Set<string>();
  private trustedWallets = new Set<string>();
  private knownScamTokens = new Set<string>();

  constructor() {
    this.logger = Logger.getInstance();
    
    // Настройки по умолчанию для фильтрации
    this.criteria = {
      minAmountUSD: 2_000_000, // $2M+
      maxTransactionAge: 10, // 10 минут
      excludeTokenCreators: true,
      excludeTopHolders: true,
      maxTopHolderPercentage: 20, // >20% от supply
      minTokenAge: 6, // 6 часов
      minTokenLiquidity: 100_000, // $100K
      excludeRelatedWallets: true,
      maxRelatedWallets: 3 // Максимум 3 связанных кошелька
    };

    this.initializeTrustedLists();
    this.logger.info('🛡️ Whale Transaction Filter initialized with anti-spam protection');
  }

  /**
   * Главный метод валидации транзакции кита
   */
  async validateWhaleTransaction(request: ValidationRequest): Promise<ValidationResult> {
    try {
      const riskFlags: string[] = [];
      let validationScore = 100;
      let details: any = {};

      // Уровень 1: Базовые проверки
      const basicValidation = this.performBasicValidation(request);
      if (!basicValidation.isValid) {
        return basicValidation;
      }

      // Проверка на whitelist/blacklist
      if (this.trustedTokens.has(request.tokenAddress)) {
        validationScore += 10; // Бонус за проверенный токен
        riskFlags.push('TRUSTED_TOKEN');
      }

      if (this.trustedWallets.has(request.walletAddress)) {
        validationScore += 15; // Бонус за проверенный кошелек
        riskFlags.push('TRUSTED_WALLET');
      }

      if (this.knownScamTokens.has(request.tokenAddress)) {
        return {
          isValid: false,
          validationScore: 0,
          reason: 'Known scam token',
          riskFlags: ['KNOWN_SCAM']
        };
      }

      // Уровень 2: Анализ токена
      const tokenInfo = await this.getTokenInfo(request.tokenAddress);
      details.tokenAge = tokenInfo.age;
      details.tokenLiquidity = tokenInfo.liquidity;

      if (tokenInfo.age < this.criteria.minTokenAge) {
        validationScore -= 25;
        riskFlags.push('NEW_TOKEN');
      }

      if (tokenInfo.liquidity < this.criteria.minTokenLiquidity) {
        validationScore -= 15;
        riskFlags.push('LOW_LIQUIDITY');
      }

      // Уровень 3: Анализ кошелька
      const walletAnalysis = await this.analyzeWallet(request.walletAddress, request.tokenAddress);
      details.isTokenCreator = walletAnalysis.isTokenCreator;
      details.isTopHolder = walletAnalysis.isTopHolder;
      details.holdingPercentage = walletAnalysis.holdingPercentage;

      if (this.criteria.excludeTokenCreators && walletAnalysis.isTokenCreator) {
        return {
          isValid: false,
          validationScore: 0,
          reason: 'Wallet is token creator',
          riskFlags: ['TOKEN_CREATOR'],
          details
        };
      }

      if (this.criteria.excludeTopHolders && walletAnalysis.isTopHolder) {
        if (walletAnalysis.holdingPercentage > this.criteria.maxTopHolderPercentage) {
          return {
            isValid: false,
            validationScore: 0,
            reason: `Top holder with ${walletAnalysis.holdingPercentage.toFixed(1)}% supply`,
            riskFlags: ['TOP_HOLDER'],
            details
          };
        } else {
          validationScore -= 20;
          riskFlags.push('LARGE_HOLDER');
        }
      }

      // Уровень 4: Анализ связанных кошельков
      const relatedWallets = await this.findRelatedWallets(request.walletAddress, request.tokenAddress);
      details.relatedWallets = relatedWallets.length;

      if (this.criteria.excludeRelatedWallets && relatedWallets.length > this.criteria.maxRelatedWallets) {
        validationScore -= 30;
        riskFlags.push('COORDINATED_ACTIVITY');
      }

      // Уровень 5: Проверка на wash trading
      const washTradingScore = await this.detectWashTrading(request.walletAddress, request.tokenAddress);
      if (washTradingScore > 70) {
        validationScore -= 40;
        riskFlags.push('WASH_TRADING');
      }

      // Уровень 6: Проверка временных паттернов
      const suspiciousTiming = await this.checkSuspiciousTiming(request.walletAddress, request.tokenAddress, request.timestamp);
      if (suspiciousTiming) {
        validationScore -= 15;
        riskFlags.push('SUSPICIOUS_TIMING');
      }

      // Финальная оценка
      validationScore = Math.max(0, Math.min(100, validationScore));
      const isValid = validationScore >= 50 && !riskFlags.includes('TOKEN_CREATOR') && !riskFlags.includes('KNOWN_SCAM');

      return {
        isValid,
        validationScore,
        riskFlags,
        details
      };

    } catch (error) {
      this.logger.error('❌ Error validating whale transaction:', error);
      return {
        isValid: false,
        validationScore: 0,
        reason: 'Validation error',
        riskFlags: ['VALIDATION_ERROR']
      };
    }
  }

  /**
   * Базовая валидация
   */
  private performBasicValidation(request: ValidationRequest): ValidationResult {
    // Проверка суммы
    if (request.amountUSD < this.criteria.minAmountUSD) {
      return {
        isValid: false,
        validationScore: 0,
        reason: `Amount too small: $${request.amountUSD.toFixed(0)}`,
        riskFlags: ['AMOUNT_TOO_SMALL']
      };
    }

    // Проверка возраста транзакции
    const ageMinutes = (Date.now() - request.timestamp.getTime()) / (1000 * 60);
    if (ageMinutes > this.criteria.maxTransactionAge) {
      return {
        isValid: false,
        validationScore: 0,
        reason: `Transaction too old: ${ageMinutes.toFixed(1)} minutes`,
        riskFlags: ['TRANSACTION_TOO_OLD']
      };
    }

    // Проверка адресов
    if (!this.isValidSolanaAddress(request.walletAddress) || !this.isValidSolanaAddress(request.tokenAddress)) {
      return {
        isValid: false,
        validationScore: 0,
        reason: 'Invalid Solana address',
        riskFlags: ['INVALID_ADDRESS']
      };
    }

    return { isValid: true, validationScore: 100, riskFlags: [] };
  }

  /**
   * Получение информации о токене
   */
  private async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const cached = this.tokenInfoCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) { // 30 минут кеш
      return cached.info;
    }

    try {
      // Используем DexScreener для получения информации о токене
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
        timeout: 5000
      });

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const now = Date.now();
        const createdAt = pair.pairCreatedAt ? pair.pairCreatedAt * 1000 : now;
        const age = (now - createdAt) / (1000 * 60 * 60); // в часах

        const tokenInfo: TokenInfo = {
          age,
          liquidity: parseFloat(pair.liquidity?.usd || '0'),
          marketCap: parseFloat(pair.marketCap || '0'),
          holders: 0, // DexScreener не предоставляет данные о холдерах
          isCreatorKnown: false,
          creatorAddress: undefined
        };

        this.tokenInfoCache.set(tokenAddress, {
          info: tokenInfo,
          timestamp: Date.now()
        });

        return tokenInfo;
      }

    } catch (error) {
      this.logger.debug(`❌ Error getting token info for ${tokenAddress}:`, error);
    }

    // Возвращаем дефолтные значения если не удалось получить данные
    return {
      age: 0,
      liquidity: 0,
      marketCap: 0,
      holders: 0,
      isCreatorKnown: false
    };
  }

  /**
   * Анализ кошелька
   */
  private async analyzeWallet(walletAddress: string, tokenAddress: string): Promise<WalletAnalysis> {
    const cacheKey = `${walletAddress}-${tokenAddress}`;
    const cached = this.walletAnalysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) { // 15 минут кеш
      return cached.analysis;
    }

    try {
      // Здесь должен быть реальный анализ кошелька через RPC
      // Для демонстрации используем упрощенную логику
      const analysis: WalletAnalysis = {
        isTokenCreator: false,
        isTopHolder: false,
        holdingPercentage: 0,
        relatedWallets: [],
        riskScore: 0
      };

      // В реальной реализации здесь бы был вызов RPC для проверки:
      // 1. Является ли кошелек создателем токена
      // 2. Процент владения токеном
      // 3. История транзакций
      // 4. Связанные кошельки

      this.walletAnalysisCache.set(cacheKey, {
        analysis,
        timestamp: Date.now()
      });

      return analysis;

    } catch (error) {
      this.logger.debug(`❌ Error analyzing wallet ${walletAddress}:`, error);
      return {
        isTokenCreator: false,
        isTopHolder: false,
        holdingPercentage: 0,
        relatedWallets: [],
        riskScore: 0
      };
    }
  }

  /**
   * Поиск связанных кошельков
   */
  private async findRelatedWallets(walletAddress: string, tokenAddress: string): Promise<string[]> {
    const cacheKey = `${walletAddress}-${tokenAddress}`;
    const cached = this.relatedWalletsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 20 * 60 * 1000) { // 20 минут кеш
      return cached.wallets;
    }

    try {
      // В реальной реализации здесь был бы анализ:
      // 1. Кошельки с похожими паттернами транзакций
      // 2. Кошельки с синхронными операциями
      // 3. Кошельки с общими токенами в больших количествах
      
      const relatedWallets: string[] = [];

      this.relatedWalletsCache.set(cacheKey, {
        wallets: relatedWallets,
        timestamp: Date.now()
      });

      return relatedWallets;

    } catch (error) {
      this.logger.debug(`❌ Error finding related wallets for ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Детекция wash trading
   */
  private async detectWashTrading(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      // В реальной реализации анализировали бы:
      // 1. Много мелких покупок/продаж в короткий период
      // 2. Круговые транзакции между связанными кошельками  
      // 3. Искусственное создание объема
      
      return 0; // Пока возвращаем 0 (нет wash trading)

    } catch (error) {
      this.logger.debug(`❌ Error detecting wash trading for ${walletAddress}:`, error);
      return 0;
    }
  }

  /**
   * Проверка подозрительного тайминга
   */
  private async checkSuspiciousTiming(walletAddress: string, tokenAddress: string, timestamp: Date): Promise<boolean> {
    try {
      // В реальной реализации проверяли бы:
      // 1. Покупка сразу после создания токена
      // 2. Координированные покупки нескольких кошельков
      // 3. Покупки перед крупными событиями/листингами
      
      return false; // Пока возвращаем false

    } catch (error) {
      this.logger.debug(`❌ Error checking suspicious timing for ${walletAddress}:`, error);
      return false;
    }
  }

  /**
   * Инициализация whitelist/blacklist
   */
  private initializeTrustedLists(): void {
    // Проверенные токены (основные токены экосистемы)
    this.trustedTokens.add('So11111111111111111111111111111111111111112'); // WSOL
    this.trustedTokens.add('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
    this.trustedTokens.add('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'); // USDT
    this.trustedTokens.add('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'); // mSOL

    // Проверенные кошельки (можно добавить известные биржи, фонды и т.д.)
    // В реальной реализации это загружалось бы из конфигурации

    this.logger.info(`🛡️ Initialized trusted lists: ${this.trustedTokens.size} tokens, ${this.trustedWallets.size} wallets`);
  }

  /**
   * Обновление критериев фильтрации
   */
  updateCriteria(newCriteria: Partial<WhaleFilterCriteria>): void {
    this.criteria = { ...this.criteria, ...newCriteria };
    this.logger.info('⚙️ Updated whale filter criteria:', newCriteria);
  }

  /**
   * Добавление токена в whitelist
   */
  addTrustedToken(tokenAddress: string): void {
    this.trustedTokens.add(tokenAddress);
    this.logger.info(`✅ Added trusted token: ${tokenAddress}`);
  }

  /**
   * Добавление токена в blacklist
   */
  addScamToken(tokenAddress: string): void {
    this.knownScamTokens.add(tokenAddress);
    this.logger.info(`🚫 Added scam token: ${tokenAddress}`);
  }

  /**
   * Получение статистики фильтра
   */
  getStats(): {
    criteria: WhaleFilterCriteria;
    cacheStats: {
      tokenInfo: number;
      walletAnalysis: number;
      relatedWallets: number;
    };
    trustedLists: {
      tokens: number;
      wallets: number;
      scamTokens: number;
    };
  } {
    return {
      criteria: this.criteria,
      cacheStats: {
        tokenInfo: this.tokenInfoCache.size,
        walletAnalysis: this.walletAnalysisCache.size,
        relatedWallets: this.relatedWalletsCache.size
      },
      trustedLists: {
        tokens: this.trustedTokens.size,
        wallets: this.trustedWallets.size,
        scamTokens: this.knownScamTokens.size
      }
    };
  }

  /**
   * Очистка устаревших кешей
   */
  clearExpiredCaches(): void {
    const now = Date.now();
    
    // Очистка кеша токенов (TTL: 30 минут)
    for (const [key, value] of this.tokenInfoCache) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        this.tokenInfoCache.delete(key);
      }
    }

    // Очистка кеша анализа кошельков (TTL: 15 минут)
    for (const [key, value] of this.walletAnalysisCache) {
      if (now - value.timestamp > 15 * 60 * 1000) {
        this.walletAnalysisCache.delete(key);
      }
    }

    // Очистка кеша связанных кошельков (TTL: 20 минут)
    for (const [key, value] of this.relatedWalletsCache) {
      if (now - value.timestamp > 20 * 60 * 1000) {
        this.relatedWalletsCache.delete(key);
      }
    }

    this.logger.debug('🧹 Cleared expired caches');
  }

  // Вспомогательные методы
  private isValidSolanaAddress(address: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
}