// src/services/MultiProviderService.ts - МОЩНАЯ СИСТЕМА БАЛАНСИРОВКИ ПРОВАЙДЕРОВ
import { Logger } from '../utils/Logger';
import {
  ProviderConfig,
  APIResponse,
  ProviderStats,
  LoadBalancingResult,
  RetryConfig,
  HealthCheckResult,
  CacheEntry,
  CacheConfig,
  MultiProviderMetrics
} from '../types';

// Интерфейс для RPC ответа
interface RPCResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Мощная система управления множественными RPC провайдерами
 * Поддерживает QuickNode, Alchemy, Helius, GenesysGo, Triton
 * Автоматическая балансировка нагрузки, failover, кеширование
 */
export class MultiProviderService {
  private logger: Logger;
  private providers: Map<string, ProviderConfig> = new Map();
  private providerStats: Map<string, ProviderStats> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  
  // Конфигурация
  private retryConfig: RetryConfig;
  private cacheConfig: CacheConfig;
  
  // Мониторинг и метрики
  private metrics: MultiProviderMetrics;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private statsUpdateInterval: NodeJS.Timeout | null = null;
  
  // Состояние системы
  private primaryProvider: string | null = null;
  private isShuttingDown: boolean = false;
  private requestQueue: Array<() => Promise<any>> = [];
  private processingQueue: boolean = false;

  constructor() {
    this.logger = Logger.getInstance();
    
    // Инициализация конфигураций
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      retryOnErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'],
      retryOnTimeout: true,
      retryOnRateLimit: true
    };
    
