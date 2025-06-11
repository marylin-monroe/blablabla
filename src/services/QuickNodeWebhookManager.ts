// src/services/QuickNodeWebhookManager.ts - ПОЛНАЯ ВЕРСИЯ с ALCHEMY + ВСЕ ИСПРАВЛЕНИЯ
import { Logger } from '../utils/Logger';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { SmartMoneyWallet, SmartMoneySwap } from '../types';

interface QuickNodeStreamConfig {
  name: string;
  webhook_url: string;
  filters: Array<{
    program_id?: string[];
    account_type?: string;
  }>;
  region?: string;
}

interface QuickNodeStreamResponse {
  id: string;
  name: string;
  webhook_url: string;
  status: string;
  filters: any;
}

// 🚀 УЛУЧШЕННАЯ СТРУКТУРА API ЛИМИТОВ С ЗАЩИТОЙ ОТ RACE CONDITIONS
interface ApiLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  currentMinuteRequests: number;
  currentDayRequests: number;
  minuteReset: number;
  dayReset: number;
  lastRequestTime: number; // Для дополнительной защиты
}

// 🆕 СТРУКТУРА ДЛЯ ПРОВАЙДЕРОВ
interface RpcProvider {
  name: string;
  url: string;
  key?: string;
  isHealthy: boolean;
  requestCount: number;
  errorCount: number;
  lastError?: string;
  lastErrorTime?: number;
}

export class QuickNodeWebhookManager {
  private logger: Logger;
  
  // 🆕 МУЛЬТИ-ПРОВАЙДЕР СИСТЕМА
  private providers: RpcProvider[] = [];
  private currentProviderIndex: number = 0;
  
  private smDatabase: SmartMoneyDatabase | null = null;
  private telegramNotifier: TelegramNotifier | null = null;
  
  // 🔥 ОПТИМИЗИРОВАННЫЙ POLLING SERVICE
  private isPollingActive: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastProcessedSignatures = new Map<string, string>();
  private monitoredWallets: SmartMoneyWallet[] = [];
  
  // 🚀 АГРЕССИВНОЕ КЕШИРОВАНИЕ
  private tokenInfoCache = new Map<string, { 
    symbol: string; 
    name: string; 
    timestamp: number; 
    price?: number;
  }>();
  private priceCache = new Map<string, { price: number; timestamp: number }>();
  
  // 🔒 ЗАЩИТА ОТ RACE CONDITIONS
  private apiLimits: ApiLimits = {
    requestsPerMinute: 25,        // Консервативно для двух провайдеров
    requestsPerDay: 10000,        // Снижено для безопасности
    currentMinuteRequests: 0,
    currentDayRequests: 0,
    minuteReset: Date.now() + 60000,
    dayReset: Date.now() + 86400000,
    lastRequestTime: 0
  };
  
