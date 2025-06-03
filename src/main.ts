// src/main.ts - ОБНОВЛЕННАЯ ВЕРСИЯ для Worker Service с Smart Money Flow Analysis
import * as dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Database } from './services/Database';
import { SmartMoneyDatabase } from './services/SmartMoneyDatabase';
import { SmartMoneyFlowAnalyzer } from './services/SmartMoneyFlowAnalyzer';
import { SmartWalletDiscovery } from './services/SmartWalletDiscovery';
import { FamilyWalletDetector } from './services/FamilyWalletDetector';
import { WebhookServer } from './services/WebhookServer';
import { HeliusWebhookManager } from './services/HeliusWebhookManager';
import { Logger } from './utils/Logger';

// Load environment variables
dotenv.config();

class SmartMoneyBotRunner {
  private solanaMonitor: SolanaMonitor;
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private flowAnalyzer: SmartMoneyFlowAnalyzer;
  private walletDiscovery: SmartWalletDiscovery;
  private familyDetector: FamilyWalletDetector;
  private webhookServer: WebhookServer;
  private webhookManager: HeliusWebhookManager;
  private logger: Logger;
  
  private isRunning: boolean = false;
  private webhookId: string | null = null;
  private intervalIds: NodeJS.Timeout[] = [];

  constructor() {
    this.logger = Logger.getInstance();
    
    // Validate required environment variables
    this.validateEnvironment();

    // Initialize services
    this.database = new Database();
    this.smDatabase = new SmartMoneyDatabase();
    
    this.telegramNotifier = new TelegramNotifier(
      process.env.TELEGRAM_BOT_TOKEN!,
      process.env.TELEGRAM_USER_ID!
    );

    this.solanaMonitor = new SolanaMonitor(this.database, this.telegramNotifier);
    this.flowAnalyzer = new SmartMoneyFlowAnalyzer(this.smDatabase, this.telegramNotifier);
    this.walletDiscovery = new SmartWalletDiscovery(this.smDatabase, this.database);
    this.familyDetector = new FamilyWalletDetector(this.smDatabase, this.database);
    
    this.webhookServer = new WebhookServer(
      this.database, 
      this.telegramNotifier, 
      this.solanaMonitor,
      this.smDatabase // Добавляем SmartMoneyDatabase для real-time обработки
    );
    
    this.webhookManager = new HeliusWebhookManager();

    this.logger.info('✅ Smart Money Bot services initialized successfully');
  }

