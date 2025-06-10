// src/main.ts - ОБНОВЛЕНО с отключенным FamilyWalletDetector
import * as dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Database } from './services/Database';
import { SmartMoneyDatabase } from './services/SmartMoneyDatabase';
import { SmartMoneyFlowAnalyzer } from './services/SmartMoneyFlowAnalyzer';
import { SmartWalletDiscovery } from './services/SmartWalletDiscovery';
import { WebhookServer } from './services/WebhookServer';
import { QuickNodeWebhookManager } from './services/QuickNodeWebhookManager';
import { Logger } from './utils/Logger';
import { SmartWalletLoader } from './services/SmartWalletLoader';

dotenv.config();

class SmartMoneyBotRunner {
  private solanaMonitor: SolanaMonitor;
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private flowAnalyzer: SmartMoneyFlowAnalyzer;
  private walletDiscovery: SmartWalletDiscovery;
  private webhookServer: WebhookServer;
  private webhookManager: QuickNodeWebhookManager; 
  private logger: Logger;
  private smartWalletLoader: SmartWalletLoader;
  
  private isRunning: boolean = false;
  private webhookId: string | null = null;
  private intervalIds: NodeJS.Timeout[] = [];

  constructor() {
    this.logger = Logger.getInstance();
    
    this.validateEnvironment();

    this.database = new Database();
    this.smDatabase = new SmartMoneyDatabase();
    
    this.telegramNotifier = new TelegramNotifier(
      process.env.TELEGRAM_BOT_TOKEN!,
      process.env.TELEGRAM_USER_ID!
    );

    this.smartWalletLoader = new SmartWalletLoader(this.smDatabase, this.telegramNotifier);

    this.solanaMonitor = new SolanaMonitor(this.database, this.telegramNotifier);
    
    // ИСПРАВЛЕНО: добавлен параметр database в конструктор
    this.flowAnalyzer = new SmartMoneyFlowAnalyzer(this.smDatabase, this.telegramNotifier, this.database);
    
    this.walletDiscovery = new SmartWalletDiscovery(this.smDatabase, this.database);
    
    this.webhookServer = new WebhookServer(
      this.database, 
      this.telegramNotifier, 
      this.solanaMonitor,
      this.smDatabase
    );
    
    this.webhookManager = new QuickNodeWebhookManager();

    this.logger.info('✅ Smart Money Bot services initialized successfully');
  }

  private validateEnvironment(): void {
    const requiredVars = [
      'QUICKNODE_HTTP_URL',
      'QUICKNODE_API_KEY',
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

      await this.database.init();
      await this.smDatabase.init();
      this.logger.info('✅ Databases initialized');

      const loadedWallets = await this.smartWalletLoader.loadWalletsFromConfig();
      this.logger.info(`📁 Loaded ${loadedWallets} Smart Money wallets from config`);

      const syncResult = await this.smartWalletLoader.syncDatabaseWithConfig();
      this.logger.info(`🔄 Database sync: ${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.disabled} disabled`);

      this.isRunning = true;

      await this.webhookServer.start();
      this.logger.info('✅ Webhook server started');

      this.webhookManager.setDependencies(this.smDatabase, this.telegramNotifier);

      await this.setupQuickNodeWebhook();

      await this.sendStartupNotification();

      this.startPeriodicAnalysis();

      this.startWalletDiscovery();

      // this.startFamilyDetection(); // ОТКЛЮЧЕН

      this.logger.info('✅ Smart Money Bot started successfully!');
      this.logger.info('📊 Real-time DEX monitoring active');
      this.logger.info('🔍 Smart Money flow analysis running');
      this.logger.info('🎯 Advanced insider detection enabled');
      this.logger.info('⚠️ Family wallet detection disabled');

      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      this.logger.error('💥 Failed to start Smart Money Bot:', error);
      process.exit(1);
    }
  }

  async addWalletManually(
    address: string,
    category: 'sniper' | 'hunter' | 'trader',
    nickname: string,
    description: string,
    settings?: any
  ): Promise<boolean> {
    try {
      const defaultMetrics = {
        winRate: 70,
        totalPnL: 50000,
        totalTrades: 50,
        avgTradeSize: category === 'trader' ? 15000 : category === 'hunter' ? 8000 : 5000,
        maxTradeSize: category === 'trader' ? 50000 : category === 'hunter' ? 25000 : 15000,
        performanceScore: 75
      };

      const defaultSettings = {
        minTradeAlert: category === 'trader' ? 15000 : category === 'hunter' ? 5000 : 3000,
        priority: 'medium',
        enabled: true
      };

      const finalSettings = { ...defaultSettings, ...settings };

      const success = await this.smartWalletLoader.addWalletToConfig(
        address,
        category,
        nickname,
        description,
        defaultMetrics,
        'manual'
      );
      
      if (success && settings) {
        await this.smartWalletLoader.updateWalletSettings(address, settings);
      }
      
      if (success) {
        this.logger.info(`✅ Manually added wallet: ${nickname} (${category})`);
        
        await this.telegramNotifier.sendCycleLog(
          `➕ <b>Wallet Added Manually</b>\n\n` +
          `🏷️ <b>Nickname:</b> <code>${nickname}</code>\n` +
          `📍 <b>Address:</b> <code>${address}</code>\n` +
          `🎯 <b>Category:</b> <code>${category}</code>\n` +
          `📝 <b>Description:</b> ${description}\n` +
          `⚙️ <b>Min Alert:</b> <code>$${finalSettings.minTradeAlert}</code>\n` +
          `🔥 <b>Priority:</b> <code>${finalSettings.priority}</code>\n` +
          `✅ <b>Enabled:</b> <code>${finalSettings.enabled ? 'Yes' : 'No'}</code>\n\n` +
          `✅ <b>Started monitoring!</b>`
        );
      }
      return success;
    } catch (error) {
      this.logger.error('Error adding wallet manually:', error);
      return false;
    }
  }

