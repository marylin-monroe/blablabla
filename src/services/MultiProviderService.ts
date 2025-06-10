// src/services/MultiProviderService.ts - МУЛЬТИПРОВАЙДЕР СИСТЕМА
import { Logger } from '../utils/Logger';

// 🌐 ТИПЫ ПРОВАЙДЕРОВ
type ProviderType = 'quicknode' | 'helius' | 'alchemy' | 'getblock' | 'moralis' | 'ankr';

interface APIProvider {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  
  // Лимиты
  requestsPerMinute: number;
  requestsPerDay: number;
  requestsPerMonth: number;
  
  // Текущее использование
  currentMinuteRequests: number;
  currentDayRequests: number;
  currentMonthRequests: number;
  
  // Время сброса счетчиков
  minuteReset: number;
  dayReset: number;
  monthReset: number;
  
  // Статистика
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  
  // Состояние
  isHealthy: boolean;
  lastError?: string;
  lastErrorTime?: number;
  
  // Специализация
  specialties: string[]; // ['rpc', 'metadata', 'holders', 'prices']
}

interface RequestOptions {
  method: string;
  params?: any[];
  body?: any;
  timeout?: number;
  retries?: number;
  preferredProvider?: ProviderType;
  requiredSpecialty?: string;
}

interface ProviderResponse {
  success: boolean;
  data?: any;
  error?: string;
  provider: string;
  responseTime: number;
}