  private validateEnvironment(): void {
    const requiredVars = [
      'HELIUS_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_USER_ID'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    this.logger.info('✅ Environment variables validated');
  }

  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting Advanced Smart Money Bot System...');

      // Initialize databases
      await this.database.init();
      await this.smDatabase.init();
      this.logger.info('✅ Databases initialized');

      // Set running flag
      this.isRunning = true;

      // Start webhook server for real-time monitoring
      await this.webhookServer.start();
      this.logger.info('✅ Webhook server started');

      // Create Helius webhook for DEX monitoring
      await this.setupHeliusWebhook();

      // Send startup notification
      await this.sendStartupNotification();

      // Start periodic Smart Money analysis
      this.startPeriodicAnalysis();

      // Start periodic wallet discovery (every 2 weeks)
      this.startWalletDiscovery();

      // Start family wallet detection (daily)
      this.startFamilyDetection();

      this.logger.info('✅ Smart Money Bot started successfully!');
      this.logger.info('📊 Real-time DEX monitoring active');
      this.logger.info('🔍 Smart Money flow analysis running');
      this.logger.info('🎯 Advanced insider detection enabled');

      // Keep the process alive
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      this.logger.error('💥 Failed to start Smart Money Bot:', error);
      process.exit(1);
    }
  }

  private async setupHeliusWebhook(): Promise<void> {
    try {
      let webhookURL: string;
      
      if (process.env.NODE_ENV === 'production') {
        const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com';
        webhookURL = `${renderUrl}/webhook`;
      } else {
        webhookURL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
      }

      const webhookConfig = {
        webhookURL,
        transactionTypes: ['SWAP'],
        accountAddresses: HeliusWebhookManager.getDEXProgramAddresses(),
        webhookType: 'enhanced' as const,
      };

      this.webhookId = await this.webhookManager.createDEXMonitoringWebhook(webhookConfig);
      
      this.logger.info('🎯 Smart Money DEX monitoring webhook created');
      this.logger.info(`📡 Webhook URL: ${webhookURL}`);
    } catch (error) {
      this.logger.error('❌ Failed to setup Helius webhook:', error);
      throw error;
    }
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const stats = await this.smDatabase.getWalletStats();
      
      await this.telegramNotifier.sendCycleLog(
        `🟢 <b>Advanced Smart Money Bot Online!</b>\n\n` +
        `📊 Monitoring <code>${stats.active}</code> Smart Money wallets\n` +
        `🔫 Snipers: <code>${stats.byCategory.sniper || 0}</code>\n` +
        `💡 Hunters: <code>${stats.byCategory.hunter || 0}</code>\n` +
        `🐳 Traders: <code>${stats.byCategory.trader || 0}</code>\n` +
        `👥 Family Members: <code>${stats.familyMembers}</code>\n\n` +
        `🎯 Real-time DEX monitoring: <b>ACTIVE</b>\n` +
        `📈 Flow analysis: <b>Every hour</b>\n` +
        `🔥 Hot token detection: <b>Every 60min</b>\n` +
        `🔍 Wallet discovery: <b>Every 2 weeks</b>`
      );
    } catch (error) {
      this.logger.error('Failed to send startup notification:', error);
    }
  }

  private startPeriodicAnalysis(): void {
    // Анализ потоков каждый час
    const runFlowAnalysis = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🔍 Starting hourly Smart Money flow analysis...');
        
        const flowResult = await this.flowAnalyzer.analyzeSmartMoneyFlows();
        
        // Отправляем уведомления
        await this.flowAnalyzer.sendFlowAnalysisNotifications(flowResult);
        
        // Отправляем сводки по притокам/оттокам
        if (flowResult.inflows.length > 0) {
          const hourlyInflows = flowResult.inflows.filter(f => f.period === '1h');
          const dailyInflows = flowResult.inflows.filter(f => f.period === '24h');
          
          if (hourlyInflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('inflow', '1h', hourlyInflows);
          }
          
          if (dailyInflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('inflow', '24h', dailyInflows);
          }
        }
        
        if (flowResult.outflows.length > 0) {
          const hourlyOutflows = flowResult.outflows.filter(f => f.period === '1h');
          const dailyOutflows = flowResult.outflows.filter(f => f.period === '24h');
          
          if (hourlyOutflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('outflow', '1h', hourlyOutflows);
          }
          
          if (dailyOutflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('outflow', '24h', dailyOutflows);
          }
        }
        
        // Hot New Tokens разные сортировки
        if (flowResult.hotNewTokens.length > 0) {
          await this.telegramNotifier.sendHotNewTokensByWallets(flowResult.hotNewTokens);
          await this.telegramNotifier.sendHotNewTokensByAge(flowResult.hotNewTokens);
          await this.telegramNotifier.sendHotNewTokensByFDV(flowResult.hotNewTokens);
        }
        
        this.logger.info('✅ Hourly Smart Money flow analysis completed');
      } catch (error) {
        this.logger.error('❌ Error in hourly flow analysis:', error);
      }
    };

    // Запускаем анализ сразу и потом каждый час
    runFlowAnalysis();
    const flowInterval = setInterval(runFlowAnalysis, 60 * 60 * 1000); // каждый час
    this.intervalIds.push(flowInterval);

    this.logger.info('🔄 Periodic Smart Money flow analysis started');
  }

  private startWalletDiscovery(): void {
    const runWalletDiscovery = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🔍 Starting wallet discovery process...');
        
        const discoveryResults = await this.walletDiscovery.discoverSmartWallets();
        
        let newWallets = 0;
        let updatedWallets = 0;
        
        // Обрабатываем результаты
        for (const result of discoveryResults) {
          if (result.isSmartMoney && result.category) {
            const existingWallet = await this.smDatabase.getSmartWallet(result.address);
            
            const smartWallet = {
              address: result.address,
              category: result.category,
              winRate: result.metrics.winRate,
              totalPnL: result.metrics.totalPnL,
              totalTrades: result.metrics.totalTrades,
              avgTradeSize: result.metrics.avgTradeSize,
              maxTradeSize: result.metrics.maxTradeSize,
              minTradeSize: result.metrics.minTradeSize,
              sharpeRatio: result.metrics.sharpeRatio,
              maxDrawdown: result.metrics.maxDrawdown,
              lastActiveAt: result.metrics.recentActivity,
              performanceScore: this.calculatePerformanceScore(result.metrics),
              isActive: true,
              isFamilyMember: result.familyConnections.length > 0,
              familyAddresses: result.familyConnections,
              earlyEntryRate: result.metrics.earlyEntryRate,
              avgHoldTime: result.metrics.avgHoldTime
            };
            
            await this.smDatabase.saveSmartWallet(smartWallet);
            
            if (!existingWallet) {
              newWallets++;
            } else {
              updatedWallets++;
            }
          }
        }
        
        // Деактивируем неэффективные кошельки
        const deactivated = await this.deactivateIneffectiveWallets();
        
        // Отправляем статистику обновления
        const stats = await this.smDatabase.getWalletStats();
        await this.telegramNotifier.sendWalletDatabaseStats({
          ...stats,
          newlyAdded: newWallets,
          deactivated
        });
        
        this.logger.info(`✅ Wallet discovery completed: ${newWallets} new, ${updatedWallets} updated, ${deactivated} deactivated`);
      } catch (error) {
        this.logger.error('❌ Error in wallet discovery:', error);
      }
    };

    // Запускаем discovery через час после старта, потом каждые 2 недели
    setTimeout(() => {
      runWalletDiscovery();
      const discoveryInterval = setInterval(runWalletDiscovery, 14 * 24 * 60 * 60 * 1000); // каждые 2 недели
      this.intervalIds.push(discoveryInterval);
    }, 60 * 60 * 1000); // через час после старта

    this.logger.info('🔄 Periodic wallet discovery scheduled');
  }

  private startFamilyDetection(): void {
    const runFamilyDetection = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🕵 Starting family wallet detection...');
        
        const familyClusters = await this.familyDetector.detectFamilyWallets();
        
        // Отправляем уведомления о новых семейных кластерах
        for (const cluster of familyClusters) {
          await this.telegramNotifier.sendFamilyWalletAlert({
            id: cluster.id,
            wallets: cluster.wallets,
            suspicionScore: cluster.suspicionScore,
            detectionMethod: cluster.detectionMethods.join(', '),
            totalPnL: cluster.totalPnL,
            coordinationScore: cluster.coordinationScore
          });
          
          // Пауза между уведомлениями
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        this.logger.info(`✅ Family detection completed: ${familyClusters.length} clusters found`);
      } catch (error) {
        this.logger.error('❌ Error in family detection:', error);
      }
    };

    // Запускаем через 2 часа после старта, потом каждый день
    setTimeout(() => {
      runFamilyDetection();
      const familyInterval = setInterval(runFamilyDetection, 24 * 60 * 60 * 1000); // каждый день
      this.intervalIds.push(familyInterval);
    }, 2 * 60 * 60 * 1000); // через 2 часа после старта

    this.logger.info('🔄 Periodic family detection scheduled');
  }

  private async deactivateIneffectiveWallets(): Promise<number> {
    const activeWallets = await this.smDatabase.getAllActiveSmartWallets();
    let deactivatedCount = 0;
    
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    
    for (const wallet of activeWallets) {
      let shouldDeactivate = false;
      let reason = '';
      
      // Проверяем критерии деактивации
      if (wallet.winRate < 55) {
        shouldDeactivate = true;
        reason = `Win rate dropped to ${wallet.winRate.toFixed(1)}%`;
      } else if (wallet.lastActiveAt < sixtyDaysAgo) {
        shouldDeactivate = true;
        const daysInactive = Math.floor((Date.now() - wallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24));
        reason = `Inactive for ${daysInactive} days`;
      } else if (wallet.totalPnL < -10000) {
        shouldDeactivate = true;
        reason = `Total PnL became negative: ${wallet.totalPnL.toFixed(0)}`;
      } else if (wallet.avgTradeSize < 1000) {
        shouldDeactivate = true;
        reason = `Average trade size too small: ${wallet.avgTradeSize.toFixed(0)}`;
      }
      
      if (shouldDeactivate) {
        await this.smDatabase.deactivateWallet(wallet.address, reason);
        deactivatedCount++;
      }
    }
    
    return deactivatedCount;
  }

  private calculatePerformanceScore(metrics: any): number {
    let score = 0;
    
    // Win rate (0-30 points)
    score += Math.min(metrics.winRate * 0.5, 30);
    
    // PnL normalized (0-25 points)
    score += Math.min(Math.log10(Math.max(metrics.totalPnL, 1)) * 5, 25);
    
    // Trade count (0-15 points)
    score += Math.min(metrics.totalTrades * 0.3, 15);
    
    // Average trade size (0-15 points)
    score += Math.min(Math.log10(Math.max(metrics.avgTradeSize, 1)) * 3, 15);
    
    // Sharpe ratio (0-15 points)
    score += Math.min(metrics.sharpeRatio * 7.5, 15);
    
    return Math.min(score, 100);
  }

  private async shutdown(): Promise<void> {
    this.logger.info('🔴 Shutting down Smart Money Bot...');
    
    this.isRunning = false;
    
    // Останавливаем все интервалы
    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId);
    }
    
    // Закрываем webhook server
    if (this.webhookServer) {
      await this.webhookServer.stop();
    }
    
    // Удаляем Helius webhook
    if (this.webhookId) {
      try {
        await this.webhookManager.deleteWebhook(this.webhookId);
        this.logger.info('✅ Helius webhook deleted');
      } catch (error) {
        this.logger.error('❌ Error deleting webhook:', error);
      }
    }
    
    // Закрываем базы данных
    if (this.database) {
      await this.database.close();
    }
    
    if (this.smDatabase) {
      await this.smDatabase.close();
    }
    
    // Отправляем уведомление об остановке
    try {
      await this.telegramNotifier.sendCycleLog('🔴 <b>Smart Money Bot stopped</b>');
    } catch (error) {
      this.logger.error('Failed to send shutdown notification:', error);
    }
    
    this.logger.info('✅ Smart Money Bot shutdown completed');
    process.exit(0);
  }
}

// Запуск бота
const main = async () => {
  try {
    const bot = new SmartMoneyBotRunner();
    await bot.start();
  } catch (error) {
    console.error('💥 Fatal error starting Smart Money Bot:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
main();