  async updateWalletSettings(address: string, settings: any): Promise<boolean> {
    try {
      const success = await this.smartWalletLoader.updateWalletSettings(address, settings);
      
      if (success) {
        this.logger.info(`⚙️ Updated settings for wallet: ${address}`);
        
        const settingsText = Object.entries(settings)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        
        await this.telegramNotifier.sendCycleLog(
          `⚙️ <b>Wallet Settings Updated</b>\n\n` +
          `📍 <b>Address:</b> <code>${address.slice(0, 8)}...${address.slice(-4)}</code>\n` +
          `🔧 <b>Changes:</b> <code>${settingsText}</code>\n\n` +
          `✅ <b>Settings applied!</b>`
        );
      }
      
      return success;
    } catch (error) {
      this.logger.error('Error updating wallet settings:', error);
      return false;
    }
  }

  async getWalletsByFilters(filters: any): Promise<any[]> {
    try {
      const wallets = await this.smDatabase.getWalletsBySettings(filters);
      return wallets;
    } catch (error) {
      this.logger.error('Error getting wallets by filters:', error);
      return [];
    }
  }

  async exportConfiguration(): Promise<void> {
    try {
      await this.smartWalletLoader.exportConfigFromDatabase();
      this.logger.info('📤 Configuration exported successfully');
      
      await this.telegramNotifier.sendCycleLog(
        `📤 <b>Configuration Exported</b>\n\n` +
        `✅ Wallet configuration exported from database to JSON file\n` +
        `📝 File: <code>data/smart_wallets.json</code>\n` +
        `🔄 Backup created automatically`
      );
    } catch (error) {
      this.logger.error('Error exporting configuration:', error);
    }
  }

