// src/main.ts - ОПТИМИЗИРОВАННЫЙ ДЛЯ API ЭКОНОМИИ
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
    
    this.flowAnalyzer = new SmartMoneyFlowAnalyzer(this.smDatabase, this.telegramNotifier, this.database);
    
    this.walletDiscovery = new SmartWalletDiscovery(this.smDatabase, this.database);
    
    this.webhookServer = new WebhookServer(
      this.database, 
      this.telegramNotifier, 
      this.solanaMonitor,
      this.smDatabase
    );
    
    this.webhookManager = new QuickNodeWebhookManager();

    this.logger.info('✅ Smart Money Bot services initialized (OPTIMIZED)');
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

  private detectRenderURL(): string {
    if (process.env.RENDER_EXTERNAL_URL) {
      this.logger.info(`🔗 Using RENDER_EXTERNAL_URL: ${process.env.RENDER_EXTERNAL_URL}`);
      return process.env.RENDER_EXTERNAL_URL;
    }

    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      const renderUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
      this.logger.info(`🔗 Detected from RENDER_EXTERNAL_HOSTNAME: ${renderUrl}`);
      return renderUrl;
    }

    if (process.env.RENDER_SERVICE_NAME) {
      const renderUrl = `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
      this.logger.info(`🔗 Constructed from RENDER_SERVICE_NAME: ${renderUrl}`);
      return renderUrl;
    }

    if (process.env.PORT && process.env.PORT !== '3000') {
      const gitRemote = process.env.GIT_REMOTE_URL || '';
      if (gitRemote.includes('github.com')) {
        const repoMatch = gitRemote.match(/github\.com[/:](.*?)\/(.+?)(?:\.git)?$/);
        if (repoMatch) {
          const repoName = repoMatch[2].replace('.git', '');
          const renderUrl = `https://${repoName}.onrender.com`;
          this.logger.info(`🔗 Guessed from git repo: ${renderUrl}`);
          return renderUrl;
        }
      }
    }

    const renderVars = [
      'RENDER_EXTERNAL_URL',
      'RENDER_SERVICE_URL', 
      'RENDER_APP_URL',
      'RENDER_EXTERNAL_HOSTNAME'
    ];

    for (const varName of renderVars) {
      if (process.env[varName]) {
        const url = process.env[varName].startsWith('http') 
          ? process.env[varName] 
          : `https://${process.env[varName]}`;
        this.logger.info(`🔗 Found in ${varName}: ${url}`);
        return url;
      }
    }

    const fallbackUrl = 'https://smart-money-tracker.onrender.com';
    this.logger.warn(`⚠️ Could not detect Render URL, using fallback: ${fallbackUrl}`);
    this.logger.info('💡 Available env vars:', Object.keys(process.env).filter(k => k.includes('RENDER')));
    
    return fallbackUrl;
  }

  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting OPTIMIZED Smart Money Bot System...');

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

      this.startPeriodicAnalysisOptimized();

      this.startWalletDiscoveryOptimized();

      this.logger.info('✅ OPTIMIZED Smart Money Bot started successfully!');
      this.logger.info('📊 Real-time DEX monitoring active (OPTIMIZED)');
      this.logger.info('🔍 Smart Money flow analysis running (4h intervals)');
      this.logger.info('🎯 Advanced insider detection enabled (LIMITED)');
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
      
      if (process.env.NODE_ENV === 'production' || process.env.PORT) {
        webhookURL = `${this.detectRenderURL()}/webhook`;
      } else {
        webhookURL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
      }

      this.logger.info(`🔗 Setting up OPTIMIZED QuickNode monitoring with webhook: ${webhookURL}`);

      this.webhookId = await this.webhookManager.createDEXMonitoringStream(webhookURL);
      
      if (this.webhookId === 'polling-mode') {
        this.logger.info('🔄 QuickNode Streams unavailable - using OPTIMIZED polling mode');
        this.logger.info('📡 Polling Smart Money wallets every 5 MINUTES (OPTIMIZED)');
        
        const pollingStats = this.webhookManager.getPollingStats();
        this.logger.info(`🎯 Monitoring ${pollingStats.monitoredWallets}/20 TOP Smart Money wallets (OPTIMIZED)`);
      } else {
        this.logger.info('🎯 Smart Money DEX monitoring webhook created successfully');
        this.logger.info(`📡 Webhook URL: ${webhookURL}`);
        this.logger.info(`🆔 Stream ID: ${this.webhookId}`);
      }
      
    } catch (error) {
      this.logger.error('❌ Failed to setup QuickNode webhook:', error);
      
      this.logger.info('💡 Force starting OPTIMIZED polling mode as final fallback...');
      this.webhookId = 'polling-mode';
    }
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const stats = await this.smDatabase.getWalletStats();
      const pollingStats = this.webhookManager.getPollingStats();
      const loaderStats = this.smartWalletLoader.getStats();
      
      const monitoringMode = this.webhookId === 'polling-mode' ? 
        `🔄 <b>OPTIMIZED Polling Mode</b> (${pollingStats.monitoredWallets}/20 wallets, 5min intervals)` : 
        '📡 <b>Real-time Webhooks</b>';

      await this.telegramNotifier.sendCycleLog(
        `🟢 <b>OPTIMIZED Smart Money Bot Online!</b>\n\n` +
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
        `📈 Flow analysis: <b>Every 4 hours (OPTIMIZED)</b>\n` +
        `🔥 Hot token detection: <b>Every 4 hours</b>\n` +
        `🔍 Wallet discovery: <b>Every 2 weeks (LIMITED to 20 candidates)</b>\n` +
        `⚠️ Family detection: <b>Disabled</b>\n\n` +
        `🚀 <b>API OPTIMIZATION ACTIVE:</b>\n` +
        `• Polling: 5min intervals (-95% requests)\n` +
        `• Token cache: 24h TTL\n` +
        `• Price cache: 5min TTL\n` +
        `• Min trade: $8K+ (strict filters)\n` +
        `• Max wallets: 20 (top performance only)\n\n` +
        `📝 Config updated: <code>${loaderStats?.lastUpdated}</code>`
      );
    } catch (error) {
      this.logger.error('Failed to send startup notification:', error);
    }
  }

  // 🔥 ОПТИМИЗИРОВАННЫЙ PERIODIC ANALYSIS: 1 час → 4 ЧАСА!
  private startPeriodicAnalysisOptimized(): void {
    const runFlowAnalysis = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🔍 Starting 4-hourly OPTIMIZED Smart Money flow analysis...');
        
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
        
        this.logger.info('✅ 4-hourly OPTIMIZED Smart Money flow analysis completed');
      } catch (error) {
        this.logger.error('❌ Error in 4-hourly flow analysis:', error);
      }
    };

    // Первый запуск
    runFlowAnalysis();
    
    // 🔥 КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: 1 час → 4 ЧАСА = -75% API запросов!
    const flowInterval = setInterval(runFlowAnalysis, 4 * 60 * 60 * 1000); // 4 ЧАСА!
    this.intervalIds.push(flowInterval);

    this.logger.info('🔄 OPTIMIZED Periodic Smart Money flow analysis started (4-hour intervals)');
  }

  // 🔥 ОПТИМИЗИРОВАННЫЙ WALLET DISCOVERY: ЛИМИТ 20 КАНДИДАТОВ
  private startWalletDiscoveryOptimized(): void {
    const runWalletDiscovery = async () => {
      if (!this.isRunning) {
        this.logger.warn('⚠️ Bot not running, skipping wallet discovery');
        return;
      }
      
      try {
        this.logger.info('🔍 Starting OPTIMIZED wallet discovery process (LIMITED)...');
        
        const discoveryResults = await this.walletDiscovery.discoverSmartWallets();
        
        let newWallets = 0;
        let updatedWallets = 0;
        
        // 🔥 ОГРАНИЧИВАЕМ количество новых кошельков: максимум 5 за раз
        let processedCount = 0;
        const maxNewWallets = 5;
        
        for (const result of discoveryResults) {
          if (processedCount >= maxNewWallets) {
            this.logger.info(`🚫 Reached limit of ${maxNewWallets} new wallets per discovery cycle`);
            break;
          }
          
          if (result.isSmartMoney && result.category) {
            const existingWallet = await this.smDatabase.getSmartWallet(result.address);
            
            const success = await this.smartWalletLoader.addWalletToConfig(
              result.address,
              result.category,
              `Auto ${result.category} ${result.address.slice(0, 8)}`,
              `Automatically discovered ${result.category} wallet (OPTIMIZED)`,
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
                processedCount++;
              } else {
                updatedWallets++;
              }
            }
          }
        }
        
        const deactivated = await this.deactivateIneffectiveWalletsOptimized();
        
        if (this.webhookId === 'polling-mode') {
          this.webhookManager.setDependencies(this.smDatabase, this.telegramNotifier);
        }
        
        const stats = await this.smDatabase.getWalletStats();
        await this.telegramNotifier.sendWalletDatabaseStats({
          ...stats,
          newlyAdded: newWallets,
          deactivated
        });
        
        this.logger.info(`✅ OPTIMIZED Wallet discovery completed: ${newWallets} new, ${updatedWallets} updated, ${deactivated} deactivated (LIMITED)`);
        
      } catch (error) {
        this.logger.error('❌ Error in optimized wallet discovery:', error);
      }
    };

    // 🔥 ИСПРАВЛЕННЫЙ КОД: запуск через 1 час
    this.logger.info('⏰ Wallet discovery will start in 1 hour...');
    
    const discoveryTimeout = setTimeout(async () => {
      this.logger.info('⏰ 1 hour passed, starting wallet discovery...');
      await runWalletDiscovery();
      
      // Повторяем каждые 2 недели
      const discoveryInterval = setInterval(async () => {
        this.logger.info('⏰ 2 weeks passed, running periodic wallet discovery...');
        await runWalletDiscovery();
      }, 14 * 24 * 60 * 60 * 1000);
      
      this.intervalIds.push(discoveryInterval);
    }, 60 * 60 * 1000); // 1 час
    
    // 🔥 ДОБАВЛЯЕМ TIMEOUT В СПИСОК ДЛЯ ОЧИСТКИ
    this.intervalIds.push(discoveryTimeout as any);

    this.logger.info('🔄 OPTIMIZED Periodic wallet discovery scheduled (2 weeks, LIMITED to 5 new wallets)');
  }

  // 🔥 ОПТИМИЗИРОВАННОЕ ДЕАКТИВИРОВАНИЕ
  private async deactivateIneffectiveWalletsOptimized(): Promise<number> {
    const activeWallets = await this.smDatabase.getAllActiveSmartWallets();
    let deactivatedCount = 0;
    
    // 🔥 СТРОЖЕ: 30 дней вместо 60
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    for (const wallet of activeWallets) {
      let shouldDeactivate = false;
      let reason = '';
      
      // 🔥 СТРОЖЕ: win rate < 60% (было 55%)
      if (wallet.winRate < 60) {
        shouldDeactivate = true;
        reason = `Win rate dropped to ${wallet.winRate.toFixed(1)}%`;
      } else if (wallet.lastActiveAt < thirtyDaysAgo) {
        shouldDeactivate = true;
        const daysInactive = Math.floor((Date.now() - wallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24));
        reason = `Inactive for ${daysInactive} days`;
      } else if (wallet.totalPnL < -5000) { // Строже: -5K вместо -10K
        shouldDeactivate = true;
        reason = `Total PnL became negative: ${wallet.totalPnL.toFixed(0)}`;
      } else if (wallet.avgTradeSize < 2000) { // Строже: 2K вместо 1K
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
    this.logger.info('🔴 Shutting down OPTIMIZED Smart Money Bot...');
    
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
      this.logger.info('✅ OPTIMIZED Polling mode stopped');
    }
    
    if (this.database) {
      await this.database.close();
    }
    
    if (this.smDatabase) {
      await this.smDatabase.close();
    }
    
    try {
      await this.telegramNotifier.sendCycleLog('🔴 <b>OPTIMIZED Smart Money Bot stopped</b>');
    } catch (error) {
      this.logger.error('Failed to send shutdown notification:', error);
    }
    
    this.logger.info('✅ OPTIMIZED Smart Money Bot shutdown completed');
    process.exit(0);
  }
}

const main = async () => {
  try {
    const bot = new SmartMoneyBotRunner();
    await bot.start();
  } catch (error) {
    console.error('💥 Fatal error starting OPTIMIZED Smart Money Bot:', error);
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