    this.cacheConfig = {
      enabled: true,
      defaultTTL: 300, // 5 минут
      maxSize: 10000,
      cleanupInterval: 60, // 1 минута
      methodTTL: {
        'getAccountInfo': 30,
        'getSignaturesForAddress': 10,
        'getTransaction': 3600, // 1 час для завершенных транзакций
        'getTokenAccountsByOwner': 60,
        'getTokenMetadata': 86400, // 24 часа для метаданных
        'getBalance': 30
      }
    };
    
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      totalProviders: 0,
      healthyProviders: 0,
      primaryProvider: '',
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      cacheSize: 0,
      failovers: 0,
      providerDistribution: {}
    };
    
    // Инициализация провайдеров
    this.initializeProviders();
    
    // Запуск фоновых процессов
    this.startBackgroundTasks();
    
    this.logger.info('🚀 MultiProviderService initialized with advanced load balancing');
  }

  /**
   * Инициализация всех доступных провайдеров
   */
  private initializeProviders(): void {
    const providerConfigs: ProviderConfig[] = [
      // QuickNode - Основной провайдер
      {
        name: 'QuickNode-Primary',
        type: 'quicknode',
        baseUrl: process.env.QUICKNODE_HTTP_URL || '',
        apiKey: process.env.QUICKNODE_API_KEY || '',
        requestsPerMinute: 60,
        requestsPerDay: 20000,
        requestsPerMonth: 15000000,
        priority: 5, // Высший приоритет
        reliability: 95,
        specialties: ['rpc', 'fast', 'reliable', 'webhooks'],
        timeout: 8000,
        retryAttempts: 2,
        retryDelay: 1000
      },
      
      // Alchemy - Мощный резерв
      {
        name: 'Alchemy-Enhanced',
        type: 'alchemy',
        baseUrl: process.env.ALCHEMY_HTTP_URL || 'https://solana-mainnet.g.alchemy.com/v2',
        apiKey: process.env.ALCHEMY_API_KEY || '',
        requestsPerMinute: 150,
        requestsPerDay: 500000,
        requestsPerMonth: 20000000,
        priority: 5, // Также высший приоритет
        reliability: 98,
        specialties: ['rpc', 'enhanced', 'analytics', 'reliable'],
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 500
      },
      
      // Helius - Специализированный
      {
        name: 'Helius-Specialized',
        type: 'helius',
        baseUrl: 'https://mainnet.helius-rpc.com',
        apiKey: process.env.HELIUS_API_KEY || '',
        requestsPerMinute: 100,
        requestsPerDay: 200000,
        requestsPerMonth: 8000000,
        priority: 4,
        reliability: 90,
        specialties: ['rpc', 'metadata', 'enhanced', 'analytics'],
        timeout: 12000,
        retryAttempts: 2,
        retryDelay: 1500
      },
      
      // GenesysGo - Резервный
      {
        name: 'GenesysGo-Backup',
        type: 'genesysgo',
        baseUrl: 'https://ssc-dao.genesysgo.net',
        apiKey: process.env.GENESYSGO_API_KEY || '',
        requestsPerMinute: 80,
        requestsPerDay: 100000,
        requestsPerMonth: 5000000,
        priority: 3,
        reliability: 85,
        specialties: ['rpc', 'backup'],
        timeout: 15000,
        retryAttempts: 1,
        retryDelay: 2000
      },
      
      // Triton - Дополнительный
      {
        name: 'Triton-Extra',
        type: 'triton',
        baseUrl: 'https://triton.one/rpc',
        apiKey: process.env.TRITON_API_KEY || '',
        requestsPerMinute: 50,
        requestsPerDay: 50000,
        requestsPerMonth: 2000000,
        priority: 3,
        reliability: 80,
        specialties: ['rpc', 'extra'],
        timeout: 20000,
        retryAttempts: 1,
        retryDelay: 3000
      }
    ];

    // Регистрируем только провайдеров с API ключами
    for (const config of providerConfigs) {
      if (config.apiKey && config.baseUrl) {
        this.addProvider(config);
        this.logger.info(`✅ Provider registered: ${config.name} (Priority: ${config.priority})`);
      } else {
        this.logger.warn(`⚠️ Skipping ${config.name}: missing API key or URL`);
      }
    }

    // Устанавливаем основной провайдер
    this.selectPrimaryProvider();
    this.updateMetrics();
  }

  /**
   * Добавление нового провайдера
   */
  public addProvider(config: ProviderConfig): void {
    this.providers.set(config.name, config);
    
    // Инициализация статистики
    this.providerStats.set(config.name, {
      name: config.name,
      type: config.type,
      requestCount: 0,
      errorCount: 0,
      successRate: 100,
      avgResponseTime: 0,
      isHealthy: true,
      priority: config.priority,
      currentMinuteRequests: 0,
      currentDayRequests: 0,
      currentMonthRequests: 0,
      minuteUsage: 0,
      dayUsage: 0,
      monthUsage: 0,
      consecutiveErrors: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      responseTimeHistory: []
    });
    
    this.metrics.totalProviders++;
    this.metrics.providerDistribution[config.name] = 0;
  }

  /**
   * 🚀 ГЛАВНЫЙ МЕТОД - УМНЫЙ ЗАПРОС С БАЛАНСИРОВКОЙ
   */
  async makeRequest<T = any>(
    method: string, 
    params: any[] = [], 
    options: {
      preferredProvider?: string;
      requiredSpecialty?: string;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      timeout?: number;
      maxRetries?: number;
      useCache?: boolean;
    } = {}
  ): Promise<APIResponse<T>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      this.metrics.totalRequests++;
      
      // Проверяем кеш
      if (options.useCache !== false && this.cacheConfig.enabled) {
        const cached = this.getFromCache(method, params);
        if (cached) {
          this.metrics.cacheHits++;
          this.updateCacheMetrics();
          return {
            success: true,
            data: cached.data as T,
            provider: cached.provider,
            responseTime: Date.now() - startTime,
            retryCount: 0,
            fromCache: true
          };
        }
        this.metrics.cacheMisses++;
      }

      // Выбираем лучший провайдер
      const loadBalancingResult = await this.selectBestProvider(options);
      if (!loadBalancingResult) {
        throw new Error('No healthy providers available');
      }

      // Выполняем запрос с retry логикой
      const response = await this.executeRequestWithRetry<T>(
        loadBalancingResult.provider,
        method,
        params,
        options,
        requestId
      );

      // Кешируем успешный результат
      if (response.success && options.useCache !== false && this.cacheConfig.enabled) {
        this.setToCache(method, params, response.data, loadBalancingResult.provider.name);
      }

      // Обновляем метрики
      this.updateProviderMetrics(loadBalancingResult.provider.name, true, response.responseTime);
      this.metrics.successfulRequests++;
      this.updateRequestMetrics(Date.now() - startTime);

      return response;

    } catch (error) {
      this.metrics.failedRequests++;
      this.logger.error(`❌ Request failed: ${method}`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'error',
        responseTime: Date.now() - startTime,
        retryCount: this.retryConfig.maxAttempts
      };
    }
  }

  /**
   * 🎯 УМНЫЙ ВЫБОР ПРОВАЙДЕРА С БАЛАНСИРОВКОЙ
   */
  private async selectBestProvider(options: {
    preferredProvider?: string;
    requiredSpecialty?: string;
    priority?: string;
  }): Promise<LoadBalancingResult | null> {
    const availableProviders = Array.from(this.providers.values()).filter(provider => {
      const stats = this.providerStats.get(provider.name);
      return stats?.isHealthy && this.canMakeRequest(provider.name);
    });

    if (availableProviders.length === 0) {
      this.logger.error('💀 No healthy providers available!');
      return null;
    }

    // Предпочитаемый провайдер
    if (options.preferredProvider) {
      const preferred = availableProviders.find(p => p.name === options.preferredProvider);
      if (preferred) {
        return {
          provider: preferred,
          fallbackUsed: false,
          totalProviders: this.providers.size,
          healthyProviders: availableProviders.length,
          responseTime: 0,
          retries: 0
        };
      }
    }

    // Фильтрация по специализации
    if (options.requiredSpecialty) {
      const specialized = availableProviders.filter(p => 
        p.specialties.includes(options.requiredSpecialty!)
      );
      if (specialized.length > 0) {
        const best = this.selectByScore(specialized);
        return {
          provider: best,
          fallbackUsed: false,
          totalProviders: this.providers.size,
          healthyProviders: availableProviders.length,
          responseTime: 0,
          retries: 0
        };
      }
    }

    // Выбор по скору
    const best = this.selectByScore(availableProviders);
    return {
      provider: best,
      fallbackUsed: availableProviders.length < this.providers.size,
      totalProviders: this.providers.size,
      healthyProviders: availableProviders.length,
      responseTime: 0,
      retries: 0
    };
  }

  /**
   * 📊 РАСЧЕТ СКОРА ПРОВАЙДЕРА (УЛУЧШЕННЫЙ АЛГОРИТМ)
   */
  private selectByScore(providers: ProviderConfig[]): ProviderConfig {
    const scored = providers.map(provider => {
      const stats = this.providerStats.get(provider.name)!;
      let score = provider.priority * 20; // Базовый скор (до 100)

      // Штрафы за использование лимитов
      score -= stats.minuteUsage * 0.3;
      score -= stats.dayUsage * 0.2;
      score -= stats.monthUsage * 0.1;

      // Бонус за надежность
      score += stats.successRate * 0.3;

      // Штраф за медленность
      if (stats.avgResponseTime > 0) {
        const speedPenalty = Math.min(stats.avgResponseTime / 1000 * 5, 20);
        score -= speedPenalty;
      }

      // Штраф за последовательные ошибки
      score -= stats.consecutiveErrors * 10;

      // Бонус за стабильность
      if (stats.responseTimeHistory.length > 10) {
        const variance = this.calculateVariance(stats.responseTimeHistory);
        const stability = Math.max(0, 100 - variance / 100);
        score += stability * 0.1;
      }

      return { provider, score: Math.max(score, 0) };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0].provider;
    
    this.logger.debug(`🏆 Selected provider: ${winner.name} (score: ${scored[0].score.toFixed(1)})`);
    return winner;
  }

  /**
   * 🔄 ВЫПОЛНЕНИЕ ЗАПРОСА С RETRY ЛОГИКОЙ
   */
  private async executeRequestWithRetry<T>(
    provider: ProviderConfig,
    method: string,
    params: any[],
    options: any,
    requestId: string
  ): Promise<APIResponse<T>> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      const startTime = Date.now();
      
      try {
        const response = await this.executeRequest(provider, method, params, options.timeout || provider.timeout);
        const responseTime = Date.now() - startTime;
        
        return {
          success: true,
          data: response as T,
          provider: provider.name,
          responseTime,
          retryCount: attempt
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        const responseTime = Date.now() - startTime;
        
        this.updateProviderMetrics(provider.name, false, responseTime);
        
        // Проверяем, нужно ли повторить
        if (!this.shouldRetry(lastError, attempt)) {
          break;
        }

        // Задержка перед повтором
        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
            this.retryConfig.maxDelay
          );
          
          this.logger.warn(`⏳ Retrying ${provider.name} in ${delay}ms (attempt ${attempt + 1})`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * 🌐 ВЫПОЛНЕНИЕ HTTP ЗАПРОСА
   */
  private async executeRequest(
    provider: ProviderConfig,
    method: string,
    params: any[],
    timeout: number
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Smart-Money-MultiProvider/1.0'
      };

      // Добавляем авторизацию в зависимости от типа провайдера
      const url = this.buildProviderUrl(provider);
      this.addAuthHeaders(provider, headers);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as RPCResponse;

      // Проверяем на RPC ошибки
      if (data.error) {
        throw new Error(`RPC Error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      // Отслеживаем rate limits
      this.trackRateLimits(provider.name, response);

      return data.result;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  /**
   * 🔗 ПОСТРОЕНИЕ URL ПРОВАЙДЕРА
   */
  private buildProviderUrl(provider: ProviderConfig): string {
    switch (provider.type) {
      case 'quicknode':
        return provider.baseUrl;
      
      case 'alchemy':
        return provider.baseUrl.includes(provider.apiKey) ? 
          provider.baseUrl : 
          `${provider.baseUrl}/${provider.apiKey}`;
      
      case 'helius':
        return `${provider.baseUrl}/?api-key=${provider.apiKey}`;
      
      case 'genesysgo':
      case 'triton':
      default:
        return provider.baseUrl;
    }
  }

  /**
   * 🔐 ДОБАВЛЕНИЕ ЗАГОЛОВКОВ АВТОРИЗАЦИИ
   */
  private addAuthHeaders(provider: ProviderConfig, headers: Record<string, string>): void {
    switch (provider.type) {
      case 'quicknode':
        // QuickNode использует API key в URL или Basic Auth
        if (!provider.baseUrl.includes(provider.apiKey)) {
          headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }
        break;
      
      case 'alchemy':
        // Alchemy обычно использует API key в URL
        break;
      
      case 'helius':
        // Helius использует API key в query параметре
        break;
      
      case 'genesysgo':
      case 'triton':
        if (provider.apiKey) {
          headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }
        break;
    }
  }

  /**
   * 📊 ОТСЛЕЖИВАНИЕ RATE LIMITS
   */
  private trackRateLimits(providerName: string, response: Response): void {
    const stats = this.providerStats.get(providerName);
    if (!stats) return;

    // Обновляем счетчики запросов
    stats.currentMinuteRequests++;
    stats.currentDayRequests++;
    stats.currentMonthRequests++;

    // Читаем заголовки rate limit
    const remaining = response.headers.get('x-ratelimit-remaining') || 
                     response.headers.get('x-rate-limit-remaining');
    const reset = response.headers.get('x-ratelimit-reset') || 
                  response.headers.get('x-rate-limit-reset');

    if (remaining) {
      // Обновляем информацию о лимитах
    }
  }

  /**
   * 🔍 ПРОВЕРКА ВОЗМОЖНОСТИ ЗАПРОСА
   */
  private canMakeRequest(providerName: string): boolean {
    const provider = this.providers.get(providerName);
    const stats = this.providerStats.get(providerName);
    
    if (!provider || !stats) return false;

    // Сброс счетчиков по времени
    const now = Date.now();
    const minuteAgo = now - 60000;
    const dayAgo = now - 86400000;
    const monthAgo = now - 30 * 86400000;

    // Простая проверка лимитов (можно улучшить с точным временем)
    return stats.currentMinuteRequests < provider.requestsPerMinute * 0.9 &&
           stats.currentDayRequests < provider.requestsPerDay * 0.9 &&
           stats.currentMonthRequests < provider.requestsPerMonth * 0.9;
  }

  /**
   * 📈 ОБНОВЛЕНИЕ МЕТРИК ПРОВАЙДЕРА
   */
  private updateProviderMetrics(providerName: string, success: boolean, responseTime: number): void {
    const stats = this.providerStats.get(providerName);
    if (!stats) return;

    stats.requestCount++;
    
    if (success) {
      stats.consecutiveErrors = 0;
    } else {
      stats.errorCount++;
      stats.consecutiveErrors++;
      
      // Помечаем как нездоровый при множественных ошибках
      if (stats.consecutiveErrors >= 3) {
        stats.isHealthy = false;
        this.logger.warn(`💔 Provider ${providerName} marked as unhealthy`);
      }
    }

    // Обновляем статистику времени ответа
    stats.responseTimeHistory.push(responseTime);
    if (stats.responseTimeHistory.length > 100) {
      stats.responseTimeHistory.shift(); // Храним только последние 100
    }

    stats.avgResponseTime = stats.responseTimeHistory.reduce((a, b) => a + b, 0) / stats.responseTimeHistory.length;
    stats.minResponseTime = Math.min(stats.minResponseTime, responseTime);
    stats.maxResponseTime = Math.max(stats.maxResponseTime, responseTime);
    
    // Обновляем процент успешности
    stats.successRate = ((stats.requestCount - stats.errorCount) / stats.requestCount) * 100;

    // Обновляем использование лимитов
    const provider = this.providers.get(providerName);
    if (provider) {
      stats.minuteUsage = (stats.currentMinuteRequests / provider.requestsPerMinute) * 100;
      stats.dayUsage = (stats.currentDayRequests / provider.requestsPerDay) * 100;
      stats.monthUsage = (stats.currentMonthRequests / provider.requestsPerMonth) * 100;
    }

    // Обновляем распределение нагрузки
    this.metrics.providerDistribution[providerName] = (this.metrics.providerDistribution[providerName] || 0) + 1;
  }

  /**
   * 🏥 ПРОВЕРКА ЗДОРОВЬЯ ПРОВАЙДЕРОВ
   */
  async performHealthCheck(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    const healthPromises = Array.from(this.providers.values()).map(async (provider) => {
      const startTime = Date.now();
      const stats = this.providerStats.get(provider.name)!;
      
      try {
        await this.executeRequest(provider, 'getSlot', [], 5000);
        
        const responseTime = Date.now() - startTime;
        const wasUnhealthy = !stats.isHealthy;
        
        stats.isHealthy = true;
        stats.consecutiveErrors = 0;
        
        if (wasUnhealthy) {
          this.logger.info(`💚 ${provider.name} recovered (${responseTime}ms)`);
        }

        results.push({
          provider: provider.name,
          isHealthy: true,
          responseTime,
          timestamp: new Date(),
          consecutiveFailures: 0,
          lastSuccessTime: new Date()
        });

      } catch (error) {
        const responseTime = Date.now() - startTime;
        stats.isHealthy = false;
        stats.consecutiveErrors++;
        
        results.push({
          provider: provider.name,
          isHealthy: false,
          responseTime,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
          consecutiveFailures: stats.consecutiveErrors
        });
        
        this.logger.warn(`💔 ${provider.name} health check failed: ${error}`);
      }
    });

    await Promise.allSettled(healthPromises);
    
    // Обновляем метрики
    this.updateHealthMetrics(results);
    
    return results;
  }

  /**
   * 💾 КЕШИРОВАНИЕ
   */
  private getFromCache(method: string, params: any[]): CacheEntry | null {
    const key = this.generateCacheKey(method, params);
    const entry = this.cache.get(key);
    
    if (entry && Date.now() < entry.expiresAt) {
      entry.hitCount++;
      return entry;
    }
    
    if (entry) {
      this.cache.delete(key); // Удаляем устаревшую запись
    }
    
    return null;
  }

  private setToCache(method: string, params: any[], data: any, provider: string): void {
    const key = this.generateCacheKey(method, params);
    const ttl = this.cacheConfig.methodTTL[method] || this.cacheConfig.defaultTTL;
    
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl * 1000,
      provider,
      hitCount: 0
    };
    
    // Проверяем размер кеша
    if (this.cache.size >= this.cacheConfig.maxSize) {
      this.cleanupCache();
    }
    
    this.cache.set(key, entry);
  }

  private generateCacheKey(method: string, params: any[]): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  private cleanupCache(): void {
    const now = Date.now();
    let removed = 0;
    
    // Удаляем устаревшие записи
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    // Если все еще превышаем лимит, удаляем наименее используемые
    if (this.cache.size >= this.cacheConfig.maxSize) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].hitCount - b[1].hitCount);
      
      const toRemove = Math.floor(this.cacheConfig.maxSize * 0.1); // Удаляем 10%
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug(`🧹 Cache cleanup: removed ${removed} entries`);
    }
  }

  /**
   * 🚀 ФОНОВЫЕ ЗАДАЧИ
   */
  private startBackgroundTasks(): void {
    // Health check каждые 2 минуты
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isShuttingDown) {
        await this.performHealthCheck();
      }
    }, 2 * 60 * 1000);

    // Очистка кеша каждую минуту
    this.cacheCleanupInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.cleanupCache();
        this.updateCacheMetrics();
      }
    }, this.cacheConfig.cleanupInterval * 1000);

    // Обновление статистики каждые 30 секунд
    this.statsUpdateInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.updateMetrics();
        this.resetCounters();
      }
    }, 30000);

    this.logger.info('⚙️ Background tasks started');
  }

  /**
   * 📊 ОБНОВЛЕНИЕ МЕТРИК
   */
  private updateMetrics(): void {
    const healthyProviders = Array.from(this.providerStats.values()).filter(s => s.isHealthy).length;
    
    this.metrics.healthyProviders = healthyProviders;
    this.metrics.cacheSize = this.cache.size;
    
    if (this.metrics.totalRequests > 0) {
      this.metrics.cacheHitRate = (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100;
    }

    // Выбираем новый основной провайдер если нужно
    if (!this.primaryProvider || !this.providerStats.get(this.primaryProvider)?.isHealthy) {
      this.selectPrimaryProvider();
    }
  }

  private updateHealthMetrics(results: HealthCheckResult[]): void {
    this.metrics.healthyProviders = results.filter(r => r.isHealthy).length;
  }

  private updateCacheMetrics(): void {
    this.metrics.cacheSize = this.cache.size;
  }

  private updateRequestMetrics(responseTime: number): void {
    // Обновляем среднее время ответа
    const totalTime = this.metrics.avgResponseTime * (this.metrics.totalRequests - 1) + responseTime;
    this.metrics.avgResponseTime = totalTime / this.metrics.totalRequests;
  }

  private selectPrimaryProvider(): void {
    const healthyProviders = Array.from(this.providers.values()).filter(p => {
      const stats = this.providerStats.get(p.name);
      return stats?.isHealthy;
    });

    if (healthyProviders.length === 0) {
      this.primaryProvider = null;
      this.metrics.primaryProvider = '';
      return;
    }

    // Выбираем провайдер с наивысшим приоритетом и лучшей производительностью
    const best = this.selectByScore(healthyProviders);
    
    if (this.primaryProvider !== best.name) {
      this.logger.info(`🔄 Primary provider changed: ${this.primaryProvider} → ${best.name}`);
      this.primaryProvider = best.name;
      this.metrics.primaryProvider = best.name;
    }
  }

  private resetCounters(): void {
    // Сбрасываем минутные счетчики каждую минуту
    for (const stats of this.providerStats.values()) {
      if (Date.now() % 60000 < 30000) { // Приблизительно раз в минуту
        stats.currentMinuteRequests = 0;
      }
    }
  }

  /**
   * 🛠️ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
   */
  private shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.retryConfig.maxAttempts - 1) return false;

    const errorMessage = error.message.toLowerCase();
    
    // Retry на сетевые ошибки
    if (this.retryConfig.retryOnErrors.some(code => errorMessage.includes(code.toLowerCase()))) {
      return true;
    }
    
    // Retry на таймауты
    if (this.retryConfig.retryOnTimeout && errorMessage.includes('timeout')) {
      return true;
    }
    
    // Retry на rate limits
    if (this.retryConfig.retryOnRateLimit && (errorMessage.includes('rate limit') || errorMessage.includes('429'))) {
      return true;
    }
    
    return false;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;
    
    return variance;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 📊 ПУБЛИЧНЫЕ МЕТОДЫ ДЛЯ ПОЛУЧЕНИЯ СТАТИСТИКИ
   */
  public getMetrics(): MultiProviderMetrics {
    return { ...this.metrics };
  }

  public getProviderStats(): ProviderStats[] {
    return Array.from(this.providerStats.values());
  }

  public getHealthyProviders(): ProviderConfig[] {
    return Array.from(this.providers.values()).filter(p => {
      const stats = this.providerStats.get(p.name);
      return stats?.isHealthy;
    });
  }

  public getPrimaryProvider(): ProviderConfig | null {
    return this.primaryProvider ? this.providers.get(this.primaryProvider) || null : null;
  }

  /**
   * 🧹 ОЧИСТКА И ЗАВЕРШЕНИЕ
   */
  public async shutdown(): Promise<void> {
    this.logger.info('🔴 Shutting down MultiProviderService...');
    this.isShuttingDown = true;

    // Останавливаем фоновые задачи
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }

    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
      this.statsUpdateInterval = null;
    }

    // Очищаем кеш
    this.cache.clear();

    this.logger.info('✅ MultiProviderService shutdown completed');
  }

  /**
   * 🚀 УДОБНЫЕ МЕТОДЫ ДЛЯ ОСНОВНЫХ RPC ВЫЗОВОВ
   */
  public async getAccountInfo(address: string, options?: any): Promise<APIResponse> {
    return this.makeRequest('getAccountInfo', [address, options || { encoding: 'jsonParsed' }]);
  }

  public async getSignaturesForAddress(address: string, options?: any): Promise<APIResponse> {
    return this.makeRequest('getSignaturesForAddress', [address, options || {}]);
  }

  public async getTransaction(signature: string, options?: any): Promise<APIResponse> {
    return this.makeRequest('getTransaction', [signature, options || { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  }

  public async getTokenAccountsByOwner(owner: string, filter: any, options?: any): Promise<APIResponse> {
    return this.makeRequest('getTokenAccountsByOwner', [owner, filter, options || { encoding: 'jsonParsed' }]);
  }

  public async getBalance(address: string): Promise<APIResponse> {
    return this.makeRequest('getBalance', [address]);
  }

  public async getSlot(): Promise<APIResponse> {
    return this.makeRequest('getSlot', []);
  }

  public async getBlockHeight(): Promise<APIResponse> {
    return this.makeRequest('getBlockHeight', []);
  }

  public async getRecentBlockhash(commitment?: string): Promise<APIResponse> {
    return this.makeRequest('getRecentBlockhash', [commitment || 'confirmed']);
  }
}