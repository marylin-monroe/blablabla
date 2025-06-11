// src/services/MultiProviderService.ts - МОЩНАЯ МУЛЬТИПРОВАЙДЕР СИСТЕМА
import { Logger } from '../utils/Logger';

// 🌐 ТИПЫ ПРОВАЙДЕРОВ (без слабого Helius)
type ProviderType = 'quicknode' | 'alchemy' | 'getblock' | 'moralis' | 'ankr';

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
  specialties: string[];
  priority: number; // Приоритет провайдера (1-5, где 5 = самый надежный)
}

interface RequestOptions {
  method: string;
  params?: any[];
  body?: any;
  timeout?: number;
  retries?: number;
  preferredProvider?: ProviderType;
  requiredSpecialty?: string;
  maxAttempts?: number;
}

interface ProviderResponse {
  success: boolean;
  data?: any;
  error?: string;
  provider: string;
  responseTime: number;
  fromCache?: boolean;
}

export class MultiProviderService {
  private providers: Map<ProviderType, APIProvider> = new Map();
  private logger: Logger;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private responseCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10000; // 10 секунд кеш

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeProviders();
    this.startHealthCheck();
    this.startUsageReset();
    this.startCacheCleanup();
  }

  // 🏗️ ИНИЦИАЛИЗАЦИЯ МОЩНЫХ ПРОВАЙДЕРОВ
  private initializeProviders(): void {
    const providerConfigs: Partial<APIProvider>[] = [
      {
        name: 'QuickNode Pro',
        type: 'quicknode',
        baseUrl: process.env.QUICKNODE_HTTP_URL || '',
        apiKey: process.env.QUICKNODE_API_KEY || '',
        requestsPerMinute: 50,       // Увеличено для стабильности
        requestsPerDay: 15000,       // Консервативно
        requestsPerMonth: 12000000,  // 12M кредитов
        specialties: ['rpc', 'transactions', 'accounts', 'fast'],
        priority: 5 // Топ приоритет
      },
      {
        name: 'Alchemy Enhanced',
        type: 'alchemy',
        baseUrl: process.env.ALCHEMY_HTTP_URL || 'https://solana-mainnet.g.alchemy.com/v2',
        apiKey: process.env.ALCHEMY_API_KEY || '',
        requestsPerMinute: 120,      // Alchemy очень щедрый
        requestsPerDay: 400000,      // 400M compute units
        requestsPerMonth: 12000000,
        specialties: ['rpc', 'enhanced', 'analytics', 'reliable'],
        priority: 5 // Топ приоритет
      },
      {
        name: 'GetBlock Archive',
        type: 'getblock',
        baseUrl: 'https://go.getblock.io',
        apiKey: process.env.GETBLOCK_API_KEY || '',
        requestsPerMinute: 40,
        requestsPerDay: 50000,       // Увеличено
        requestsPerMonth: 1500000,
        specialties: ['rpc', 'archive', 'historical'],
        priority: 4 // Хороший архивный провайдер
      },
      {
        name: 'Moralis Data',
        type: 'moralis',
        baseUrl: 'https://solana-gateway.moralis.io',
        apiKey: process.env.MORALIS_API_KEY || '',
        requestsPerMinute: 35,
        requestsPerDay: 120000,      // Увеличено
        requestsPerMonth: 3500000,
        specialties: ['tokens', 'balances', 'prices', 'metadata'],
        priority: 4 // Хорош для данных о токенах
      },
      {
        name: 'Ankr Fast',
        type: 'ankr',
        baseUrl: 'https://rpc.ankr.com/solana',
        apiKey: process.env.ANKR_API_KEY || '',
        requestsPerMinute: 60,
        requestsPerDay: 600000,      // Очень щедрый
        requestsPerMonth: 18000000,
        specialties: ['rpc', 'historical', 'fast'],
        priority: 4 // Быстрый и надежный
      }
    ];

    for (const config of providerConfigs) {
      if (config.apiKey && config.baseUrl) {
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
          specialties: config.specialties!,
          priority: config.priority!
        };

        this.providers.set(config.type!, provider);
        this.logger.info(`🚀 Strong provider initialized: ${config.name} (${config.type}) - Priority: ${config.priority}`);
      } else {
        this.logger.warn(`⚠️ Skipping ${config.name}: missing API key or URL`);
      }
    }

    this.logger.info(`💪 MultiProvider initialized with ${this.providers.size} STRONG providers`);
  }

  // 🚀 ГЛАВНЫЙ МЕТОД - УМНЫЙ ЗАПРОС К ЛУЧШЕМУ ПРОВАЙДЕРУ
  async makeRequest(options: RequestOptions): Promise<ProviderResponse> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(options);

    // Проверяем кеш для GET-подобных операций
    if (this.isCacheable(options.method)) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          provider: 'cache',
          responseTime: 1,
          fromCache: true
        };
      }
    }

    const maxAttempts = options.maxAttempts || 4;
    let lastError: string = '';
    const triedProviders = new Set<ProviderType>();

    // Пытаемся до maxAttempts раз
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const provider = this.selectBestProvider(options, triedProviders);
      
      if (!provider) {
        break;
      }

      triedProviders.add(provider.type);
      const result = await this.executeRequest(provider, options);
      
      if (result.success) {
        // Кешируем успешный результат
        if (this.isCacheable(options.method)) {
          this.setToCache(cacheKey, result.data);
        }
        
        this.logger.info(`✅ Success with ${provider.name} (attempt ${attempt + 1})`);
        return result;
      }

      lastError = result.error || 'Unknown error';
      this.logger.warn(`❌ ${provider.name} failed (attempt ${attempt + 1}): ${lastError}`);
    }

    // Все провайдеры не сработали
    return {
      success: false,
      error: `All ${triedProviders.size} providers failed. Last error: ${lastError}`,
      provider: 'all-failed',
      responseTime: Date.now() - startTime
    };
  }

  // 🎯 УМНЫЙ ВЫБОР ЛУЧШЕГО ПРОВАЙДЕРА
  private selectBestProvider(options: RequestOptions, excludeTypes: Set<ProviderType>): APIProvider | null {
    const availableProviders = Array.from(this.providers.values()).filter(p => 
      !excludeTypes.has(p.type) &&
      p.isHealthy && 
      this.canMakeRequest(p) &&
      this.supportsRequest(p, options)
    );

    if (availableProviders.length === 0) {
      return null;
    }

    // Предпочитаемый провайдер (если доступен)
    if (options.preferredProvider) {
      const preferred = availableProviders.find(p => p.type === options.preferredProvider);
      if (preferred) {
        this.logger.info(`🎯 Using preferred provider: ${preferred.name}`);
        return preferred;
      }
    }

    // Провайдер со специализацией
    if (options.requiredSpecialty) {
      const specialized = availableProviders.filter(p => 
        p.specialties.includes(options.requiredSpecialty!)
      );
      if (specialized.length > 0) {
        return this.selectByScore(specialized);
      }
    }

    // Лучший по общему скору
    return this.selectByScore(availableProviders);
  }

  // 📊 РАСЧЕТ СКОРА ПРОВАЙДЕРА (улучшенный алгоритм)
  private selectByScore(providers: APIProvider[]): APIProvider {
    const scored = providers.map(p => ({
      provider: p,
      score: this.calculateAdvancedScore(p)
    }));

    // Сортируем по score (больше = лучше)
    scored.sort((a, b) => b.score - a.score);
    
    const winner = scored[0].provider;
    this.logger.info(`🏆 Selected provider: ${winner.name} (score: ${scored[0].score.toFixed(1)})`);
    
    return winner;
  }

  private calculateAdvancedScore(provider: APIProvider): number {
    let score = provider.priority * 20; // Базовый скор на основе приоритета (до 100)

    // Штраф за использование лимитов (более жесткий)
    const minuteUsage = provider.currentMinuteRequests / provider.requestsPerMinute;
    const dayUsage = provider.currentDayRequests / provider.requestsPerDay;
    
    score -= minuteUsage * 40; // До -40 за минутный лимит
    score -= dayUsage * 30;    // До -30 за дневной лимит

    // Бонус за надежность
    if (provider.totalRequests > 10) {
      const successRate = provider.successfulRequests / provider.totalRequests;
      score += successRate * 30; // До +30 за высокую успешность
      
      // Дополнительный бонус за стабильность
      if (successRate > 0.95) {
        score += 15; // Бонус за > 95% успешность
      }
    }

    // Штраф за медленность (более строгий)
    if (provider.avgResponseTime > 0) {
      const speedPenalty = Math.min(provider.avgResponseTime / 500 * 10, 25);
      score -= speedPenalty; // До -25 за медленность
    }

    // Серьезный штраф за недавние ошибки
    if (provider.lastErrorTime) {
      const timeSinceError = Date.now() - provider.lastErrorTime;
      if (timeSinceError < 30000) { // Последние 30 секунд
        score -= 40;
      } else if (timeSinceError < 120000) { // Последние 2 минуты
        score -= 20;
      }
    }

    return Math.max(score, 0);
  }

  // 🌐 ВЫПОЛНЕНИЕ ЗАПРОСА (улучшенное)
  private async executeRequest(provider: APIProvider, options: RequestOptions): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      // Увеличиваем счетчики
      this.incrementProviderUsage(provider);

      // Формируем запрос
      const requestConfig = this.buildRequestConfig(provider, options);
      
      // Делаем запрос с таймаутом
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout || 8000);

      const response = await fetch(requestConfig.url, {
        method: requestConfig.method,
        headers: requestConfig.headers,
        body: requestConfig.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      
      // Проверяем на RPC ошибки
      if (data && typeof data === 'object' && data.error) {
        const errorMsg = data.error.message || 
                        (typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        throw new Error(`RPC Error: ${errorMsg}`);
      }

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
      if (errorMessage.includes('timeout') || 
          errorMessage.includes('500') || 
          errorMessage.includes('502') ||
          errorMessage.includes('503')) {
        provider.isHealthy = false;
        this.logger.warn(`🚨 Temporarily marking ${provider.name} as unhealthy`);
        
        // Восстанавливаем через 2 минуты
        setTimeout(() => {
          provider.isHealthy = true;
          this.logger.info(`💚 Restored ${provider.name} to healthy state`);
        }, 120000);
      }

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
      'User-Agent': 'Solana-Smart-Money-Bot/3.2.0',
      'Accept': 'application/json'
    };

    let url = provider.baseUrl;
    let body: string | undefined;

    switch (provider.type) {
      case 'quicknode':
        // QuickNode с API ключом в URL
        if (!provider.baseUrl.includes(provider.apiKey)) {
          url = provider.baseUrl.replace('https://', `https://${provider.apiKey}@`);
        }
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: options.method,
          params: options.params || []
        });
        break;

      case 'alchemy':
        // Alchemy с ключом в URL
        if (!url.includes(provider.apiKey)) {
          url = `${provider.baseUrl}/${provider.apiKey}`;
        }
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: options.method,
          params: options.params || []
        });
        break;

      case 'getblock':
        // GetBlock с API ключом в URL
        url = `${provider.baseUrl}/${provider.apiKey}/`;
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: options.method,
          params: options.params || []
        });
        break;

      case 'moralis':
        // Moralis с заголовком
        headers['X-API-Key'] = provider.apiKey;
        if (options.method.includes('Token') || options.method.includes('Balance')) {
          // REST API для токенов
          url += this.mapMoralisEndpoint(options.method, options.params);
        } else {
          // RPC для остального
          url += '/rpc';
          body = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: options.method,
            params: options.params || []
          });
        }
        break;

      case 'ankr':
        // Ankr RPC
        if (provider.apiKey && provider.apiKey !== '') {
          headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: options.method,
          params: options.params || []
        });
        break;

      default:
        // Дефолтный RPC
        body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: options.method,
          params: options.params || []
        });
    }

    return { url, method: 'POST', headers, body };
  }

  private mapMoralisEndpoint(method: string, params?: any[]): string {
    // Упрощенный маппинг для Moralis REST API
    if (method.includes('TokenMetadata') && params?.[0]) {
      return `/account/${params[0]}/tokens`;
    }
    if (method.includes('Balance') && params?.[0]) {
      return `/account/${params[0]}/balance`;
    }
    return '/rpc';
  }

  // 🔄 НОРМАЛИЗАЦИЯ ОТВЕТОВ
  private normalizeResponse(providerType: ProviderType, data: any, options: RequestOptions): any {
    // Для RPC методов возвращаем результат
    if (data.result !== undefined) {
      return data.result;
    }

    // Для Moralis REST API
    if (providerType === 'moralis' && Array.isArray(data)) {
      return data;
    }

    // Возвращаем как есть
    return data;
  }

  // 💾 КЕШИРОВАНИЕ
  private generateCacheKey(options: RequestOptions): string {
    return `${options.method}:${JSON.stringify(options.params || [])}`;
  }

  private isCacheable(method: string): boolean {
    const cacheableMethods = [
      'getAccountInfo',
      'getTokenAccountsByOwner',
      'getTokenMetadata',
      'getBalance'
    ];
    return cacheableMethods.includes(method);
  }

  private getFromCache(key: string): any | null {
    const cached = this.responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setToCache(key: string, data: any): void {
    this.responseCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.responseCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.responseCache.delete(key);
        }
      }
    }, this.CACHE_TTL);
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

    // Обновляем среднее время ответа (скользящее среднее)
    if (provider.totalRequests > 0) {
      const weight = Math.min(provider.totalRequests, 100);
      provider.avgResponseTime = (provider.avgResponseTime * (weight - 1) + responseTime) / weight;
    }
  }

  // ✅ ПРОВЕРКИ
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

    // Проверяем лимиты (оставляем 10% буфер)
    return provider.currentMinuteRequests < provider.requestsPerMinute * 0.9 &&
           provider.currentDayRequests < provider.requestsPerDay * 0.9 &&
           provider.currentMonthRequests < provider.requestsPerMonth * 0.9;
  }

  private supportsRequest(provider: APIProvider, options: RequestOptions): boolean {
    if (!options.requiredSpecialty) return true;
    return provider.specialties.includes(options.requiredSpecialty);
  }

  // 🏥 ПРОВЕРКА ЗДОРОВЬЯ
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 3 * 60 * 1000); // Каждые 3 минуты

    this.logger.info('🏥 Health check started: every 3 minutes');
  }

  private async performHealthCheck(): Promise<void> {
    this.logger.info('🏥 Performing provider health check...');

    const healthPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        const result = await this.executeRequest(provider, {
          method: 'getSlot',
          params: [],
          timeout: 5000
        });

        const wasHealthy = provider.isHealthy;
        provider.isHealthy = result.success;
        
        if (!result.success) {
          this.logger.warn(`⚠️ ${provider.name} health check failed: ${result.error}`);
        } else if (!wasHealthy) {
          this.logger.info(`💚 ${provider.name} recovered!`);
        }
      } catch (error) {
        provider.isHealthy = false;
        this.logger.warn(`⚠️ ${provider.name} health check error:`, error);
      }
    });

    await Promise.allSettled(healthPromises);

    const healthyCount = Array.from(this.providers.values()).filter(p => p.isHealthy).length;
    this.logger.info(`🏥 Health check complete: ${healthyCount}/${this.providers.size} providers healthy`);
  }

  // 🔄 СБРОС СЧЕТЧИКОВ
  private startUsageReset(): void {
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

  // 📊 СТАТИСТИКА
  getStats() {
    const stats = {
      totalProviders: this.providers.size,
      healthyProviders: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      cacheSize: this.responseCache.size,
      providers: [] as any[]
    };

    let totalResponseTime = 0;
    let totalCount = 0;

    for (const provider of this.providers.values()) {
      if (provider.isHealthy) stats.healthyProviders++;
      stats.totalRequests += provider.totalRequests;
      stats.successfulRequests += provider.successfulRequests;
      stats.failedRequests += provider.failedRequests;
      
      if (provider.totalRequests > 0) {
        totalResponseTime += provider.avgResponseTime * provider.totalRequests;
        totalCount += provider.totalRequests;
      }

      const currentScore = this.calculateAdvancedScore(provider);

      stats.providers.push({
        name: provider.name,
        type: provider.type,
        priority: provider.priority,
        isHealthy: provider.isHealthy,
        score: currentScore.toFixed(1),
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
        lastError: provider.lastError,
        lastErrorTime: provider.lastErrorTime ? new Date(provider.lastErrorTime).toISOString() : null
      });
    }

    if (totalCount > 0) {
      stats.avgResponseTime = Math.round(totalResponseTime / totalCount);
    }

    // Сортируем провайдеров по скору
    stats.providers.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

    return stats;
  }

  // 🧹 ОЧИСТКА
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.responseCache.clear();
    this.logger.info('🔴 MultiProviderService shutdown completed');
  }

  // 🎯 УДОБНЫЕ МЕТОДЫ
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

  async getAccountInfo(address: string): Promise<any> {
    return this.makeRequest({
      method: 'getAccountInfo',
      params: [address, { encoding: 'jsonParsed' }],
      requiredSpecialty: 'rpc'
    });
  }

  async getTokenAccountsByOwner(owner: string, mint?: string): Promise<any> {
    const filter = mint ? 
      { mint } : 
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };

    return this.makeRequest({
      method: 'getTokenAccountsByOwner',
      params: [owner, filter, { encoding: 'jsonParsed' }],
      requiredSpecialty: 'tokens'
    });
  }

  async getBalance(address: string): Promise<any> {
    return this.makeRequest({
      method: 'getBalance',
      params: [address],
      requiredSpecialty: 'rpc'
    });
  }
}

// 📝 ENV переменные для .env файла:
/*
# Основные (обязательные)
QUICKNODE_HTTP_URL=https://your-endpoint.quiknode.pro/your-key/
QUICKNODE_API_KEY=your_quicknode_key

ALCHEMY_HTTP_URL=https://solana-mainnet.g.alchemy.com/v2/v7f2LOpqOJTp0h7JyI2AZEUu-bN25-JR
ALCHEMY_API_KEY=v7f2LOpqOJTp0h7JyI2AZEUu-bN25-JR

# Дополнительные (опциональные)
GETBLOCK_API_KEY=your_getblock_key
MORALIS_API_KEY=your_moralis_key  
ANKR_API_KEY=your_ankr_key
*/