export class MultiProviderService {
  private providers: Map<ProviderType, APIProvider> = new Map();
  private logger: Logger;
  private currentProviderIndex = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeProviders();
    this.startHealthCheck();
    this.startUsageReset();
  }

  // 🏗️ ИНИЦИАЛИЗАЦИЯ ПРОВАЙДЕРОВ
  private initializeProviders(): void {
    const providerConfigs: Partial<APIProvider>[] = [
      {
        name: 'QuickNode',
        type: 'quicknode',
        baseUrl: process.env.QUICKNODE_HTTP_URL || '',
        apiKey: process.env.QUICKNODE_API_KEY || '',
        requestsPerMinute: 30,      // Консервативно
        requestsPerDay: 12000,      // Free план
        requestsPerMonth: 10000000, // 10M кредитов
        specialties: ['rpc', 'transactions', 'accounts']
      },
      {
        name: 'Helius',
        type: 'helius',
        baseUrl: 'https://api.helius.xyz/v0',
        apiKey: process.env.HELIUS_API_KEY || '',
        requestsPerMinute: 60,
        requestsPerDay: 100000,     // Free план
        requestsPerMonth: 3000000,
        specialties: ['metadata', 'tokens', 'nft', 'webhooks']
      },
      {
        name: 'Alchemy',
        type: 'alchemy',
        baseUrl: process.env.ALCHEMY_HTTP_URL || 'https://solana-mainnet.g.alchemy.com/v2',
        apiKey: process.env.ALCHEMY_API_KEY || '',
        requestsPerMinute: 100,
        requestsPerDay: 300000,     // 300M compute units
        requestsPerMonth: 9000000,
        specialties: ['rpc', 'enhanced', 'analytics']
      },
      {
        name: 'GetBlock',
        type: 'getblock',
        baseUrl: 'https://go.getblock.io',
        apiKey: process.env.GETBLOCK_API_KEY || '',
        requestsPerMinute: 30,
        requestsPerDay: 40000,      // Free план
        requestsPerMonth: 1200000,
        specialties: ['rpc', 'archive']
      },
      {
        name: 'Moralis',
        type: 'moralis',
        baseUrl: 'https://solana-gateway.moralis.io',
        apiKey: process.env.MORALIS_API_KEY || '',
        requestsPerMinute: 25,
        requestsPerDay: 100000,     // Free план
        requestsPerMonth: 3000000,
        specialties: ['tokens', 'balances', 'prices']
      },
      {
        name: 'Ankr',
        type: 'ankr',
        baseUrl: 'https://rpc.ankr.com/solana',
        apiKey: process.env.ANKR_API_KEY || '',
        requestsPerMinute: 50,
        requestsPerDay: 500000,     // Free план (надо проверить)
        requestsPerMonth: 15000000,
        specialties: ['rpc', 'historical']
      }
    ];

    for (const config of providerConfigs) {
      if (config.apiKey) { // Только если есть API ключ
        const provider: APIProvider = {
          name: config.name!,
          type: config.type!,
          baseUrl: config.baseUrl!,
          apiKey: config.apiKey,
          requestsPerMinute: config.requestsPerMinute!,
          requestsPerDay: config.requestsPerDay!,
          requestsPerMonth: config.requestsPerMonth!,
          currentMinuteRequests: 0,
          currentDayRequests: 0,
          currentMonthRequests: 0,
          minuteReset: Date.now() + 60000,
          dayReset: Date.now() + 86400000,
          monthReset: Date.now() + 30 * 86400000,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          avgResponseTime: 0,
          isHealthy: true,
          specialties: config.specialties!
        };

        this.providers.set(config.type!, provider);
        this.logger.info(`✅ Provider initialized: ${config.name} (${config.type})`);
      } else {
        this.logger.warn(`⚠️ Skipping ${config.name}: no API key provided`);
      }
    }

    this.logger.info(`🌐 MultiProvider initialized with ${this.providers.size} providers`);
  }

  // 🚀 ГЛАВНЫЙ МЕТОД - УМНЫЙ ЗАПРОС К ЛУЧШЕМУ ПРОВАЙДЕРУ
  async makeRequest(options: RequestOptions): Promise<ProviderResponse> {
    const startTime = Date.now();
    let lastError: string = '';

    // 1. Выбираем лучшего провайдера
    let provider = this.selectBestProvider(options);
    
    if (!provider) {
      return {
        success: false,
        error: 'No available providers',
        provider: 'none',
        responseTime: Date.now() - startTime
      };
    }

    // 2. Пытаемся сделать запрос
    const result = await this.executeRequest(provider, options);
    
    if (result.success) {
      return result;
    }

    // 3. Если не получилось - пробуем других провайдеров
    lastError = result.error || 'Unknown error';
    const triedProviders = new Set([provider.type]);

    // Попробуем до 3 других провайдеров
    for (let attempts = 0; attempts < 3; attempts++) {
      provider = this.selectAlternativeProvider(options, triedProviders);
      
      if (!provider) break;
      
      triedProviders.add(provider.type);
      const fallbackResult = await this.executeRequest(provider, options);
      
      if (fallbackResult.success) {
        this.logger.info(`✅ Fallback successful: ${provider.name}`);
        return fallbackResult;
      }
      
      lastError = fallbackResult.error || lastError;
    }

    // 4. Все провайдеры не сработали
    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`,
      provider: 'multiple-failed',
      responseTime: Date.now() - startTime
    };
  }

  // 🎯 ВЫБОР ЛУЧШЕГО ПРОВАЙДЕРА
  private selectBestProvider(options: RequestOptions): APIProvider | null {
    const availableProviders = Array.from(this.providers.values()).filter(p => 
      p.isHealthy && 
      this.canMakeRequest(p) &&
      this.supportsRequest(p, options)
    );

    if (availableProviders.length === 0) {
      return null;
    }

    // Предпочитаемый провайдер
    if (options.preferredProvider) {
      const preferred = availableProviders.find(p => p.type === options.preferredProvider);
      if (preferred) return preferred;
    }

    // Провайдер со специализацией
    if (options.requiredSpecialty) {
      const specialized = availableProviders.filter(p => 
        p.specialties.includes(options.requiredSpecialty!)
      );
      if (specialized.length > 0) {
        return this.selectByPerformance(specialized);
      }
    }

    // Лучший по производительности
    return this.selectByPerformance(availableProviders);
  }

  // 📊 ВЫБОР ПО ПРОИЗВОДИТЕЛЬНОСТИ
  private selectByPerformance(providers: APIProvider[]): APIProvider {
    // Считаем score для каждого провайдера
    const scored = providers.map(p => ({
      provider: p,
      score: this.calculateProviderScore(p)
    }));

    // Сортируем по score (больше = лучше)
    scored.sort((a, b) => b.score - a.score);
    
    return scored[0].provider;
  }

  private calculateProviderScore(provider: APIProvider): number {
    let score = 100;

    // Штраф за использование лимитов
    const minuteUsage = provider.currentMinuteRequests / provider.requestsPerMinute;
    const dayUsage = provider.currentDayRequests / provider.requestsPerDay;
    
    score -= minuteUsage * 30; // До -30 за минутный лимит
    score -= dayUsage * 40;    // До -40 за дневной лимит

    // Бонус за успешность
    if (provider.totalRequests > 0) {
      const successRate = provider.successfulRequests / provider.totalRequests;
      score += successRate * 20; // До +20 за успешность
    }

    // Штраф за медленность
    if (provider.avgResponseTime > 0) {
      const speedPenalty = Math.min(provider.avgResponseTime / 1000 * 5, 20);
      score -= speedPenalty; // До -20 за медленность
    }

    // Штраф за недавние ошибки
    if (provider.lastErrorTime && Date.now() - provider.lastErrorTime < 60000) {
      score -= 25; // -25 за ошибки в последнюю минуту
    }

    return Math.max(score, 0);
  }

  // 🔄 ВЫБОР АЛЬТЕРНАТИВНОГО ПРОВАЙДЕРА
  private selectAlternativeProvider(options: RequestOptions, excludeTypes: Set<ProviderType>): APIProvider | null {
    const availableProviders = Array.from(this.providers.values()).filter(p => 
      !excludeTypes.has(p.type) &&
      p.isHealthy && 
      this.canMakeRequest(p) &&
      this.supportsRequest(p, options)
    );

    if (availableProviders.length === 0) {
      return null;
    }

    return this.selectByPerformance(availableProviders);
  }

  // ✅ ПРОВЕРКИ ВОЗМОЖНОСТИ ЗАПРОСА
  private canMakeRequest(provider: APIProvider): boolean {
    const now = Date.now();

    // Сброс счетчиков если время истекло
    if (now > provider.minuteReset) {
      provider.currentMinuteRequests = 0;
      provider.minuteReset = now + 60000;
    }

    if (now > provider.dayReset) {
      provider.currentDayRequests = 0;
      provider.dayReset = now + 86400000;
    }

    if (now > provider.monthReset) {
      provider.currentMonthRequests = 0;
      provider.monthReset = now + 30 * 86400000;
    }

    // Проверяем лимиты
    return provider.currentMinuteRequests < provider.requestsPerMinute &&
           provider.currentDayRequests < provider.requestsPerDay &&
           provider.currentMonthRequests < provider.requestsPerMonth;
  }

  private supportsRequest(provider: APIProvider, options: RequestOptions): boolean {
    if (!options.requiredSpecialty) return true;
    return provider.specialties.includes(options.requiredSpecialty);
  }

  // 🌐 ВЫПОЛНЕНИЕ ЗАПРОСА
  private async executeRequest(provider: APIProvider, options: RequestOptions): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      // Увеличиваем счетчики
      this.incrementProviderUsage(provider);

      // Формируем URL и параметры в зависимости от провайдера
      const requestConfig = this.buildRequestConfig(provider, options);
      
      // Делаем запрос
      const response = await fetch(requestConfig.url, {
        method: requestConfig.method,
        headers: requestConfig.headers,
        body: requestConfig.body,
        signal: AbortSignal.timeout(options.timeout || 10000)
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const normalizedData = this.normalizeResponse(provider.type, data, options);

      // Обновляем статистику
      this.updateProviderStats(provider, true, responseTime);

      return {
        success: true,
        data: normalizedData,
        provider: provider.name,
        responseTime
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Обновляем статистику
      this.updateProviderStats(provider, false, responseTime);
      provider.lastError = errorMessage;
      provider.lastErrorTime = Date.now();

      // Временно помечаем как нездоровый при критических ошибках
      if (errorMessage.includes('timeout') || errorMessage.includes('500')) {
        provider.isHealthy = false;
        setTimeout(() => {
          provider.isHealthy = true;
        }, 60000); // Восстанавливаем через минуту
      }

      this.logger.error(`❌ Provider ${provider.name} failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        provider: provider.name,
        responseTime
      };
    }
  }

  // 🔧 ПОСТРОЕНИЕ КОНФИГУРАЦИИ ЗАПРОСА
  private buildRequestConfig(provider: APIProvider, options: RequestOptions): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Solana-Smart-Money-Bot/3.1.0'
    };

    let url = provider.baseUrl;
    let body: string | undefined;

    switch (provider.type) {
      case 'quicknode':
      case 'alchemy':
      case 'getblock':
      case 'ankr':
        // RPC стиль
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: options.method,
          params: options.params || []
        });
        break;

      case 'helius':
        // Helius API стиль
        if (options.method === 'getTokenMetadata') {
          url += `/tokens/metadata?api-key=${provider.apiKey}`;
          body = JSON.stringify(options.body || {});
        } else {
          url += `/rpc?api-key=${provider.apiKey}`;
          body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: options.method,
            params: options.params || []
          });
        }
        break;

      case 'moralis':
        // Moralis API стиль
        headers['X-API-Key'] = provider.apiKey;
        if (options.method.startsWith('get')) {
          const endpoint = this.mapMoralisEndpoint(options.method);
          url += endpoint;
        }
        break;

      default:
        // Дефолтный RPC
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: options.method,
          params: options.params || []
        });
    }

    return {
      url,
      method: 'POST',
      headers,
      body
    };
  }

  private mapMoralisEndpoint(method: string): string {
    const endpointMap: Record<string, string> = {
      'getTokenMetadata': '/tokens/metadata',
      'getTokenPrice': '/tokens/price',
      'getAccountInfo': '/accounts',
      'getBalance': '/accounts/balance'
    };

    return endpointMap[method] || '/rpc';
  }

  // 🔄 НОРМАЛИЗАЦИЯ ОТВЕТОВ
  private normalizeResponse(providerType: ProviderType, data: any, options: RequestOptions): any {
    // Для RPC методов возвращаем результат
    if (data.result !== undefined) {
      return data.result;
    }

    // Для Helius API
    if (providerType === 'helius' && options.method === 'getTokenMetadata') {
      return data;
    }

    // Для Moralis API
    if (providerType === 'moralis') {
      return data;
    }

    // Возвращаем как есть
    return data;
  }

  // 📊 ОБНОВЛЕНИЕ СТАТИСТИКИ
  private incrementProviderUsage(provider: APIProvider): void {
    provider.currentMinuteRequests++;
    provider.currentDayRequests++;
    provider.currentMonthRequests++;
    provider.totalRequests++;
  }

  private updateProviderStats(provider: APIProvider, success: boolean, responseTime: number): void {
    if (success) {
      provider.successfulRequests++;
    } else {
      provider.failedRequests++;
    }

    // Обновляем среднее время ответа
    if (provider.totalRequests > 0) {
      provider.avgResponseTime = (provider.avgResponseTime * (provider.totalRequests - 1) + responseTime) / provider.totalRequests;
    }
  }

  // 🏥 ПРОВЕРКА ЗДОРОВЬЯ ПРОВАЙДЕРОВ
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 5 * 60 * 1000); // Каждые 5 минут

    this.logger.info('🏥 Health check started: every 5 minutes');
  }

  private async performHealthCheck(): Promise<void> {
    this.logger.info('🏥 Performing provider health check...');

    const healthPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        const result = await this.executeRequest(provider, {
          method: 'getHealth',
          params: [],
          timeout: 5000
        });

        provider.isHealthy = result.success;
        
        if (!result.success) {
          this.logger.warn(`⚠️ Provider ${provider.name} health check failed: ${result.error}`);
        }
      } catch (error) {
        provider.isHealthy = false;
        this.logger.warn(`⚠️ Provider ${provider.name} health check error:`, error);
      }
    });

    await Promise.allSettled(healthPromises);

    const healthyCount = Array.from(this.providers.values()).filter(p => p.isHealthy).length;
    this.logger.info(`🏥 Health check complete: ${healthyCount}/${this.providers.size} providers healthy`);
  }

  // 🔄 СБРОС СЧЕТЧИКОВ ИСПОЛЬЗОВАНИЯ
  private startUsageReset(): void {
    // Сброс минутных счетчиков каждую минуту
    setInterval(() => {
      const now = Date.now();
      for (const provider of this.providers.values()) {
        if (now > provider.minuteReset) {
          provider.currentMinuteRequests = 0;
          provider.minuteReset = now + 60000;
        }
      }
    }, 60000);

    this.logger.info('🔄 Usage reset timers started');
  }

  // 📊 ПОЛУЧЕНИЕ СТАТИСТИКИ
  getStats() {
    const stats = {
      totalProviders: this.providers.size,
      healthyProviders: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      providers: [] as any[]
    };

    for (const provider of this.providers.values()) {
      if (provider.isHealthy) stats.healthyProviders++;
      stats.totalRequests += provider.totalRequests;
      stats.successfulRequests += provider.successfulRequests;
      stats.failedRequests += provider.failedRequests;

      stats.providers.push({
        name: provider.name,
        type: provider.type,
        isHealthy: provider.isHealthy,
        usage: {
          minute: `${provider.currentMinuteRequests}/${provider.requestsPerMinute}`,
          day: `${provider.currentDayRequests}/${provider.requestsPerDay}`,
          month: `${provider.currentMonthRequests}/${provider.requestsPerMonth}`
        },
        performance: {
          totalRequests: provider.totalRequests,
          successRate: provider.totalRequests > 0 ? 
            (provider.successfulRequests / provider.totalRequests * 100).toFixed(1) + '%' : '0%',
          avgResponseTime: provider.avgResponseTime.toFixed(0) + 'ms'
        },
        specialties: provider.specialties,
        lastError: provider.lastError
      });
    }

    return stats;
  }

  // 🧹 ОЧИСТКА РЕСУРСОВ
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.logger.info('🔴 MultiProviderService shutdown completed');
  }

  // 🎯 ПУБЛИЧНЫЕ МЕТОДЫ ДЛЯ УДОБСТВА
  async getSignaturesForAddress(address: string, options?: { limit?: number; before?: string }): Promise<any> {
    return this.makeRequest({
      method: 'getSignaturesForAddress',
      params: [address, options || {}],
      requiredSpecialty: 'rpc'
    });
  }

  async getTransaction(signature: string): Promise<any> {
    return this.makeRequest({
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      requiredSpecialty: 'rpc'
    });
  }

  async getTokenMetadata(mintAddresses: string[]): Promise<any> {
    return this.makeRequest({
      method: 'getTokenMetadata',
      body: { mintAccounts: mintAddresses },
      requiredSpecialty: 'metadata',
      preferredProvider: 'helius'
    });
  }

  async getTokenHolders(tokenAddress: string): Promise<any> {
    return this.makeRequest({
      method: 'getTokenHolders',
      params: [tokenAddress],
      requiredSpecialty: 'tokens'
    });
  }

  async getAccountInfo(address: string): Promise<any> {
    return this.makeRequest({
      method: 'getAccountInfo',
      params: [address, { encoding: 'jsonParsed' }],
      requiredSpecialty: 'rpc'
    });
  }
}
/*# Уже есть
QUICKNODE_HTTP_URL=...
QUICKNODE_API_KEY=...
HELIUS_API_KEY=...

# Добавить новые (по желанию)
ALCHEMY_HTTP_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
ALCHEMY_API_KEY=your_alchemy_key

GETBLOCK_API_KEY=your_getblock_key
MORALIS_API_KEY=your_moralis_key  
ANKR_API_KEY=your_ankr_key*/