  // 🔒 МЬЮТЕКСЫ ДЛЯ БЕЗОПАСНОСТИ
  private apiLimitMutex: boolean = false;
  private isPollingInProgress: boolean = false;
  private providerSwitchMutex: boolean = false;

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeProviders();
    this.startHealthCheck();
  }

  // 🆕 ИНИЦИАЛИЗАЦИЯ ПРОВАЙДЕРОВ
  private initializeProviders(): void {
    // Основной провайдер - QuickNode
    if (process.env.QUICKNODE_HTTP_URL && process.env.QUICKNODE_API_KEY) {
      this.providers.push({
        name: 'QuickNode',
        url: process.env.QUICKNODE_HTTP_URL,
        key: process.env.QUICKNODE_API_KEY,
        isHealthy: true,
        requestCount: 0,
        errorCount: 0
      });
      this.logger.info('✅ QuickNode provider initialized');
    }

    // Резервный провайдер - Alchemy
    if (process.env.ALCHEMY_HTTP_URL && process.env.ALCHEMY_API_KEY) {
      this.providers.push({
        name: 'Alchemy',
        url: process.env.ALCHEMY_HTTP_URL,
        key: process.env.ALCHEMY_API_KEY,
        isHealthy: true,
        requestCount: 0,
        errorCount: 0
      });
      this.logger.info('✅ Alchemy provider initialized as fallback');
    }

    if (this.providers.length === 0) {
      throw new Error('No RPC providers configured!');
    }

    this.logger.info(`🚀 Initialized ${this.providers.length} RPC providers`);
  }

  setDependencies(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier): void {
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
  }

  async createDEXMonitoringStream(webhookUrl: string): Promise<string> {
    try {
      this.logger.info('🔗 Creating QuickNode stream...');

      const dexPrograms = [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
        '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
      ];

      const streamConfig: QuickNodeStreamConfig = {
        name: 'smart-money-dex-monitor-optimized-v2',
        webhook_url: webhookUrl,
        filters: [{
          program_id: dexPrograms,
          account_type: 'transaction'
        }],
        region: 'us-east-1'
      };

      const endpoints = [
        'https://api.quicknode.com/v1/streams',
        `${this.getApiBaseUrl()}/streams`,
        `${this.providers[0]?.url?.replace('/rpc', '')}/api/v1/streams`
      ];

      let lastError: any = null;
      
      for (const endpoint of endpoints) {
        try {
          if (!this.canMakeRequest()) {
            this.logger.warn('⚠️ API rate limit reached, starting polling mode immediately');
            await this.startPollingMode();
            return 'polling-mode';
          }

          this.trackApiRequest();
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.providers[0]?.key || '',
              'Authorization': `Bearer ${this.providers[0]?.key || ''}`,
              'User-Agent': 'Solana-Smart-Money-Bot/4.0-MultiProvider'
            },
            body: JSON.stringify(streamConfig)
          });

          if (response.ok) {
            const streamData = await response.json() as QuickNodeStreamResponse;
            this.logger.info(`✅ QuickNode stream created: ${streamData.id}`);
            return streamData.id;
          } else {
            const errorText = await response.text();
            this.logger.warn(`❌ Endpoint ${endpoint} failed: ${response.status} - ${errorText}`);
            lastError = new Error(`${response.status}: ${errorText}`);
          }
        } catch (error) {
          this.logger.warn(`❌ Endpoint ${endpoint} error:`, error);
          lastError = error;
        }
      }

      this.logger.error('❌ All QuickNode Streams endpoints failed, starting polling mode');
      await this.startPollingMode();
      return 'polling-mode';

    } catch (error) {
      this.logger.error('❌ Error creating QuickNode stream:', error);
      await this.startPollingMode();
      return 'polling-mode';
    }
  }

  // 🔥 СУПЕР ОПТИМИЗИРОВАННЫЙ POLLING MODE С МУЛЬТИ-ПРОВАЙДЕРАМИ
  async startPollingMode(): Promise<void> {
    if (this.isPollingActive) return;
    if (!this.smDatabase || !this.telegramNotifier) {
      this.logger.error('❌ Dependencies not set for polling mode');
      return;
    }

    this.logger.info('🔄 Starting OPTIMIZED multi-provider polling mode...');
    
    try {
      // Получаем только включенные Smart Money кошельки
      this.monitoredWallets = await this.smDatabase.getAllActiveSmartWallets();
      
      // 🔥 СТРОГИЕ ФИЛЬТРЫ
      this.monitoredWallets = this.monitoredWallets.filter(w => {
        const daysSinceActive = (Date.now() - w.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActive > 30) return false;
        if (w.performanceScore < 75) return false;
        if (w.winRate < 65) return false;
        return true;
      }).slice(0, 20); // МАКСИМУМ 20 кошельков!

      this.logger.info(`🎯 Monitoring ${this.monitoredWallets.length}/20 TOP Smart Money wallets (Multi-Provider)`);
      this.isPollingActive = true;

      // 🚀 УВЕЛИЧЕННЫЙ ИНТЕРВАЛ: 5 МИНУТ
      this.pollingInterval = setInterval(async () => {
        try {
          if (this.canMakeRequest()) {
            await this.pollSmartMoneyWallets();
          } else {
            this.logger.warn('⚠️ API rate limit reached, skipping polling cycle');
          }
        } catch (error) {
          this.logger.error('❌ Error in polling cycle:', error);
        }
      }, 5 * 60 * 1000); // 🔥 5 МИНУТ

      // Первый запуск через 10 секунд
      setTimeout(() => {
        if (this.canMakeRequest()) {
          this.pollSmartMoneyWallets();
        }
      }, 10000);

      this.logger.info('✅ OPTIMIZED multi-provider polling started: 5min intervals, max 20 wallets');

    } catch (error) {
      this.logger.error('❌ Failed to start optimized polling mode:', error);
    }
  }

  stopPollingMode(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPollingActive = false;
    this.logger.info('🔴 Optimized polling mode stopped');
  }

  // 🔥 ЗАЩИЩЕННЫЙ ОТ RACE CONDITIONS POLLING
  private async pollSmartMoneyWallets(): Promise<void> {
    // 🔒 ЗАЩИТА ОТ ПАРАЛЛЕЛЬНОГО ВЫПОЛНЕНИЯ
    if (this.isPollingInProgress) {
      this.logger.warn('⚠️ Polling already in progress, skipping...');
      return;
    }
    
    if (!this.isPollingActive || this.monitoredWallets.length === 0) return;

    try {
      this.isPollingInProgress = true;
      this.logger.info(`🔍 Polling ${this.monitoredWallets.length} Smart Money wallets...`);
      
      // 🔥 ОБРАБАТЫВАЕМ МАКСИМУМ 3 КОШЕЛЬКА ЗА РАЗ
      const batchSize = 3;
      const batches = [];
      
      for (let i = 0; i < this.monitoredWallets.length; i += batchSize) {
        batches.push(this.monitoredWallets.slice(i, i + batchSize));
      }

      // Обрабатываем каждый батч с паузами
      for (const batch of batches) {
        if (!this.canMakeRequest()) {
          this.logger.warn('⚠️ API limit reached, stopping polling for this cycle');
          break;
        }

        const promises = batch.map(wallet => this.checkWalletForNewTransactions(wallet));
        await Promise.allSettled(promises);
        
        // 🔥 ПАУЗА между батчами: 5 секунд
        await this.sleep(5000);
      }

      // Логируем статистику API
      this.logApiUsage();

    } catch (error) {
      this.logger.error('❌ Error in optimized polling:', error);
    } finally {
      // 🔒 ВСЕГДА ОСВОБОЖДАЕМ ФЛАГ
      this.isPollingInProgress = false;
    }
  }

  private async checkWalletForNewTransactions(wallet: SmartMoneyWallet): Promise<void> {
    try {
      if (!this.canMakeRequest()) return;

      const walletAddress = wallet.address;
      const lastSignature = this.lastProcessedSignatures.get(walletAddress);

      this.trackApiRequest();
      const signatures = await this.getWalletSignatures(walletAddress, lastSignature);
      
      if (signatures.length === 0) return;

      // Обновляем последнюю обработанную транзакцию
      this.lastProcessedSignatures.set(walletAddress, signatures[0].signature);

      // 🔥 ОБРАБАТЫВАЕМ ТОЛЬКО ПЕРВЫЕ 3 ТРАНЗАКЦИИ
      for (const sigInfo of signatures.slice(0, 3).reverse()) {
        try {
          if (!this.canMakeRequest()) break;
          
          await this.processWalletTransaction(sigInfo.signature, wallet);
          await this.sleep(200); // Пауза между транзакциями
        } catch (error) {
          this.logger.error(`❌ Error processing transaction ${sigInfo.signature}:`, error);
        }
      }

    } catch (error) {
      this.logger.error(`❌ Error checking wallet ${wallet.address}:`, error);
    }
  }

  // 🆕 УНИВЕРСАЛЬНЫЙ МЕТОД RPC ЗАПРОСОВ С МУЛЬТИ-ПРОВАЙДЕРАМИ
  private async makeRpcRequest(method: string, params: any[], maxRetries: number = 2): Promise<any> {
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getCurrentProvider();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      try {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        });

        const response = await fetch(provider.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          
          // Обновляем статистику провайдера
          provider.requestCount++;
          
          this.logger.debug(`✅ ${provider.name} success: ${method}`);
          return data;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        provider.errorCount++;
        provider.lastError = error instanceof Error ? error.message : 'Unknown error';
        provider.lastErrorTime = Date.now();
        
        this.logger.warn(`⚠️ ${provider.name} failed for ${method}: ${provider.lastError}`);
        
        // Переключаемся на следующий провайдер
        await this.switchToNextProvider();
      }
    }

    throw lastError || new Error(`All providers failed for ${method}`);
  }

  // 🆕 ПОЛУЧЕНИЕ ТЕКУЩЕГО ПРОВАЙДЕРА
  private getCurrentProvider(): RpcProvider {
    // Ищем здоровый провайдер
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[this.currentProviderIndex];
      if (provider.isHealthy) {
        return provider;
      }
      this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    }
    
    // Если все нездоровы, возвращаем текущий
    return this.providers[this.currentProviderIndex];
  }

  // 🆕 ПЕРЕКЛЮЧЕНИЕ НА СЛЕДУЮЩИЙ ПРОВАЙДЕР
  private async switchToNextProvider(): Promise<void> {
    if (this.providerSwitchMutex) return;
    
    this.providerSwitchMutex = true;
    
    const oldIndex = this.currentProviderIndex;
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    
    if (oldIndex !== this.currentProviderIndex) {
      this.logger.info(`🔄 Switched from ${this.providers[oldIndex].name} to ${this.providers[this.currentProviderIndex].name}`);
    }
    
    setTimeout(() => {
      this.providerSwitchMutex = false;
    }, 1000);
  }

  // 🆕 ПРОВЕРКА ЗДОРОВЬЯ ПРОВАЙДЕРОВ
  private async startHealthCheck(): Promise<void> {
    setInterval(async () => {
      for (const provider of this.providers) {
        const healthController = new AbortController();
        const healthTimeoutId = setTimeout(() => healthController.abort(), 5000);
        
        try {
          const startTime = Date.now();
          await fetch(provider.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getSlot',
              params: []
            }),
            signal: healthController.signal
          });
          
          clearTimeout(healthTimeoutId);
          
          const responseTime = Date.now() - startTime;
          const wasUnhealthy = !provider.isHealthy;
          
          provider.isHealthy = responseTime < 10000; // 10 секунд таймаут
          
          if (wasUnhealthy && provider.isHealthy) {
            this.logger.info(`💚 ${provider.name} recovered (${responseTime}ms)`);
          }
          
        } catch (error) {
          clearTimeout(healthTimeoutId);
          if (provider.isHealthy) {
            this.logger.warn(`💔 ${provider.name} marked unhealthy`);
          }
          provider.isHealthy = false;
        }
      }
    }, 2 * 60 * 1000); // Каждые 2 минуты
  }

  // 🔥 ОБНОВЛЕННЫЕ МЕТОДЫ С МУЛЬТИ-ПРОВАЙДЕРАМИ
  private async getWalletSignatures(walletAddress: string, beforeSignature?: string): Promise<Array<{signature: string; blockTime: number}>> {
    try {
      const params: any = [
        walletAddress,
        {
          limit: 5,
          commitment: 'confirmed'
        }
      ];

      if (beforeSignature) {
        params[1].before = beforeSignature;
      }

      const data = await this.makeRpcRequest('getSignaturesForAddress', params);
      return data.result || [];

    } catch (error) {
      this.logger.error(`Error getting signatures for ${walletAddress}:`, error);
      return [];
    }
  }

  private async getTransactionDetails(signature: string): Promise<any> {
    try {
      const data = await this.makeRpcRequest('getTransaction', [
        signature,
        {
          encoding: 'jsonParsed',
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        }
      ]);

      return data.result;

    } catch (error) {
      this.logger.error(`Error getting transaction details for ${signature}:`, error);
      return null;
    }
  }

  private async processWalletTransaction(signature: string, wallet: SmartMoneyWallet): Promise<void> {
    try {
      if (!this.canMakeRequest()) return;

      this.trackApiRequest();
      const transaction = await this.getTransactionDetails(signature);
      if (!transaction) return;

      const swaps = await this.extractSwapsFromTransaction(transaction, wallet);
      
      for (const swap of swaps) {
        if (this.shouldProcessSmartMoneySwapOptimized(swap, wallet)) {
          await this.saveAndNotifySwap(swap);
          this.logger.info(`🔥 SM swap: ${swap.tokenSymbol} - $${swap.amountUSD.toFixed(0)}`);
        }
      }

    } catch (error) {
      this.logger.error(`Error processing transaction ${signature}:`, error);
    }
  }

  private async extractSwapsFromTransaction(transaction: any, wallet: SmartMoneyWallet): Promise<SmartMoneySwap[]> {
    const swaps: SmartMoneySwap[] = [];

    try {
      if (!transaction || !transaction.meta || transaction.meta.err) return swaps;

      const preTokenBalances = transaction.meta.preTokenBalances || [];
      const postTokenBalances = transaction.meta.postTokenBalances || [];
      const blockTime = transaction.blockTime;

      for (const postBalance of postTokenBalances) {
        if (postBalance.owner !== wallet.address) continue;

        const preBalance = preTokenBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex
        );

        const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
        const difference = postAmount - preAmount;

        if (Math.abs(difference) < 10) continue;

        const tokenMint = postBalance.mint;
        const tokenInfo = await this.getTokenInfoCached(tokenMint);

        const swapType: 'buy' | 'sell' = difference > 0 ? 'buy' : 'sell';
        const tokenAmount = Math.abs(difference);
        
        const estimatedUSD = await this.estimateTokenValueUSDCached(tokenMint, tokenAmount);

        if (estimatedUSD > 5000) {
          const swap: SmartMoneySwap = {
            transactionId: transaction.transaction.signatures[0],
            walletAddress: wallet.address,
            tokenAddress: tokenMint,
            tokenSymbol: tokenInfo.symbol,
            tokenName: tokenInfo.name,
            tokenAmount,
            amountUSD: estimatedUSD,
            swapType,
            timestamp: new Date(blockTime * 1000),
            category: wallet.category,
            winRate: wallet.winRate,
            pnl: wallet.totalPnL,
            totalTrades: wallet.totalTrades,
            isFamilyMember: false,
            familySize: 0,
            familyId: undefined
          };

          swaps.push(swap);
        }
      }

    } catch (error) {
      this.logger.error('Error extracting swaps from transaction:', error);
    }

    return swaps;
  }

  // 🔥 АГРЕССИВНЫЕ ФИЛЬТРЫ ДЛЯ ЭКОНОМИИ API
  private shouldProcessSmartMoneySwapOptimized(swap: SmartMoneySwap, wallet: SmartMoneyWallet): boolean {
    const minAmounts: Record<string, number> = {
      sniper: 8000,
      hunter: 10000,
      trader: 25000
    };

    const minAmount = minAmounts[wallet.category] || 10000;
    if (swap.amountUSD < minAmount) return false;

    const daysSinceActive = (Date.now() - wallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 15) return false;

    if (wallet.winRate < 70) return false;

    if (wallet.performanceScore < 80) return false;

    return true;
  }

  // 🚀 КЕШИРОВАНИЕ ИНФОРМАЦИИ О ТОКЕНАХ (24 ЧАСА)
  private async getTokenInfoCached(tokenMint: string): Promise<{ symbol: string; name: string }> {
    const cached = this.tokenInfoCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      return { symbol: cached.symbol, name: cached.name };
    }

    if (!this.canMakeRequest()) {
      return { symbol: 'UNKNOWN', name: 'Unknown Token' };
    }

    try {
      this.trackApiRequest();
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAccounts: [tokenMint] })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
          const tokenInfo = {
            symbol: data[0].onChainMetadata?.metadata?.symbol || 'UNKNOWN',
            name: data[0].onChainMetadata?.metadata?.name || 'Unknown Token',
            timestamp: Date.now()
          };
          
          this.tokenInfoCache.set(tokenMint, tokenInfo);
          return { symbol: tokenInfo.symbol, name: tokenInfo.name };
        }
      }
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenMint}:`, error);
    }

    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  }

  // 🚀 КЕШИРОВАНИЕ ЦЕН ТОКЕНОВ (5 МИНУТ)
  private async estimateTokenValueUSDCached(tokenMint: string, amount: number): Promise<number> {
    const cached = this.priceCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.price * amount;
    }

    if (!this.canMakeRequest()) {
      return amount * 0.01;
    }

    try {
      this.trackApiRequest();
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      
      if (response.ok) {
        const data = await response.json() as any;
        if (data.pairs && data.pairs.length > 0) {
          const price = parseFloat(data.pairs[0].priceUsd || '0');
          
          this.priceCache.set(tokenMint, {
            price,
            timestamp: Date.now()
          });
          
          return price * amount;
        }
      }
    } catch (error) {
      // Игнорируем ошибки
    }

    return amount * 0.01;
  }

  // 🚀 УЛУЧШЕННЫЕ API RATE LIMITING METHODS С МЬЮТЕКСОМ
  private canMakeRequest(): boolean {
    // 🔒 ЗАЩИТА ОТ RACE CONDITIONS
    if (this.apiLimitMutex) {
      return false;
    }
    
    const now = Date.now();
    
    // Дополнительная защита - минимальный интервал между запросами
    if (now - this.apiLimits.lastRequestTime < 100) { // 100ms минимум
      return false;
    }
    
    // Сброс счетчиков
    if (now > this.apiLimits.minuteReset) {
      this.apiLimits.currentMinuteRequests = 0;
      this.apiLimits.minuteReset = now + 60000;
    }
    
    if (now > this.apiLimits.dayReset) {
      this.apiLimits.currentDayRequests = 0;
      this.apiLimits.dayReset = now + 86400000;
    }
    
    return this.apiLimits.currentMinuteRequests < this.apiLimits.requestsPerMinute &&
           this.apiLimits.currentDayRequests < this.apiLimits.requestsPerDay;
  }
  
  private trackApiRequest(): void {
    // 🔒 УСТАНАВЛИВАЕМ МЬЮТЕКС
    this.apiLimitMutex = true;
    
    const now = Date.now();
    this.apiLimits.currentMinuteRequests++;
    this.apiLimits.currentDayRequests++;
    this.apiLimits.lastRequestTime = now;
    
    // 🔒 ОСВОБОЖДАЕМ МЬЮТЕКС ЧЕРЕЗ МИНИМАЛЬНУЮ ЗАДЕРЖКУ
    setTimeout(() => {
      this.apiLimitMutex = false;
    }, 10);
  }
  
  private logApiUsage(): void {
    const minuteUsage = (this.apiLimits.currentMinuteRequests / this.apiLimits.requestsPerMinute * 100).toFixed(1);
    const dayUsage = (this.apiLimits.currentDayRequests / this.apiLimits.requestsPerDay * 100).toFixed(1);
    
    const currentProvider = this.getCurrentProvider();
    this.logger.info(`📊 API Usage: ${minuteUsage}% minute, ${dayUsage}% daily | Provider: ${currentProvider.name}`);
  }

  private async saveAndNotifySwap(swap: SmartMoneySwap): Promise<void> {
    try {
      if (!this.smDatabase || !this.telegramNotifier) return;

      const stmt = this.smDatabase['db'].prepare(`
        INSERT OR IGNORE INTO smart_money_transactions (
          transaction_id, wallet_address, token_address, token_symbol, token_name,
          amount, amount_usd, swap_type, timestamp, dex,
          wallet_category, is_family_member, family_id,
          wallet_pnl, wallet_win_rate, wallet_total_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        swap.transactionId, swap.walletAddress, swap.tokenAddress, swap.tokenSymbol, swap.tokenName,
        swap.tokenAmount, swap.amountUSD, swap.swapType, swap.timestamp.toISOString(), 'Multi-Provider',
        swap.category, 0, null, swap.pnl, swap.winRate, swap.totalTrades
      );

      await this.telegramNotifier.sendSmartMoneySwap(swap);

    } catch (error) {
      this.logger.error('Error saving and notifying swap:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ С ОБНОВЛЕНИЯМИ
  private getApiBaseUrl(): string {
    const primaryProvider = this.providers[0];
    if (!primaryProvider) return '';
    
    const baseUrl = primaryProvider.url.replace(/\/$/, '');
    return baseUrl.replace(/\/rpc$/, '') + '/api/v1';
  }

  async deleteStream(streamId: string): Promise<void> {
    try {
      if (streamId === 'polling-mode') {
        this.stopPollingMode();
        return;
      }

      this.logger.info(`🗑️ Deleting QuickNode stream: ${streamId}`);

      if (!this.canMakeRequest()) {
        this.logger.warn('⚠️ Cannot delete stream - API limit reached');
        return;
      }

      this.trackApiRequest();
      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': this.providers[0]?.key || '',
          'Authorization': `Bearer ${this.providers[0]?.key || ''}`,
          'User-Agent': 'Solana-Smart-Money-Bot/4.0-MultiProvider'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      this.logger.info(`✅ QuickNode stream deleted: ${streamId}`);

    } catch (error) {
      this.logger.error('❌ Error deleting QuickNode stream:', error);
    }
  }

  async listStreams(): Promise<QuickNodeStreamResponse[]> {
    try {
      if (!this.canMakeRequest()) {
        this.logger.warn('⚠️ Cannot list streams - API limit reached');
        return [];
      }

      this.trackApiRequest();
      const response = await fetch(`${this.getApiBaseUrl()}/streams`, {
        method: 'GET',
        headers: {
          'x-api-key': this.providers[0]?.key || '',
          'Authorization': `Bearer ${this.providers[0]?.key || ''}`,
          'User-Agent': 'Solana-Smart-Money-Bot/4.0-MultiProvider'
        }
      });

      if (!response.ok) return [];

      const streams = await response.json() as QuickNodeStreamResponse[];
      this.logger.info(`📋 Found ${streams.length} existing QuickNode streams`);
      return streams;

    } catch (error) {
      this.logger.error('❌ Error listing QuickNode streams:', error);
      return [];
    }
  }

  async getStreamStatus(streamId: string): Promise<{ isActive: boolean; status?: string; }> {
    try {
      if (streamId === 'polling-mode') {
        return { 
          isActive: this.isPollingActive, 
          status: this.isPollingActive ? 'multi-provider-polling' : 'stopped' 
        };
      }

      if (!this.canMakeRequest()) {
        return { isActive: false, status: 'api-limit-reached' };
      }

      this.trackApiRequest();
      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'GET',
        headers: {
          'x-api-key': this.providers[0]?.key || '',
          'Authorization': `Bearer ${this.providers[0]?.key || ''}`,
          'User-Agent': 'Solana-Smart-Money-Bot/4.0-MultiProvider'
        }
      });

      if (!response.ok) return { isActive: false };

      const streamData = await response.json() as QuickNodeStreamResponse;
      return {
        isActive: streamData.status === 'active',
        status: streamData.status
      };

    } catch (error) {
      this.logger.error(`Error getting stream status for ${streamId}:`, error);
      return { isActive: false };
    }
  }

  async cleanupOldStreams(): Promise<void> {
    try {
      this.logger.info('🧹 Cleaning up old QuickNode streams...');
      
      const streams = await this.listStreams();
      
      for (const stream of streams) {
        try {
          await this.deleteStream(stream.id);
          await this.sleep(2000);
        } catch (error) {
          this.logger.warn(`Failed to delete stream ${stream.id}:`, error);
        }
      }
      
      this.logger.info(`✅ Cleaned up ${streams.length} old streams`);

    } catch (error) {
      this.logger.error('❌ Error during stream cleanup:', error);
    }
  }

  // 🆕 УЛУЧШЕННАЯ СТАТИСТИКА С МУЛЬТИ-ПРОВАЙДЕРАМИ
  getPollingStats() {
    const providerStats = this.providers.map(p => ({
      name: p.name,
      isHealthy: p.isHealthy,
      requestCount: p.requestCount,
      errorCount: p.errorCount,
      successRate: p.requestCount > 0 ? ((p.requestCount - p.errorCount) / p.requestCount * 100).toFixed(1) + '%' : '0%',
      lastError: p.lastError,
      lastErrorTime: p.lastErrorTime ? new Date(p.lastErrorTime).toISOString() : null
    }));

    return {
      isActive: this.isPollingActive,
      currentProvider: this.getCurrentProvider().name,
      monitoredWallets: this.monitoredWallets.length,
      processedWallets: this.lastProcessedSignatures.size,
      tokenCacheSize: this.tokenInfoCache.size,
      priceCacheSize: this.priceCache.size,
      providers: providerStats,
      apiUsage: {
        currentMinute: this.apiLimits.currentMinuteRequests,
        maxMinute: this.apiLimits.requestsPerMinute,
        currentDay: this.apiLimits.currentDayRequests,
        maxDay: this.apiLimits.requestsPerDay,
        minuteUsage: (this.apiLimits.currentMinuteRequests / this.apiLimits.requestsPerMinute * 100).toFixed(1) + '%',
        dayUsage: (this.apiLimits.currentDayRequests / this.apiLimits.requestsPerDay * 100).toFixed(1) + '%'
      },
      optimization: {
        pollingInterval: '5 minutes',
        maxWallets: 20,
        tokenCacheTTL: '24 hours',
        priceCacheTTL: '5 minutes',
        minTradeAmount: '$8K+',
        raceConditionProtection: 'enabled',
        multiProviderFailover: 'enabled'
      }
    };
  }
}