// src/services/QuickNodeWebhookManager.ts - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ (сохранены все публичные методы)
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

// 🆕 УПРОЩЕННАЯ СТРУКТУРА ПРОВАЙДЕРА
interface Provider {
  name: string;
  type: 'quicknode' | 'alchemy';
  url: string;
  key?: string;
  isHealthy: boolean;
  requestCount: number;
  errorCount: number;
  lastError?: string;
  lastErrorTime?: number;
  priority: number;
  // 🆕 ОТДЕЛЬНЫЕ ЛИМИТЫ ДЛЯ КАЖДОГО ПРОВАЙДЕРА
  limits: {
    perMinute: number;
    perDay: number;
    currentMinute: number;
    currentDay: number;
    minuteReset: number;
    dayReset: number;
  };
}

export class QuickNodeWebhookManager {
  private logger: Logger;
  private providers: Provider[] = [];
  private currentProviderIndex: number = 0;
  
  private smDatabase: SmartMoneyDatabase | null = null;
  private telegramNotifier: TelegramNotifier | null = null;
  
  // 🔥 POLLING SERVICE
  private isPollingActive: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastProcessedSignatures = new Map<string, string>();
  private monitoredWallets: SmartMoneyWallet[] = [];
  
  // 🚀 КЕШИ (без изменений)
  private tokenInfoCache = new Map<string, { 
    symbol: string; 
    name: string; 
    timestamp: number; 
    price?: number;
  }>();
  private priceCache = new Map<string, { price: number; timestamp: number }>();
  
