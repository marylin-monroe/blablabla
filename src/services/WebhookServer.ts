// src/services/WebhookServer.ts - С ФИЛЬТРАМИ SMART MONEY + АГРЕГАЦИЯ ПОЗИЦИЙ + ИНТЕГРАЦИЯ SOLANA MONITOR
import express from 'express';
import { Database } from './Database';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { SolanaMonitor } from './SolanaMonitor';
import { Logger } from '../utils/Logger';
import { SmartMoneySwap, SmartMoneyWallet, TokenSwap } from '../types';

interface HeliusWebhookPayload {
  type: string;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  events?: {
    swap?: Array<{
      nativeInput?: {
        account: string;
        amount: string;
      };
      nativeOutput?: {
        account: string;
        amount: string;
      };
      tokenInputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: {
          tokenAmount: string;
          decimals: number;
        };
      }>;
      tokenOutputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: {
          tokenAmount: string;
          decimals: number;
        };
      }>;
    }>;
  };
}

// 🚨 НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ ФИЛЬТРАЦИИ
interface TokenCreatorCheck {
  isCreator: boolean;
  isTopHolder: boolean;
  holdingPercentage: number;
  creationTime: Date;
  firstTxTime: Date;
  tokenAge: number; // в часах
}

interface SmartMoneyValidationResult {
  isValid: boolean;
  reason?: string;
  suspiciousFactors: string[];
  riskScore: number; // 0-100
}

// 🆕 НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ СТАТИСТИКИ И МОНИТОРИНГА
interface ProcessingStats {
  totalTransactionsProcessed: number;
  smartMoneyTransactions: number;
  regularTransactions: number;
  positionAggregations: number; // 🆕 НОВОЕ ПОЛЕ
  alertsSent: number;
  filteredTransactions: number;
  errorCount: number;
  avgProcessingTime: number;
  lastProcessedTime: Date;
  // 🆕 ДЕТАЛЬНАЯ СТАТИСТИКА ПО ТИПАМ
  transactionTypes: {
    swaps: number;
    transfers: number;
    other: number;
  };
  riskLevels: {
    high: number;
    medium: number;
    low: number;
  };
}

interface PerformanceMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  activeConnections: number;
  requestsPerMinute: number;
  errorsPerMinute: number;
  cacheHitRate: number;
}

export class WebhookServer {
  private app: express.Application;
  private server: any;
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private solanaMonitor: SolanaMonitor;
  private logger: Logger;
  private port: number;

  // 🚨 КЕШИ ДЛЯ ОПТИМИЗАЦИИ ФИЛЬТРОВ
  private tokenInfoCache = new Map<string, { 
    symbol: string; 
    name: string; 
    creator?: string;
    createdAt?: Date;
    timestamp: number; 
  }>();
  private topHoldersCache = new Map<string, { 
    holders: Array<{address: string; percentage: number; rank: number}>;
    timestamp: number;
  }>();
  private relatedWalletsCache = new Map<string, {
    relatedWallets: string[];
    timestamp: number;
  }>();
  
  // 🚀 НОВЫЙ КЕШ ДЛЯ RECENT TOKEN TRANSACTIONS - СНИЖАЕТ НАГРУЗКУ НА БД В 10+ РАЗ!
  private recentTxCache = new Map<string, {
    transactions: Array<{
      walletAddress: string;
      timestamp: Date;
      amountUSD: number;
      swapType: 'buy' | 'sell';
    }>;
    timestamp: number;
  }>();
  
  // 🧹 АВТООЧИСТКА КЕШЕЙ ОТ СТАРЫХ ЗАПИСЕЙ
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  // 🆕 СТАТИСТИКА И МОНИТОРИНГ
  private processingStats: ProcessingStats = {
    totalTransactionsProcessed: 0,
    smartMoneyTransactions: 0,
    regularTransactions: 0,
    positionAggregations: 0,
    alertsSent: 0,
    filteredTransactions: 0,
    errorCount: 0,
    avgProcessingTime: 0,
    lastProcessedTime: new Date(),
    transactionTypes: {
      swaps: 0,
      transfers: 0,
      other: 0
    },
    riskLevels: {
      high: 0,
      medium: 0,
      low: 0
    }
  };

  // 🆕 МЕТРИКИ ПРОИЗВОДИТЕЛЬНОСТИ
  private performanceInterval: NodeJS.Timeout | null = null;
  private requestCounters = {
    lastMinuteRequests: 0,
    lastMinuteErrors: 0,
    lastMinuteReset: Date.now() + 60000
  };