  private async setupQuickNodeWebhook(): Promise<void> {
    try {
      let webhookURL: string;
      
      if (process.env.NODE_ENV === 'production') {
        const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com';
        webhookURL = `${renderUrl}/webhook`;
      } else {
        webhookURL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
      }

      this.logger.info(`🔗 Setting up QuickNode monitoring with webhook: ${webhookURL}`);

      this.webhookId = await this.webhookManager.createDEXMonitoringStream(webhookURL);
      
      if (this.webhookId === 'polling-mode') {
        this.logger.info('🔄 QuickNode Streams unavailable - using integrated polling mode');
        this.logger.info('📡 Polling Smart Money wallets every 15 seconds');
        
        const pollingStats = this.webhookManager.getPollingStats();
        this.logger.info(`🎯 Monitoring ${pollingStats.monitoredWallets} Smart Money wallets via polling`);
      } else {
        this.logger.info('🎯 Smart Money DEX monitoring webhook created successfully');
        this.logger.info(`📡 Webhook URL: ${webhookURL}`);
        this.logger.info(`🆔 Stream ID: ${this.webhookId}`);
      }
      
    } catch (error) {
      this.logger.error('❌ Failed to setup QuickNode webhook:', error);
      
      this.logger.info('💡 Force starting polling mode as final fallback...');
      this.webhookId = 'polling-mode';
    }
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const stats = await this.smDatabase.getWalletStats();
      const pollingStats = this.webhookManager.getPollingStats();
      const loaderStats = this.smartWalletLoader.getStats();
      
      const monitoringMode = this.webhookId === 'polling-mode' ? 
        `🔄 <b>Polling Mode</b> (${pollingStats.monitoredWallets} wallets)` : 
        '📡 <b>Real-time Webhooks</b>';

      await this.telegramNotifier.sendCycleLog(
        `🟢 <b>Advanced Smart Money Bot Online!</b>\n\n` +
        `📊 Monitoring <code>${stats.active}</code> active wallets (<code>${stats.enabled}</code> enabled)\n` +
        `🔫 Snipers: <code>${stats.byCategory.sniper || 0}</code>\n` +
        `💡 Hunters: <code>${stats.byCategory.hunter || 0}</code>\n` +
        `🐳 Traders: <code>${stats.byCategory.trader || 0}</code>\n\n` +
        `<b>Priority Distribution:</b>\n` +
        `🔴 High: <code>${stats.byPriority.high || 0}</code>\n` +
        `🟡 Medium: <code>${stats.byPriority.medium || 0}</code>\n` +
        `🟢 Low: <code>${stats.byPriority.low || 0}</code>\n\n` +
        `👥 Family Members: <code>${stats.familyMembers}</code>\n\n` +
        `🎯 Monitoring: ${monitoringMode}\n` +
        `📈 Flow analysis: <b>Every hour</b>\n` +
        `🔥 Hot token detection: <b>Every 60min</b>\n` +
        `🔍 Wallet discovery: <b>Every 2 weeks</b>\n` +
        `⚠️ Family detection: <b>Disabled</b>\n\n` +
        `📝 Config updated: <code>${loaderStats?.lastUpdated}</code>`
      );
    } catch (error) {
      this.logger.error('Failed to send startup notification:', error);
    }
  }

  private startPeriodicAnalysis(): void {
    const runFlowAnalysis = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🔍 Starting hourly Smart Money flow analysis...');
        
        const flowResult = await this.flowAnalyzer.analyzeSmartMoneyFlows();
        
        await this.flowAnalyzer.sendFlowAnalysisNotifications(flowResult);
        
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

    runFlowAnalysis();
    const flowInterval = setInterval(runFlowAnalysis, 60 * 60 * 1000);
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
        
        for (const result of discoveryResults) {
          if (result.isSmartMoney && result.category) {
            const existingWallet = await this.smDatabase.getSmartWallet(result.address);
            
            const success = await this.smartWalletLoader.addWalletToConfig(
              result.address,
              result.category,
              `Auto ${result.category} ${result.address.slice(0, 8)}`,
              `Automatically discovered ${result.category} wallet`,
              {
                winRate: result.metrics.winRate,
                totalPnL: result.metrics.totalPnL,
                totalTrades: result.metrics.totalTrades,
                avgTradeSize: result.metrics.avgTradeSize,
                maxTradeSize: result.metrics.maxTradeSize,
                performanceScore: this.calculatePerformanceScore(result.metrics)
              },
              'discovery'
            );
            
            if (success) {
              if (!existingWallet) {
                newWallets++;
              } else {
                updatedWallets++;
              }
            }
          }
        }
        
        const deactivated = await this.deactivateIneffectiveWallets();
        
        if (this.webhookId === 'polling-mode') {
          this.webhookManager.setDependencies(this.smDatabase, this.telegramNotifier);
        }
        
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

    setTimeout(() => {
      runWalletDiscovery();
      const discoveryInterval = setInterval(runWalletDiscovery, 14 * 24 * 60 * 60 * 1000);
      this.intervalIds.push(discoveryInterval);
    }, 60 * 60 * 1000);

    this.logger.info('🔄 Periodic wallet discovery scheduled');
  }

  // FAMILY DETECTION ОТКЛЮЧЕН
  // private startFamilyDetection(): void { ... }

  private async deactivateIneffectiveWallets(): Promise<number> {
    const activeWallets = await this.smDatabase.getAllActiveSmartWallets();
    let deactivatedCount = 0;
    
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    
    for (const wallet of activeWallets) {
      let shouldDeactivate = false;
      let reason = '';
      
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
        await this.smartWalletLoader.updateWalletSettings(wallet.address, { enabled: false });
        deactivatedCount++;
      }
    }
    
    return deactivatedCount;
  }

  private calculatePerformanceScore(metrics: any): number {
    let score = 0;
    
    score += Math.min(metrics.winRate * 0.5, 30);
    score += Math.min(Math.log10(Math.max(metrics.totalPnL, 1)) * 5, 25);
    score += Math.min(metrics.totalTrades * 0.3, 15);
    score += Math.min(Math.log10(Math.max(metrics.avgTradeSize, 1)) * 3, 15);
    score += Math.min(metrics.sharpeRatio * 7.5, 15);
    
    return Math.min(score, 100);
  }

  private async shutdown(): Promise<void> {
    this.logger.info('🔴 Shutting down Smart Money Bot...');
    
    this.isRunning = false;
    
    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId);
    }
    
    if (this.webhookServer) {
      await this.webhookServer.stop();
    }
    
    if (this.webhookId && this.webhookId !== 'polling-mode') {
      try {
        await this.webhookManager.deleteStream(this.webhookId);
        this.logger.info('✅ QuickNode webhook deleted');
      } catch (error) {
        this.logger.error('❌ Error deleting webhook:', error);
      }
    } else if (this.webhookId === 'polling-mode') {
      this.webhookManager.stopPollingMode();
      this.logger.info('✅ Polling mode stopped');
    }
    
    if (this.database) {
      await this.database.close();
    }
    
    if (this.smDatabase) {
      await this.smDatabase.close();
    }
    
    try {
      await this.telegramNotifier.sendCycleLog('🔴 <b>Smart Money Bot stopped</b>');
    } catch (error) {
      this.logger.error('Failed to send shutdown notification:', error);
    }
    
    this.logger.info('✅ Smart Money Bot shutdown completed');
    process.exit(0);
  }
}

const main = async () => {
  try {
    const bot = new SmartMoneyBotRunner();
    await bot.start();
  } catch (error) {
    console.error('💥 Fatal error starting Smart Money Bot:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

main();