  // 🔒 УПРОЩЕННАЯ ЗАЩИТА ОТ RACE CONDITIONS
  private requestLocks = new Map<string, Promise<any>>();

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeProviders();
    this.startHealthCheck();
  }

  // 🆕 УПРОЩЕННАЯ ИНИЦИАЛИЗАЦИЯ ПРОВАЙДЕРОВ
  private initializeProviders(): void {
    // QuickNode (приоритет 5)
    if (process.env.QUICKNODE_HTTP_URL && process.env.QUICKNODE_API_KEY) {
      this.providers.push(this.createProvider({
        name: 'QuickNode',
        type: 'quicknode',
        url: process.env.QUICKNODE_HTTP_URL,
        key: process.env.QUICKNODE_API_KEY,
        priority: 5,
        limitsPerMinute: 25, // Консервативно для free tier
        limitsPerDay: 10000
      }));
      this.logger.info('✅ QuickNode provider initialized (Priority: 5)');
    }

    // Alchemy (приоритет 4)  
    if (process.env.ALCHEMY_HTTP_URL && process.env.ALCHEMY_API_KEY) {
      this.providers.push(this.createProvider({
        name: 'Alchemy',
        type: 'alchemy',
        url: process.env.ALCHEMY_HTTP_URL,
        key: process.env.ALCHEMY_API_KEY,
        priority: 4,
        limitsPerMinute: 60, // Alchemy больше дает
        limitsPerDay: 20000
      }));
      this.logger.info('✅ Alchemy provider initialized as backup (Priority: 4)');
    }

    if (this.providers.length === 0) {
      throw new Error('No RPC providers configured!');
    }

    this.logger.info(`🚀 Initialized ${this.providers.length} RPC providers with dual-credits strategy`);
  }

  // 🆕 ФАБРИКА ДЛЯ СОЗДАНИЯ ПРОВАЙДЕРОВ
  private createProvider(config: {
    name: string;
    type: 'quicknode' | 'alchemy';
    url: string;
    key: string;
    priority: number;
    limitsPerMinute: number;
    limitsPerDay: number;
  }): Provider {
    return {
      name: config.name,
      type: config.type,
      url: config.url,
      key: config.key,
      isHealthy: true,
      requestCount: 0,
      errorCount: 0,
      priority: config.priority,
      limits: {
        perMinute: config.limitsPerMinute,
        perDay: config.limitsPerDay,
        currentMinute: 0,
        currentDay: 0,
        minuteReset: Date.now() + 60000,
        dayReset: Date.now() + 86400000
      }
    };
  }

  // 🚀 ПУБЛИЧНЫЕ МЕТОДЫ (БЕЗ ИЗМЕНЕНИЙ - совместимость с main.ts)
  
  setDependencies(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier): void {
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
  }

  async createDEXMonitoringStream(webhookUrl: string): Promise<string> {
    try {
      this.logger.info('🔗 Creating QuickNode stream with dual-provider support...');

      const dexPrograms = [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
        '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
      ];

      const streamConfig: QuickNodeStreamConfig = {
        name: 'smart-money-dex-monitor-dual-v2',
        webhook_url: webhookUrl,
        filters: [{
          program_id: dexPrograms,
          account_type: 'transaction'
        }],
        region: 'us-east-1'
      };

      // Пробуем создать стрим через QuickNode
      const quickNodeProvider = this.providers.find(p => p.type === 'quicknode');
      if (quickNodeProvider && this.canMakeRequest(quickNodeProvider)) {
        const streamId = await this.createStreamWithProvider(quickNodeProvider, streamConfig);
        if (streamId) {
          this.logger.info(`✅ QuickNode stream created: ${streamId}`);
          return streamId;
        }
      }

      // Fallback на polling mode
      this.logger.info('❌ Stream creation failed, starting dual-provider polling mode');
      await this.startPollingMode();
      return 'polling-mode';

    } catch (error) {
      this.logger.error('❌ Error creating QuickNode stream:', error);
      await this.startPollingMode();
      return 'polling-mode';
    }
  }

  async startPollingMode(): Promise<void> {
    if (this.isPollingActive) return;
    if (!this.smDatabase || !this.telegramNotifier) {
      this.logger.error('❌ Dependencies not set for polling mode');
      return;
    }

    this.logger.info('🔄 Starting dual-provider polling mode...');
    
    try {
      // Получаем только включенные Smart Money кошельки (строгие фильтры)
      this.monitoredWallets = await this.smDatabase.getAllActiveSmartWallets();
      this.monitoredWallets = this.monitoredWallets
        .filter(w => {
          const daysSinceActive = (Date.now() - w.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceActive <= 30 && w.performanceScore >= 75 && w.winRate >= 65;
        })
        .slice(0, 20); // МАКСИМУМ 20 кошельков для экономии API

      this.logger.info(`🎯 Monitoring ${this.monitoredWallets.length}/20 TOP Smart Money wallets (Dual-Provider)`);
      this.isPollingActive = true;

      // 🔥 УВЕЛИЧЕННЫЙ ИНТЕРВАЛ: 5 МИНУТ для экономии API
      this.pollingInterval = setInterval(async () => {
        try {
          await this.pollSmartMoneyWalletsOptimized();
        } catch (error) {
          this.logger.error('❌ Error in polling cycle:', error);
        }
      }, 5 * 60 * 1000); // 5 МИНУТ

      // Первый запуск через 10 секунд
      setTimeout(() => this.pollSmartMoneyWalletsOptimized(), 10000);

      this.logger.info('✅ Dual-provider polling started: 5min intervals, max 20 wallets');

    } catch (error) {
      this.logger.error('❌ Failed to start polling mode:', error);
    }
  }

  stopPollingMode(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPollingActive = false;
    this.logger.info('🔴 Dual-provider polling mode stopped');
  }

  async deleteStream(streamId: string): Promise<void> {
    try {
      if (streamId === 'polling-mode') {
        this.stopPollingMode();
        return;
      }

      this.logger.info(`🗑️ Deleting QuickNode stream: ${streamId}`);

      const quickNodeProvider = this.providers.find(p => p.type === 'quicknode');
      if (quickNodeProvider && this.canMakeRequest(quickNodeProvider)) {
        await this.makeUniversalRequest(quickNodeProvider, 'DELETE', `/streams/${streamId}`);
        this.logger.info(`✅ QuickNode stream deleted: ${streamId}`);
      }

    } catch (error) {
      this.logger.error('❌ Error deleting QuickNode stream:', error);
    }
  }

  async getStreamStatus(streamId: string): Promise<{ isActive: boolean; status?: string; }> {
    try {
      if (streamId === 'polling-mode') {
        return { 
          isActive: this.isPollingActive, 
          status: this.isPollingActive ? 'dual-provider-polling' : 'stopped' 
        };
      }

      const quickNodeProvider = this.providers.find(p => p.type === 'quicknode');
      if (quickNodeProvider && this.canMakeRequest(quickNodeProvider)) {
        const data = await this.makeUniversalRequest(quickNodeProvider, 'GET', `/streams/${streamId}`);
        return {
          isActive: data.status === 'active',
          status: data.status
        };
      }

      return { isActive: false };

    } catch (error) {
      this.logger.error(`Error getting stream status for ${streamId}:`, error);
      return { isActive: false };
    }
  }

  getPollingStats() {
    const providerStats = this.providers.map(p => ({
      name: p.name,
      type: p.type,
      requestCount: p.requestCount,
      errorCount: p.errorCount,
      successRate: p.requestCount > 0 ? 
        ((p.requestCount - p.errorCount) / p.requestCount * 100) : 100,
      isHealthy: p.isHealthy,
      priority: p.priority,
      limits: {
        minuteUsage: `${p.limits.currentMinute}/${p.limits.perMinute}`,
        dayUsage: `${p.limits.currentDay}/${p.limits.perDay}`
      }
    }));

    return {
      isActive: this.isPollingActive,
      currentProvider: this.getCurrentProvider().name,
      monitoredWallets: this.monitoredWallets.length,
      processedWallets: this.lastProcessedSignatures.size,
      tokenCacheSize: this.tokenInfoCache.size,
      priceCacheSize: this.priceCache.size,
      providers: providerStats,
      optimization: {
        pollingInterval: '5 minutes',
        maxWallets: 20,
        tokenCacheTTL: '24 hours',
        priceCacheTTL: '5 minutes',
        dualProviderStrategy: 'enabled',
        raceConditionProtection: 'simplified'
      }
    };
  }

  // 🆕 УПРОЩЕННЫЕ ВНУТРЕННИЕ МЕТОДЫ

  // 🔥 ЕДИНЫЙ МЕТОД ДЛЯ ВСЕХ RPC ЗАПРОСОВ
  private async makeUniversalRequest(
    provider: Provider, 
    httpMethod: 'GET' | 'POST' | 'DELETE' = 'POST', 
    endpoint: string = '', 
    rpcMethod?: string, 
    rpcParams?: any[]
  ): Promise<any> {
    // 🔒 УПРОЩЕННАЯ ЗАЩИТА ОТ RACE CONDITIONS
    const lockKey = `${provider.name}-${Date.now()}`;
    
    if (this.requestLocks.has(provider.name)) {
      await this.requestLocks.get(provider.name);
    }

    const requestPromise = this.executeProviderRequest(provider, httpMethod, endpoint, rpcMethod, rpcParams);
    this.requestLocks.set(provider.name, requestPromise);
    
    try {
      const result = await requestPromise;
      this.requestLocks.delete(provider.name);
      return result;
    } catch (error) {
      this.requestLocks.delete(provider.name);
      throw error;
    }
  }

  // 🔥 ВЫПОЛНЕНИЕ ЗАПРОСА К ПРОВАЙДЕРУ
  private async executeProviderRequest(
    provider: Provider,
    httpMethod: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    rpcMethod?: string,
    rpcParams?: any[]
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      let url = provider.url;
      let body: string | undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Smart-Money-Dual-Provider/4.0'
      };

      // Построение URL и headers в зависимости от типа
      if (httpMethod === 'POST' && rpcMethod) {
        // RPC запрос
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: rpcMethod,
          params: rpcParams || []
        });
        
        // Авторизация для разных провайдеров
        if (provider.type === 'alchemy') {
          url = provider.url.includes(provider.key!) ? provider.url : `${provider.url}/${provider.key}`;
        } else if (provider.type === 'quicknode') {
          // QuickNode использует API key в URL или Authorization header
          if (!provider.url.includes(provider.key!)) {
            headers['Authorization'] = `Bearer ${provider.key}`;
          }
        }
      } else {
        // REST API запрос (для streams)
        url = `${this.getApiBaseUrl(provider)}${endpoint}`;
        headers['x-api-key'] = provider.key!;
        headers['Authorization'] = `Bearer ${provider.key}`;
      }

      const response = await fetch(url, {
        method: httpMethod,
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as any;
        
        // Обновляем статистику успеха
        provider.requestCount++;
        this.trackRequestLimit(provider);
        
        this.logger.debug(`✅ ${provider.name} success: ${rpcMethod || httpMethod}`);
        return data.result || data;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error) {
      clearTimeout(timeoutId);
      provider.errorCount++;
      provider.lastError = error instanceof Error ? error.message : 'Unknown error';
      provider.lastErrorTime = Date.now();
      
      this.logger.warn(`⚠️ ${provider.name} failed: ${provider.lastError}`);
      throw error;
    }
  }

  // 🔥 УПРОЩЕННОЕ POLLING БЕЗ ДУБЛИРОВАНИЯ
  private async pollSmartMoneyWalletsOptimized(): Promise<void> {
    if (!this.isPollingActive || this.monitoredWallets.length === 0) return;

    try {
      this.logger.info(`🔍 Polling ${this.monitoredWallets.length} wallets with dual-provider strategy...`);
      
      const batchSize = 3; // Небольшие батчи для экономии API
      const batches = [];
      
      for (let i = 0; i < this.monitoredWallets.length; i += batchSize) {
        batches.push(this.monitoredWallets.slice(i, i + batchSize));
      }

      // Обрабатываем каждый батч
      for (const batch of batches) {
        const provider = this.selectBestProvider();
        if (!this.canMakeRequest(provider)) {
          this.logger.warn('⚠️ API limit reached, stopping polling for this cycle');
          break;
        }

        await this.processBatch(batch, provider);
        await this.sleep(3000); // 3 секунды между батчами
      }

      this.logApiUsage();

    } catch (error) {
      this.logger.error('❌ Error in optimized polling:', error);
    }
  }

  // 🔥 ОБРАБОТКА БАТЧА КОШЕЛЬКОВ
  private async processBatch(wallets: SmartMoneyWallet[], provider: Provider): Promise<void> {
    const promises = wallets.map(wallet => this.checkWalletForNewTransactions(wallet, provider));
    await Promise.allSettled(promises);
  }

  // 🔥 ПРОВЕРКА КОШЕЛЬКА НА НОВЫЕ ТРАНЗАКЦИИ (УНИВЕРСАЛЬНАЯ)
  private async checkWalletForNewTransactions(wallet: SmartMoneyWallet, provider?: Provider): Promise<void> {
    try {
      const selectedProvider = provider || this.selectBestProvider();
      if (!this.canMakeRequest(selectedProvider)) return;

      const walletAddress = wallet.address;
      const lastSignature = this.lastProcessedSignatures.get(walletAddress);

      // Получаем подписи транзакций
      const signatures = await this.makeUniversalRequest(
        selectedProvider,
        'POST',
        '',
        'getSignaturesForAddress',
        [walletAddress, { limit: 5, commitment: 'confirmed', before: lastSignature }]
      );
      
      if (!signatures || signatures.length === 0) return;

      // Обновляем последнюю обработанную транзакцию
      this.lastProcessedSignatures.set(walletAddress, signatures[0].signature);

      // Обрабатываем только первые 3 транзакции
      for (const sigInfo of signatures.slice(0, 3).reverse()) {
        try {
          if (!this.canMakeRequest(selectedProvider)) break;
          
          await this.processWalletTransaction(sigInfo.signature, wallet, selectedProvider);
          await this.sleep(200); // Пауза между транзакциями
        } catch (error) {
          this.logger.error(`❌ Error processing transaction ${sigInfo.signature}:`, error);
        }
      }

    } catch (error) {
      this.logger.error(`❌ Error checking wallet ${wallet.address}:`, error);
    }
  }

  // 🔥 ОБРАБОТКА ТРАНЗАКЦИИ КОШЕЛЬКА (УНИВЕРСАЛЬНАЯ)
  private async processWalletTransaction(signature: string, wallet: SmartMoneyWallet, provider: Provider): Promise<void> {
    try {
      // Получаем детали транзакции
      const transaction = await this.makeUniversalRequest(
        provider,
        'POST',
        '',
        'getTransaction',
        [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]
      );
      
      if (!transaction) return;

      const swaps = await this.extractSwapsFromTransaction(transaction, wallet);
      
      for (const swap of swaps) {
        if (this.shouldProcessSmartMoneySwap(swap, wallet)) {
          await this.saveAndNotifySwap(swap);
          this.logger.info(`🔥 SM swap: ${swap.tokenSymbol} - $${swap.amountUSD.toFixed(0)} (via ${provider.name})`);
        }
      }

    } catch (error) {
      this.logger.error(`Error processing transaction ${signature} with ${provider.name}:`, error);
    }
  }

  // 🔥 УПРОЩЕННЫЙ ВЫБОР ПРОВАЙДЕРА
  private selectBestProvider(): Provider {
    // Фильтруем здоровые провайдеры с доступными лимитами
    const availableProviders = this.providers.filter(p => 
      p.isHealthy && this.canMakeRequest(p)
    );

    if (availableProviders.length === 0) {
      // Если все заняты, возвращаем любой здоровый
      const healthyProviders = this.providers.filter(p => p.isHealthy);
      return healthyProviders[0] || this.providers[0];
    }

    // Сортируем по приоритету и количеству ошибок
    availableProviders.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Высший приоритет первым
      }
      return a.errorCount - b.errorCount; // Меньше ошибок первым
    });

    return availableProviders[0];
  }

  private getCurrentProvider(): Provider {
    return this.selectBestProvider();
  }

  // 🔒 УПРОЩЕННАЯ ПРОВЕРКА ЛИМИТОВ (БЕЗ RACE CONDITIONS)
  private canMakeRequest(provider: Provider): boolean {
    const now = Date.now();
    
    // Сброс счетчиков
    if (now > provider.limits.minuteReset) {
      provider.limits.currentMinute = 0;
      provider.limits.minuteReset = now + 60000;
    }
    
    if (now > provider.limits.dayReset) {
      provider.limits.currentDay = 0;
      provider.limits.dayReset = now + 86400000;
    }
    
    return provider.limits.currentMinute < provider.limits.perMinute &&
           provider.limits.currentDay < provider.limits.perDay;
  }
  
  private trackRequestLimit(provider: Provider): void {
    provider.limits.currentMinute++;
    provider.limits.currentDay++;
  }

  // 🔥 ОСТАЛЬНЫЕ МЕТОДЫ (БЕЗ ИЗМЕНЕНИЙ)
  
  private async createStreamWithProvider(provider: Provider, config: QuickNodeStreamConfig): Promise<string | null> {
    try {
      const data = await this.makeUniversalRequest(provider, 'POST', '/streams', undefined, undefined);
      return data.id || null;
    } catch (error) {
      this.logger.error(`Error creating stream with ${provider.name}:`, error);
      return null;
    }
  }

  private getApiBaseUrl(provider: Provider): string {
    const baseUrl = provider.url.replace(/\/$/, '');
    return baseUrl.replace(/\/rpc$/, '') + '/api/v1';
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

  private shouldProcessSmartMoneySwap(swap: SmartMoneySwap, wallet: SmartMoneyWallet): boolean {
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

  private async getTokenInfoCached(tokenMint: string): Promise<{ symbol: string; name: string }> {
    const cached = this.tokenInfoCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      return { symbol: cached.symbol, name: cached.name };
    }

    try {
      const provider = this.selectBestProvider();
      if (!this.canMakeRequest(provider)) {
        return { symbol: 'UNKNOWN', name: 'Unknown Token' };
      }

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

  private async estimateTokenValueUSDCached(tokenMint: string, amount: number): Promise<number> {
    const cached = this.priceCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.price * amount;
    }

    const provider = this.selectBestProvider();
    if (!this.canMakeRequest(provider)) {
      return amount * 0.01;
    }

    try {
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
        swap.tokenAmount, swap.amountUSD, swap.swapType, swap.timestamp.toISOString(), 'Dual-Provider',
        swap.category, 0, null, swap.pnl, swap.winRate, swap.totalTrades
      );

      await this.telegramNotifier.sendSmartMoneySwap(swap);

    } catch (error) {
      this.logger.error('Error saving and notifying swap:', error);
    }
  }

  private startHealthCheck(): void {
    setInterval(async () => {
      for (const provider of this.providers) {
        try {
          await this.makeUniversalRequest(provider, 'POST', '', 'getSlot', []);
          provider.isHealthy = true;
        } catch (error) {
          if (provider.isHealthy) {
            this.logger.warn(`💔 ${provider.name} marked unhealthy`);
          }
          provider.isHealthy = false;
        }
      }
    }, 2 * 60 * 1000); // Каждые 2 минуты
  }

  private logApiUsage(): void {
    const totalMinuteRequests = this.providers.reduce((sum, p) => sum + p.limits.currentMinute, 0);
    const totalDayRequests = this.providers.reduce((sum, p) => sum + p.limits.currentDay, 0);
    const totalMinuteLimit = this.providers.reduce((sum, p) => sum + p.limits.perMinute, 0);
    const totalDayLimit = this.providers.reduce((sum, p) => sum + p.limits.perDay, 0);
    
    const minuteUsage = (totalMinuteRequests / totalMinuteLimit * 100).toFixed(1);
    const dayUsage = (totalDayRequests / totalDayLimit * 100).toFixed(1);
    
    const healthyProviders = this.providers.filter(p => p.isHealthy).length;
    
    this.logger.info(`📊 Dual API Usage: ${minuteUsage}% minute, ${dayUsage}% daily | Healthy: ${healthyProviders}/${this.providers.length}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}