  constructor(
    database: Database,
    telegramNotifier: TelegramNotifier,
    solanaMonitor: SolanaMonitor,
    smDatabase: SmartMoneyDatabase
  ) {
    this.database = database;
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
    this.solanaMonitor = solanaMonitor;
    this.logger = Logger.getInstance();
    this.port = parseInt(process.env.PORT || '3000');

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    
    // 🧹 ЗАПУСКАЕМ АВТООЧИСТКУ КЕШЕЙ КАЖДЫЕ 30 МИНУТ
    this.startCacheCleanup();
    
    // 🆕 ЗАПУСКАЕМ МОНИТОРИНГ ПРОИЗВОДИТЕЛЬНОСТИ
    this.startPerformanceMonitoring();
    
    // 🆕 ЗАПУСКАЕМ ПЕРИОДИЧЕСКУЮ ОТПРАВКУ СТАТИСТИКИ
    this.startStatsReporting();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // 🆕 MIDDLEWARE ДЛЯ ОТСЛЕЖИВАНИЯ ЗАПРОСОВ
    this.app.use((req, res, next) => {
      const now = Date.now();
      
      // Сброс счетчиков каждую минуту
      if (now > this.requestCounters.lastMinuteReset) {
        this.requestCounters.lastMinuteRequests = 0;
        this.requestCounters.lastMinuteErrors = 0;
        this.requestCounters.lastMinuteReset = now + 60000;
      }
      
      this.requestCounters.lastMinuteRequests++;
      
      this.logger.debug(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });

    // 🆕 ERROR HANDLING MIDDLEWARE
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.requestCounters.lastMinuteErrors++;
      this.processingStats.errorCount++;
      this.logger.error('Express error:', err);
      
      res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      const solanaStats = this.solanaMonitor.getAggregationStats();
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Smart Money Tracker Background Worker (WITH FILTERS + POSITION AGGREGATION + SOLANA MONITOR INTEGRATION)',
        version: '3.3.0',
        uptime: process.uptime(),
        filters: {
          tokenCreatorCheck: 'enabled',
          topHolderFilter: 'enabled',
          relatedWalletDetection: 'enabled',
          riskScoring: 'enabled',
          positionAggregation: 'enabled',
          solanaMonitorIntegration: 'enabled' // 🆕 НОВАЯ ФИЧА
        },
        // 🆕 ИНТЕГРАЦИЯ СО СТАТИСТИКОЙ SOLANA MONITOR
        aggregationStats: {
          activePositions: solanaStats.activePositions,
          totalDetected: solanaStats.stats?.totalPositionsDetected || 0,
          alertsSent: solanaStats.stats?.alertsSent || 0
        }
      });
    });

    this.app.post('/webhook', async (req, res) => {
      const startTime = Date.now();
      
      try {
        const webhookData: HeliusWebhookPayload[] = Array.isArray(req.body) ? req.body : [req.body];
        
        this.logger.info(`📡 Received webhook with ${webhookData.length} transactions`);

        // 🆕 ПАРАЛЛЕЛЬНАЯ ОБРАБОТКА С ОГРАНИЧЕНИЕМ
        const batchSize = 5; // Обрабатываем максимум 5 транзакций параллельно
        const results = [];
        
        for (let i = 0; i < webhookData.length; i += batchSize) {
          const batch = webhookData.slice(i, i + batchSize);
          const batchPromises = batch.map(txData => this.processWebhookTransactionWithStats(txData));
          const batchResults = await Promise.allSettled(batchPromises);
          results.push(...batchResults);
        }

        // Подсчитываем результаты
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        // Обновляем статистику
        this.processingStats.totalTransactionsProcessed += webhookData.length;
        this.processingStats.lastProcessedTime = new Date();
        
        const processingTime = Date.now() - startTime;
        this.processingStats.avgProcessingTime = 
          (this.processingStats.avgProcessingTime + processingTime) / 2;

        res.status(200).json({ 
          success: true, 
          processed: successful,
          failed: failed,
          totalReceived: webhookData.length,
          processingTimeMs: processingTime,
          // 🆕 ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ
          stats: {
            positionAggregations: this.processingStats.positionAggregations,
            alertsSent: this.processingStats.alertsSent
          }
        });
        
      } catch (error) {
        this.logger.error('❌ Error processing webhook:', error as Error);
        this.processingStats.errorCount++;
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.post('/test', async (req, res) => {
      try {
        this.logger.info('🧪 Test endpoint called');
        
        // 🆕 ТЕСТИРУЕМ ИНТЕГРАЦИЮ С SOLANA MONITOR
        const solanaStats = this.solanaMonitor.getAggregationStats();
        
        await this.telegramNotifier.sendCycleLog(
          '🧪 <b>Test notification</b>\n' +
          `Background Worker is running correctly (WITH SMART MONEY FILTERS + POSITION AGGREGATION + SOLANA MONITOR)\n` +
          `Timestamp: <code>${new Date().toISOString()}</code>\n\n` +
          `🎯 <b>Solana Monitor Stats:</b>\n` +
          `• Active positions: <code>${solanaStats.activePositions}</code>\n` +
          `• Cache hit rate: <code>${solanaStats.cacheStats?.cacheHitRate || '0%'}</code>\n` +
          `• Total detected: <code>${solanaStats.stats?.totalPositionsDetected || 0}</code>`
        );

        res.json({ 
          success: true, 
          message: 'Test notification sent with Solana Monitor integration',
          timestamp: new Date().toISOString(),
          solanaMonitorStats: solanaStats
        });
      } catch (error) {
        this.logger.error('❌ Error in test endpoint:', error as Error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // 🆕 РАСШИРЕННАЯ СТАТИСТИКА С ИНТЕГРАЦИЕЙ SOLANA MONITOR
    this.app.get('/stats', async (req, res) => {
      try {
        const dbStats = await this.smDatabase.getWalletStats();
        const recentTransactions = await this.database.getRecentTransactions(24);
        const solanaStats = this.solanaMonitor.getAggregationStats();
        const performanceMetrics = this.getPerformanceMetrics();
        
        res.json({
          smartMoneyWallets: dbStats,
          recentActivity: {
            last24h: recentTransactions.length,
            lastUpdate: new Date().toISOString()
          },
          service: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: '3.3.0'
          },
          filters: {
            tokenInfoCacheSize: this.tokenInfoCache.size,
            holdersCache: this.topHoldersCache.size,
            relatedWalletsCache: this.relatedWalletsCache.size,
            recentTxCache: this.recentTxCache.size
          },
          // 🆕 СТАТИСТИКА ОБРАБОТКИ
          processing: this.processingStats,
          // 🆕 ИНТЕГРАЦИЯ СО СТАТИСТИКОЙ SOLANA MONITOR
          positionAggregation: {
            solanaMonitor: solanaStats,
            database: await this.database.getPositionAggregationStats()
          },
          // 🆕 МЕТРИКИ ПРОИЗВОДИТЕЛЬНОСТИ
          performance: performanceMetrics
        });
      } catch (error) {
        this.logger.error('❌ Error getting stats:', error as Error);
        res.status(500).json({ error: 'Failed to get statistics' });
      }
    });

    // 🆕 НОВЫЙ ENDPOINT ДЛЯ ПРИНУДИТЕЛЬНОЙ ПРОВЕРКИ ПОЗИЦИЙ
    this.app.post('/force-check-positions', async (req, res) => {
      try {
        this.logger.info('🔍 Force checking all positions...');
        
        const processed = await this.solanaMonitor.forceCheckAllPositions();
        
        res.json({
          success: true,
          message: `Force-checked all positions`,
          processed,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        this.logger.error('❌ Error in force check positions:', error as Error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // 🆕 НОВЫЙ ENDPOINT ДЛЯ ДЕТАЛЬНОЙ СТАТИСТИКИ АГРЕГАЦИИ
    this.app.get('/aggregation-details', async (req, res) => {
      try {
        const solanaStats = this.solanaMonitor.getAggregationStats();
        const dbStats = await this.database.getPositionAggregationStats();
        const detectionStats = this.solanaMonitor.getDetectionStats();
        
        res.json({
          solanaMonitor: {
            ...solanaStats,
            detectionStats
          },
          database: dbStats,
          integration: {
            syncStatus: 'active',
            lastSync: new Date().toISOString(),
            activePositions: solanaStats.activePositions,
            totalDetected: detectionStats.totalDetected
          }
        });
        
      } catch (error) {
        this.logger.error('❌ Error getting aggregation details:', error as Error);
        res.status(500).json({ error: 'Failed to get aggregation details' });
      }
    });

    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  // 🆕 ОБРАБОТКА ТРАНЗАКЦИИ СО СТАТИСТИКОЙ
  private async processWebhookTransactionWithStats(txData: HeliusWebhookPayload): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Определяем тип транзакции
      if (txData.events?.swap && txData.events.swap.length > 0) {
        this.processingStats.transactionTypes.swaps++;
      } else if (txData.tokenTransfers && txData.tokenTransfers.length > 0) {
        this.processingStats.transactionTypes.transfers++;
      } else {
        this.processingStats.transactionTypes.other++;
      }

      // Базовая обработка
      await this.processWebhookTransaction(txData);
      
      // Обновляем время обработки
      const processingTime = Date.now() - startTime;
      this.processingStats.avgProcessingTime = 
        (this.processingStats.avgProcessingTime + processingTime) / 2;
        
    } catch (error) {
      this.processingStats.errorCount++;
      throw error;
    }
  }

  private async processWebhookTransaction(txData: HeliusWebhookPayload): Promise<void> {
    try {
      await this.checkTokenNameAlerts(txData);

      if (!txData.events?.swap || txData.events.swap.length === 0) {
        return;
      }

      const swapEvents = txData.events.swap;
      
      for (const swapEvent of swapEvents) {
        await this.processSwapEvent(txData, swapEvent);
      }
    } catch (error) {
      this.logger.error(`❌ Error processing transaction ${txData.signature}:`, error as Error);
    }
  }

  private async processSwapEvent(txData: HeliusWebhookPayload, swapEvent: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      const walletAddress = this.extractWalletAddress(swapEvent);
      if (!walletAddress) return;

      // 🔍 ПРОВЕРЯЕМ: SMART MONEY ИЛИ ОБЫЧНЫЙ КОШЕЛЕК
      const smartWallet = await this.smDatabase.getSmartWallet(walletAddress);
      
      if (!smartWallet || !smartWallet.isActive) {
        // ✅ ОБЫЧНЫЙ КОШЕЛЕК - передаем в SolanaMonitor для агрегации
        await this.solanaMonitor.processTransaction(txData);
        this.processingStats.regularTransactions++;
        
        // 🆕 ПРОВЕРЯЕМ НА АГРЕГАЦИЮ ПОЗИЦИЙ
        if (txData.events?.swap && txData.events.swap.length > 0) {
          const swapInfo = await this.extractBasicSwapInfo(txData, swapEvent);
          if (swapInfo && swapInfo.amountUSD >= 5000) { // Минимум $5K для проверки
            const aggregationCheck = await this.solanaMonitor.checkForPositionAggregation(
              walletAddress,
              swapInfo.tokenAddress,
              swapInfo.amountUSD
            );
            
            if (aggregationCheck.isPartOfAggregation) {
              this.processingStats.positionAggregations++;
              
              // Определяем уровень риска
              if (aggregationCheck.suspicionScore >= 85) {
                this.processingStats.riskLevels.high++;
              } else if (aggregationCheck.suspicionScore >= 75) {
                this.processingStats.riskLevels.medium++;
              } else {
                this.processingStats.riskLevels.low++;
              }
            }
          }
        }
        return;
      }

      // ✅ SMART MONEY КОШЕЛЕК - обрабатываем с фильтрами
      const swapInfo = await this.extractSwapInfo(txData, swapEvent, smartWallet);
      if (!swapInfo) return;

      // 🚨 НОВАЯ ВАЛИДАЦИЯ SMART MONEY ТРАНЗАКЦИЙ
      const validationResult = await this.validateSmartMoneyTransaction(
        swapInfo.walletAddress,
        swapInfo.tokenAddress,
        swapInfo.amountUSD,
        swapInfo.swapType
      );

      if (!validationResult.isValid) {
        this.logger.warn(`🚫 BLOCKED Smart Money tx: ${swapInfo.tokenSymbol} - $${swapInfo.amountUSD} | ${validationResult.reason}`);
        this.processingStats.filteredTransactions++;
        
        // Отправляем предупреждение в телеграм о заблокированной транзакции
        if (validationResult.riskScore > 80) {
          await this.telegramNotifier.sendCycleLog(
            `🚫 <b>BLOCKED Suspicious Transaction</b>\n\n` +
            `💰 Amount: <code>$${this.formatNumber(swapInfo.amountUSD)}</code>\n` +
            `🪙 Token: <code>#${swapInfo.tokenSymbol}</code>\n` +
            `👤 Wallet: <code>${swapInfo.walletAddress.slice(0, 8)}...${swapInfo.walletAddress.slice(-4)}</code>\n` +
            `⚠️ Risk Score: <code>${validationResult.riskScore}/100</code>\n` +
            `🚨 Reason: <code>${validationResult.reason}</code>\n` +
            `📝 Factors: <code>${validationResult.suspiciousFactors.join(', ')}</code>\n\n` +
            `<a href="https://solscan.io/token/${swapInfo.tokenAddress}">Token</a> | <a href="https://solscan.io/account/${swapInfo.walletAddress}">Wallet</a>`
          );
          this.processingStats.alertsSent++;
        }
        return;
      }

      // Проверяем стандартные фильтры
      if (!this.shouldProcessSmartMoneySwap(swapInfo, smartWallet)) {
        this.processingStats.filteredTransactions++;
        return;
      }

      await this.saveSmartMoneyTransaction(swapInfo);
      await this.sendSmartMoneyNotification(swapInfo, smartWallet);
      
      this.processingStats.smartMoneyTransactions++;

      this.logger.info(`✅ Smart Money swap processed: ${swapInfo.tokenSymbol} - $${swapInfo.amountUSD.toFixed(0)} (${Date.now() - startTime}ms)`);

    } catch (error) {
      this.logger.error('❌ Error processing swap event:', error as Error);
      this.processingStats.errorCount++;
    }
  }

  // 🆕 НОВЫЙ МЕТОД: ИЗВЛЕЧЕНИЕ БАЗОВОЙ ИНФОРМАЦИИ О СВАПЕ
  private async extractBasicSwapInfo(txData: HeliusWebhookPayload, swapEvent: any): Promise<{
    tokenAddress: string;
    amountUSD: number;
    swapType: 'buy' | 'sell';
  } | null> {
    try {
      let tokenAddress = '';
      let amountUSD = 0;
      let swapType: 'buy' | 'sell' = 'buy';

      if (swapEvent.tokenInputs && swapEvent.tokenOutputs) {
        const tokenInput = swapEvent.tokenInputs[0];
        const tokenOutput = swapEvent.tokenOutputs[0];
        
        const mainTokens = ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
        
        if (mainTokens.includes(tokenInput.mint)) {
          swapType = 'buy';
          tokenAddress = tokenOutput.mint;
          amountUSD = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
        } else {
          swapType = 'sell';
          tokenAddress = tokenInput.mint;
          amountUSD = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
        }
      } else if (swapEvent.nativeInput && swapEvent.tokenOutputs) {
        swapType = 'buy';
        tokenAddress = swapEvent.tokenOutputs[0].mint;
        amountUSD = parseFloat(swapEvent.nativeInput.amount) / 1e9;
      } else if (swapEvent.tokenInputs && swapEvent.nativeOutput) {
        swapType = 'sell';
        tokenAddress = swapEvent.tokenInputs[0].mint;
        amountUSD = parseFloat(swapEvent.nativeOutput.amount) / 1e9;
      }

      if (!tokenAddress || amountUSD === 0) {
        return null;
      }

      return { tokenAddress, amountUSD, swapType };
      
    } catch (error) {
      this.logger.error('Error extracting basic swap info:', error);
      return null;
    }
  }

  // 🆕 МОНИТОРИНГ ПРОИЗВОДИТЕЛЬНОСТИ
  private startPerformanceMonitoring(): void {
    this.performanceInterval = setInterval(() => {
      this.updatePerformanceMetrics();
    }, 60000); // Каждую минуту

    this.logger.info('📊 Performance monitoring started');
  }

  private updatePerformanceMetrics(): void {
    // Обновляем счетчики запросов
    const now = Date.now();
    if (now > this.requestCounters.lastMinuteReset) {
      this.requestCounters.lastMinuteRequests = 0;
      this.requestCounters.lastMinuteErrors = 0;
      this.requestCounters.lastMinuteReset = now + 60000;
    }
  }

  private getPerformanceMetrics(): PerformanceMetrics {
    const memoryUsage = process.memoryUsage();
    const totalCacheSize = this.tokenInfoCache.size + this.topHoldersCache.size + 
                          this.relatedWalletsCache.size + this.recentTxCache.size;
    
    return {
      memoryUsage,
      cpuUsage: process.cpuUsage().user / 1000000, // Примерное значение CPU
      activeConnections: 0, // Можно расширить при необходимости
      requestsPerMinute: this.requestCounters.lastMinuteRequests,
      errorsPerMinute: this.requestCounters.lastMinuteErrors,
      cacheHitRate: totalCacheSize > 0 ? 
        (this.processingStats.totalTransactionsProcessed / totalCacheSize * 100) : 0
    };
  }

  // 🆕 ПЕРИОДИЧЕСКАЯ ОТПРАВКА СТАТИСТИКИ
  private startStatsReporting(): void {
    // Отправляем статистику каждые 6 часов
    setInterval(async () => {
      await this.sendPeriodicStatsReport();
    }, 6 * 60 * 60 * 1000); // 6 часов

    this.logger.info('📈 Stats reporting started: every 6 hours');
  }

  private async sendPeriodicStatsReport(): Promise<void> {
    try {
      const solanaStats = this.solanaMonitor.getAggregationStats();
      const dbStats = await this.database.getPositionAggregationStats();
      const detectionStats = this.solanaMonitor.getDetectionStats();
      
      await this.telegramNotifier.sendCycleLog(
        `📊 <b>Periodic Stats Report</b>\n\n` +
        `🔄 <b>Webhook Processing:</b>\n` +
        `• Total processed: <code>${this.processingStats.totalTransactionsProcessed}</code>\n` +
        `• Smart Money txs: <code>${this.processingStats.smartMoneyTransactions}</code>\n` +
        `• Regular txs: <code>${this.processingStats.regularTransactions}</code>\n` +
        `• Filtered: <code>${this.processingStats.filteredTransactions}</code>\n` +
        `• Errors: <code>${this.processingStats.errorCount}</code>\n\n` +
        `🎯 <b>Position Aggregation:</b>\n` +
        `• Active positions: <code>${solanaStats.activePositions}</code>\n` +
        `• Total detected: <code>${detectionStats.totalDetected}</code>\n` +
        `• Alerts sent: <code>${detectionStats.alertsSent}</code>\n` +
        `• High risk: <code>${this.processingStats.riskLevels.high}</code>\n` +
        `• Cache hit rate: <code>${solanaStats.cacheStats?.cacheHitRate || '0%'}</code>\n\n` +
        `💾 <b>Database:</b>\n` +
        `• Saved aggregations: <code>${dbStats.totalPositions}</code>\n` +
        `• High suspicion: <code>${dbStats.highSuspicionPositions}</code>\n` +
        `• Unprocessed: <code>${dbStats.unprocessedPositions}</code>\n\n` +
        `⚡ <b>Performance:</b>\n` +
        `• Avg processing: <code>${this.processingStats.avgProcessingTime.toFixed(0)}ms</code>\n` +
        `• Requests/min: <code>${this.requestCounters.lastMinuteRequests}</code>\n` +
        `• Memory: <code>${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)}MB</code>`
      );
      
    } catch (error) {
      this.logger.error('Error sending periodic stats report:', error);
    }
  }

  // 🚨 ОСНОВНОЙ МЕТОД ВАЛИДАЦИИ SMART MONEY ТРАНЗАКЦИЙ
  private async validateSmartMoneyTransaction(
    walletAddress: string,
    tokenAddress: string,
    amountUSD: number,
    swapType: 'buy' | 'sell'
  ): Promise<SmartMoneyValidationResult> {
    try {
      const suspiciousFactors: string[] = [];
      let riskScore = 0;

      // 1. 🚨 ПРОВЕРКА НА СОЗДАТЕЛЯ ТОКЕНА
      const creatorCheck = await this.isTokenCreator(walletAddress, tokenAddress);
      
      if (creatorCheck.isCreator) {
        return {
          isValid: false,
          reason: 'Wallet is token creator',
          suspiciousFactors: ['Token creator'],
          riskScore: 100
        };
      }

      // 2. 🚨 ПРОВЕРКА ТОП-ХОЛДЕРА
      if (creatorCheck.isTopHolder && creatorCheck.holdingPercentage > 20) {
        suspiciousFactors.push(`Top holder (${creatorCheck.holdingPercentage.toFixed(1)}%)`);
        riskScore += 40;
      }

      // 3. 🚨 ПРОВЕРКА ВОЗРАСТА ТОКЕНА
      if (creatorCheck.tokenAge < 1) {
        suspiciousFactors.push(`Very new token (${creatorCheck.tokenAge.toFixed(1)}h old)`);
        riskScore += 30;
      } else if (creatorCheck.tokenAge < 6) {
        suspiciousFactors.push(`New token (${creatorCheck.tokenAge.toFixed(1)}h old)`);
        riskScore += 15;
      }

      // 4. 🚨 ПРОВЕРКА КРУПНЫХ СДЕЛОК НА НОВЫХ ТОКЕНАХ
      if (creatorCheck.tokenAge < 24 && amountUSD > 1000000) { // $1M+ в первые 24 часа
        suspiciousFactors.push(`Large tx on new token ($${(amountUSD/1000000).toFixed(1)}M)`);
        riskScore += 35;
      }

      // 5. 🚨 ПРОВЕРКА СВЯЗАННЫХ КОШЕЛЬКОВ
      const relatedWallets = await this.findRelatedWallets(walletAddress, tokenAddress);
      if (relatedWallets.length > 2) {
        suspiciousFactors.push(`${relatedWallets.length} related wallets`);
        riskScore += 25;
      }

      // 6. 🚨 ПРОВЕРКА ПАТТЕРНА "PUMP AND DUMP"
      if (swapType === 'sell' && creatorCheck.tokenAge < 48 && amountUSD > 100000) {
        suspiciousFactors.push(`Early large sell ($${(amountUSD/1000).toFixed(0)}K)`);
        riskScore += 20;
      }

      // 7. 🚨 ПРОВЕРКА НА "FAKE VOLUME"
      if (creatorCheck.isTopHolder && creatorCheck.holdingPercentage > 50 && swapType === 'buy') {
        suspiciousFactors.push(`Majority holder buying more (${creatorCheck.holdingPercentage.toFixed(1)}%)`);
        riskScore += 30;
      }

      // ФИНАЛЬНОЕ РЕШЕНИЕ
      const shouldBlock = riskScore >= 70 || 
                         (creatorCheck.holdingPercentage > 30 && creatorCheck.tokenAge < 12) ||
                         (relatedWallets.length > 3 && creatorCheck.tokenAge < 24);

      return {
        isValid: !shouldBlock,
        reason: shouldBlock ? `High risk score: ${riskScore}/100 - ${suspiciousFactors.join(', ')}` : undefined,
        suspiciousFactors,
        riskScore
      };

    } catch (error) {
      this.logger.error('Error validating Smart Money transaction:', error);
      // В случае ошибки пропускаем транзакцию (лучше перестраховаться)
      return {
        isValid: true,
        suspiciousFactors: [],
        riskScore: 0
      };
    }
  }

  // 🚨 ПРОВЕРКА НА СОЗДАТЕЛЯ ТОКЕНА
  private async isTokenCreator(walletAddress: string, tokenAddress: string): Promise<TokenCreatorCheck> {
    try {
      // Получаем информацию о токене с кешированием
      const tokenInfo = await this.getTokenInfoExtended(tokenAddress);
      
      const tokenAge = tokenInfo.createdAt ? 
        (Date.now() - tokenInfo.createdAt.getTime()) / (1000 * 60 * 60) : 168; // Если неизвестно - считаем неделю

      // Проверяем создателя
      if (tokenInfo.creator === walletAddress) {
        return {
          isCreator: true,
          isTopHolder: true,
          holdingPercentage: 100,
          creationTime: tokenInfo.createdAt || new Date(),
          firstTxTime: tokenInfo.createdAt || new Date(),
          tokenAge
        };
      }

      // Получаем топ холдеров для новых токенов (< 48 часов)
      if (tokenAge < 48) {
        const topHolders = await this.getTopHolders(tokenAddress);
        const holderInfo = topHolders.find(h => h.address === walletAddress);
        
        if (holderInfo) {
          const isTopHolder = holderInfo.rank <= 5; // Топ-5
          
          return {
            isCreator: false,
            isTopHolder,
            holdingPercentage: holderInfo.percentage,
            creationTime: tokenInfo.createdAt || new Date(),
            firstTxTime: new Date(), // Приблизительно
            tokenAge
          };
        }
      }

      return {
        isCreator: false,
        isTopHolder: false,
        holdingPercentage: 0,
        creationTime: tokenInfo.createdAt || new Date(),
        firstTxTime: new Date(),
        tokenAge
      };
      
    } catch (error) {
      this.logger.error('Error checking token creator:', error);
      return {
        isCreator: false,
        isTopHolder: false,
        holdingPercentage: 0,
        creationTime: new Date(),
        firstTxTime: new Date(),
        tokenAge: 168 // Неделя по умолчанию
      };
    }
  }

  // 🚨 ПОЛУЧЕНИЕ РАСШИРЕННОЙ ИНФОРМАЦИИ О ТОКЕНЕ
  private async getTokenInfoExtended(tokenAddress: string): Promise<{
    symbol: string;
    name: string;
    creator?: string;
    createdAt?: Date;
  }> {
    // Проверяем кеш
    const cached = this.tokenInfoCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // 24 часа
      return {
        symbol: cached.symbol,
        name: cached.name,
        creator: cached.creator,
        createdAt: cached.createdAt
      };
    }

    try {
      // Запрос к Helius для получения расширенных метаданных
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAccounts: [tokenAddress] })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
          const metadata = data[0];
          
          // Пытаемся получить информацию о создателе через дополнительный запрос
          let creator: string | undefined;
          let createdAt: Date | undefined;

          try {
            const mintResponse = await fetch(process.env.QUICKNODE_HTTP_URL!, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAccountInfo',
                params: [tokenAddress, { encoding: 'jsonParsed' }]
              })
            });

            if (mintResponse.ok) {
              const mintData = await mintResponse.json() as any;
              // Извлекаем информацию о mint authority (создателе)
              creator = mintData.result?.value?.data?.parsed?.info?.mintAuthority;
            }
          } catch (mintError) {
            // Игнорируем ошибки получения mint info
          }

          const tokenInfo = {
            symbol: metadata.onChainMetadata?.metadata?.symbol || 'UNKNOWN',
            name: metadata.onChainMetadata?.metadata?.name || 'Unknown Token',
            creator,
            createdAt,
            timestamp: Date.now()
          };
          
          this.tokenInfoCache.set(tokenAddress, tokenInfo);
          return {
            symbol: tokenInfo.symbol,
            name: tokenInfo.name,
            creator: tokenInfo.creator,
            createdAt: tokenInfo.createdAt
          };
        }
      }
    } catch (error) {
      this.logger.error(`Error getting extended token info for ${tokenAddress}:`, error);
    }

    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  }

  // 🚨 ПОЛУЧЕНИЕ ТОП ХОЛДЕРОВ
  private async getTopHolders(tokenAddress: string): Promise<Array<{
    address: string;
    percentage: number;
    rank: number;
  }>> {
    // Проверяем кеш (30 минут)
    const cached = this.topHoldersCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return cached.holders;
    }

    try {
      // Запрос к Helius для получения топ держателей
      const response = await fetch(`https://api.helius.xyz/v0/tokens/${tokenAddress}/holders?api-key=${process.env.HELIUS_API_KEY}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data)) {
          const holders = data.slice(0, 10).map((holder: any, index: number) => ({
            address: holder.address,
            percentage: holder.percentage || 0,
            rank: index + 1
          }));
          
          // Кешируем результат
          this.topHoldersCache.set(tokenAddress, {
            holders,
            timestamp: Date.now()
          });
          
          return holders;
        }
      }
    } catch (error) {
      this.logger.error(`Error getting top holders for ${tokenAddress}:`, error);
    }

    return [];
  }

  // 🚨 ПОИСК СВЯЗАННЫХ КОШЕЛЬКОВ
  private async findRelatedWallets(walletAddress: string, tokenAddress: string): Promise<string[]> {
    // Проверяем кеш (1 час)
    const cacheKey = `${walletAddress}-${tokenAddress}`;
    const cached = this.relatedWalletsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) {
      return cached.relatedWallets;
    }

    try {
      // Получаем недавние транзакции по токену
      const recentTxs = await this.getRecentTokenTransactions(tokenAddress, 50);
      
      // Анализируем временные паттерны
      const walletTimings = new Map<string, Date[]>();
      
      for (const tx of recentTxs) {
        if (!walletTimings.has(tx.walletAddress)) {
          walletTimings.set(tx.walletAddress, []);
        }
        walletTimings.get(tx.walletAddress)!.push(tx.timestamp);
      }
      
      const targetTimings = walletTimings.get(walletAddress) || [];
      const relatedWallets: string[] = [];
      
      // Ищем кошельки с синхронными транзакциями (в течение 10 минут)
      for (const [address, timings] of walletTimings) {
        if (address === walletAddress) continue;
        
        let coincidences = 0;
        for (const targetTime of targetTimings) {
          for (const timing of timings) {
            const diffMinutes = Math.abs(targetTime.getTime() - timing.getTime()) / (1000 * 60);
            if (diffMinutes < 10) { // 10 минут окно
              coincidences++;
            }
          }
        }
        
        // Если >30% транзакций совпадают по времени - подозрительно
        if (targetTimings.length > 0 && coincidences / targetTimings.length > 0.3) {
          relatedWallets.push(address);
        }
      }
      
      // Кешируем результат
      this.relatedWalletsCache.set(cacheKey, {
        relatedWallets,
        timestamp: Date.now()
      });
      
      return relatedWallets;
      
    } catch (error) {
      this.logger.error('Error finding related wallets:', error);
      return [];
    }
  }

  // 🚀 ОПТИМИЗИРОВАННОЕ ПОЛУЧЕНИЕ RECENT TOKEN TRANSACTIONS С КЕШИРОВАНИЕМ
  private async getRecentTokenTransactions(tokenAddress: string, limit: number = 50): Promise<Array<{
    walletAddress: string;
    timestamp: Date;
    amountUSD: number;
    swapType: 'buy' | 'sell';
  }>> {
    try {
      // 🔥 ПРОВЕРЯЕМ КЕШ (5 МИНУТ TTL для активного трейдинга)
      const cached = this.recentTxCache.get(tokenAddress);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        this.logger.debug(`📦 Cache HIT for token transactions: ${tokenAddress}`);
        return cached.transactions;
      }

      // 🔍 ЗАПРОС К БД ТОЛЬКО ЕСЛИ НЕТ В КЕШЕ
      this.logger.debug(`💽 Cache MISS - querying DB for token: ${tokenAddress}`);
      const transactions = await this.database.getTransactionsByTokenAddress(tokenAddress, limit);
      
      const result = transactions.map(tx => ({
        walletAddress: tx.walletAddress,
        timestamp: tx.timestamp,
        amountUSD: tx.amountUSD,
        swapType: tx.swapType || 'buy' as 'buy' | 'sell'
      }));
      
      // 💾 КЕШИРУЕМ РЕЗУЛЬТАТ
      this.recentTxCache.set(tokenAddress, {
        transactions: result,
        timestamp: Date.now()
      });
      
      this.logger.debug(`💾 Cached ${result.length} transactions for token: ${tokenAddress}`);
      return result;
      
    } catch (error) {
      this.logger.error(`Error getting recent transactions for token ${tokenAddress}:`, error);
      return [];
    }
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ (без изменений)
  
  private extractWalletAddress(swapEvent: any): string | null {
    if (swapEvent.nativeInput?.account) {
      return swapEvent.nativeInput.account;
    }
    
    if (swapEvent.tokenInputs && swapEvent.tokenInputs.length > 0) {
      return swapEvent.tokenInputs[0].userAccount;
    }
    
    if (swapEvent.tokenOutputs && swapEvent.tokenOutputs.length > 0) {
      return swapEvent.tokenOutputs[0].userAccount;
    }
    
    return null;
  }

  private async extractSwapInfo(txData: HeliusWebhookPayload, swapEvent: any, smartWallet: SmartMoneyWallet): Promise<SmartMoneySwap | null> {
    try {
      let tokenAddress = '';
      let tokenAmount = 0;
      let amountUSD = 0;
      let swapType: 'buy' | 'sell' = 'buy';

      if (swapEvent.tokenInputs && swapEvent.tokenOutputs) {
        const tokenInput = swapEvent.tokenInputs[0];
        const tokenOutput = swapEvent.tokenOutputs[0];
        
        const mainTokens = ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
        
        if (mainTokens.includes(tokenInput.mint)) {
          swapType = 'buy';
          tokenAddress = tokenOutput.mint;
          tokenAmount = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
          amountUSD = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
        } else {
          swapType = 'sell';
          tokenAddress = tokenInput.mint;
          tokenAmount = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
          amountUSD = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
        }
      } else if (swapEvent.nativeInput && swapEvent.tokenOutputs) {
        swapType = 'buy';
        const tokenOutput = swapEvent.tokenOutputs[0];
        tokenAddress = tokenOutput.mint;
        tokenAmount = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
        amountUSD = parseFloat(swapEvent.nativeInput.amount) / 1e9;
      } else if (swapEvent.tokenInputs && swapEvent.nativeOutput) {
        swapType = 'sell';
        const tokenInput = swapEvent.tokenInputs[0];
        tokenAddress = tokenInput.mint;
        tokenAmount = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
        amountUSD = parseFloat(swapEvent.nativeOutput.amount) / 1e9;
      }

      if (!tokenAddress || amountUSD === 0) {
        return null;
      }

      const tokenInfo = await this.getTokenInfo(tokenAddress);
      
      return {
        transactionId: txData.signature,
        walletAddress: smartWallet.address,
        tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        tokenName: tokenInfo.name,
        tokenAmount,
        amountUSD,
        swapType,
        timestamp: new Date(txData.timestamp * 1000),
        category: smartWallet.category,
        winRate: smartWallet.winRate,
        pnl: smartWallet.totalPnL,
        totalTrades: smartWallet.totalTrades,
        isFamilyMember: false,
        familySize: 0,
        familyId: undefined
      };
    } catch (error) {
      this.logger.error('Error extracting swap info:', error as Error);
      return null;
    }
  }

  private shouldProcessSmartMoneySwap(swapInfo: SmartMoneySwap, smartWallet: SmartMoneyWallet): boolean {
    const minAmounts: Record<string, number> = {
      sniper: 5000,
      hunter: 5000,
      trader: 20000
    };

    const minAmount = minAmounts[smartWallet.category] || 5000;
    
    if (swapInfo.amountUSD < minAmount) {
      return false;
    }

    const daysSinceActive = (Date.now() - smartWallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 45) {
      return false;
    }

    if (smartWallet.winRate < 60) {
      return false;
    }

    return true;
  }

  private async saveSmartMoneyTransaction(swapInfo: SmartMoneySwap): Promise<void> {
    try {
      if (!this.smDatabase || !this.telegramNotifier) return;

      const stmt = this.smDatabase['db'].prepare(`
        INSERT OR REPLACE INTO smart_money_transactions (
          transaction_id, wallet_address, token_address, token_symbol, token_name,
          amount, amount_usd, swap_type, timestamp, dex,
          wallet_category, is_family_member, family_id,
          wallet_pnl, wallet_win_rate, wallet_total_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        swapInfo.transactionId, swapInfo.walletAddress, swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.tokenName,
        swapInfo.tokenAmount, swapInfo.amountUSD, swapInfo.swapType, swapInfo.timestamp.toISOString(), 'Filtered-Webhook',
        swapInfo.category, 0, null, swapInfo.pnl, swapInfo.winRate, swapInfo.totalTrades
      );

      const tokenSwap: TokenSwap = {
        transactionId: swapInfo.transactionId,
        walletAddress: swapInfo.walletAddress,
        tokenAddress: swapInfo.tokenAddress,
        tokenSymbol: swapInfo.tokenSymbol,
        tokenName: swapInfo.tokenName,
        amount: swapInfo.tokenAmount,
        amountUSD: swapInfo.amountUSD,
        timestamp: swapInfo.timestamp,
        dex: 'Smart Money Filtered',
        isNewWallet: false,
        isReactivatedWallet: false,
        walletAge: 0,
        daysSinceLastActivity: 0,
        price: swapInfo.amountUSD / swapInfo.tokenAmount,
        pnl: swapInfo.pnl,
        swapType: swapInfo.swapType
      };

      await this.database.saveTransaction(tokenSwap);

    } catch (error) {
      this.logger.error('Error saving Smart Money transaction:', error as Error);
    }
  }

  private async sendSmartMoneyNotification(swapInfo: SmartMoneySwap, smartWallet: SmartMoneyWallet): Promise<void> {
    try {
      await this.telegramNotifier.sendSmartMoneySwap(swapInfo);
      this.processingStats.alertsSent++;
    } catch (error) {
      this.logger.error('Error sending Smart Money notification:', error as Error);
    }
  }

  private async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; name: string }> {
    const cached = this.tokenInfoCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return { symbol: cached.symbol, name: cached.name };
    }

    try {
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAccounts: [tokenAddress] })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
          const tokenInfo = {
            symbol: data[0].onChainMetadata?.metadata?.symbol || 'UNKNOWN',
            name: data[0].onChainMetadata?.metadata?.name || 'Unknown Token',
            timestamp: Date.now()
          };
          
          this.tokenInfoCache.set(tokenAddress, tokenInfo);
          return { symbol: tokenInfo.symbol, name: tokenInfo.name };
        }
      }
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenAddress}:`, error);
    }

    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  }

  private async checkTokenNameAlerts(txData: HeliusWebhookPayload): Promise<void> {
    try {
      const tokenAddresses = new Set<string>();
      
      if (txData.tokenTransfers) {
        for (const transfer of txData.tokenTransfers) {
          tokenAddresses.add(transfer.mint);
        }
      }

      for (const tokenAddress of tokenAddresses) {
        await this.analyzeTokenForNameAlert(tokenAddress);
      }

    } catch (error) {
      this.logger.error('Error checking token name alerts:', error as Error);
    }
  }

  private async analyzeTokenForNameAlert(tokenAddress: string): Promise<void> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      if (!tokenInfo.name || tokenInfo.name === 'Unknown Token') {
        return;
      }

      const holdersCount = await this.getTokenHoldersCount(tokenAddress);
      
      const alertData = await this.database.checkTokenNamePattern(
        tokenInfo.name,
        tokenAddress,
        holdersCount
      );

      if (alertData.shouldAlert) {
        await this.telegramNotifier.sendTokenNameAlert({
          tokenName: tokenInfo.name,
          contractAddress: alertData.tokenAddress!,
          holders: alertData.holders!,
          similarTokens: alertData.similarCount!
        });

        this.logger.info(`🚨 Token Name Alert sent: ${tokenInfo.name} (${alertData.similarCount} similar tokens)`);
      }

    } catch (error) {
      this.logger.error(`Error analyzing token ${tokenAddress} for name alert:`, error as Error);
    }
  }

  private async getTokenHoldersCount(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/balances?api-key=${process.env.HELIUS_API_KEY}`);
      
      if (!response.ok) {
        return 0;
      }

      const data = await response.json() as any;
      return Array.isArray(data.tokens) ? data.tokens.length : 0;

    } catch (error) {
      this.logger.error(`Error getting holders count for ${tokenAddress}:`, error as Error);
      return 0;
    }
  }

  // 🧹 АВТООЧИСТКА КЕШЕЙ ОТ УСТАРЕВШИХ ЗАПИСЕЙ
  private startCacheCleanup(): void {
    // Очищаем кеши каждые 30 минут
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupExpiredCaches();
    }, 30 * 60 * 1000); // 30 минут

    this.logger.info('🧹 Cache cleanup started: every 30 minutes');
  }

  private cleanupExpiredCaches(): void {
    const now = Date.now();
    let totalCleaned = 0;

    // 🧹 Очистка Token Info Cache (24 часа TTL)
    const tokenInfoExpired = [];
    for (const [key, value] of this.tokenInfoCache) {
      if (now - value.timestamp > 24 * 60 * 60 * 1000) {
        tokenInfoExpired.push(key);
      }
    }
    tokenInfoExpired.forEach(key => this.tokenInfoCache.delete(key));

    // 🧹 Очистка Top Holders Cache (30 минут TTL)
    const holdersExpired = [];
    for (const [key, value] of this.topHoldersCache) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        holdersExpired.push(key);
      }
    }
    holdersExpired.forEach(key => this.topHoldersCache.delete(key));

    // 🧹 Очистка Related Wallets Cache (1 час TTL)
    const walletExpired = [];
    for (const [key, value] of this.relatedWalletsCache) {
      if (now - value.timestamp > 60 * 60 * 1000) {
        walletExpired.push(key);
      }
    }
    walletExpired.forEach(key => this.relatedWalletsCache.delete(key));

    // 🧹 Очистка Recent TX Cache (5 минут TTL)
    const txExpired = [];
    for (const [key, value] of this.recentTxCache) {
      if (now - value.timestamp > 5 * 60 * 1000) {
        txExpired.push(key);
      }
    }
    txExpired.forEach(key => this.recentTxCache.delete(key));

    totalCleaned = tokenInfoExpired.length + holdersExpired.length + walletExpired.length + txExpired.length;

    if (totalCleaned > 0) {
      this.logger.info(`🧹 Cache cleanup completed: removed ${totalCleaned} expired entries`);
      this.logger.debug(`  - Token info: ${tokenInfoExpired.length}`);
      this.logger.debug(`  - Top holders: ${holdersExpired.length}`);
      this.logger.debug(`  - Related wallets: ${walletExpired.length}`);
      this.logger.debug(`  - Recent TX: ${txExpired.length}`);
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
          this.logger.info(`🌐 Background Worker webhook server started on port ${this.port} (WITH SMART MONEY FILTERS + POSITION AGGREGATION + SOLANA MONITOR INTEGRATION)`);
          this.logger.info(`📡 Webhook endpoint ready: http://localhost:${this.port}/webhook`);
          this.logger.info(`💊 Health check: http://localhost:${this.port}/health`);
          this.logger.info(`🚨 Smart Money filters: ENABLED`);
          this.logger.info(`🎯 Position aggregation: ENABLED`);
          this.logger.info(`🔗 Solana Monitor integration: ENABLED`);
          resolve();
        });

        this.server.on('error', (error: any) => {
          this.logger.error('❌ Webhook server error:', error);
          reject(error);
        });

      } catch (error) {
        this.logger.error('❌ Failed to start webhook server:', error as Error);
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    // 🧹 Останавливаем автоочистку кешей
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
      this.logger.info('🧹 Cache cleanup stopped');
    }

    // 🆕 Останавливаем мониторинг производительности
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = null;
      this.logger.info('📊 Performance monitoring stopped');
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('🔴 Webhook server stopped');
          resolve();
        });
      });
    }
  }

  getServerStats() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      port: this.port,
      environment: process.env.NODE_ENV || 'development',
      filters: {
        enabled: true,
        tokenInfoCache: this.tokenInfoCache.size,
        holdersCache: this.topHoldersCache.size,
        relatedWalletsCache: this.relatedWalletsCache.size,
        positionAggregation: 'enabled',
        solanaMonitorIntegration: 'enabled' // 🆕 НОВАЯ ФИЧА
      },
      // 🆕 РАСШИРЕННАЯ СТАТИСТИКА
      processing: this.processingStats,
      performance: this.getPerformanceMetrics()
    };
  }
}