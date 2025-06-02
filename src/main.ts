// src/main.ts - ОБНОВЛЕННЫЙ с Webhooks
import dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Database } from './services/Database';
import { WebhookServer } from './services/WebhookServer';
import { HeliusWebhookManager } from './services/HeliusWebhookManager';
import { Logger } from './utils/Logger';

// Load environment variables
dotenv.config();

class BotRunner {
  private solanaMonitor: SolanaMonitor;
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private webhookServer: WebhookServer;
  private webhookManager: HeliusWebhookManager;
  private logger: Logger;
  private checkIntervalHours: number;
  private isRunning: boolean = false;
  private webhookId: string | null = null;

  constructor() {
    this.logger = Logger.getInstance();
    
    // Validate required environment variables
    this.validateEnvironment();
    
    // Initialize services
    this.database = new Database();
    this.telegramNotifier = new TelegramNotifier(
      process.env.TELEGRAM_BOT_TOKEN!,
      process.env.TELEGRAM_USER_ID!
    );
    this.solanaMonitor = new SolanaMonitor(this.database, this.telegramNotifier);
    this.webhookServer = new WebhookServer(this.database, this.telegramNotifier, this.solanaMonitor);
    this.webhookManager = new HeliusWebhookManager();
    
    this.checkIntervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS || '3');
    
    this.logger.info('✅ Bot services initialized successfully');
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
      this.logger.info('🚀 Starting Smart Money Bot with Real-time Webhooks...');
      
      // Initialize database
      await this.database.init();
      this.logger.info('✅ Database initialized');

      // Set running flag
      this.isRunning = true;

      // Start webhook server
      await this.webhookServer.start();
      this.logger.info('✅ Webhook server started');

      // Create Helius webhook for DEX monitoring
      await this.setupHeliusWebhook();

      // Send startup notification
      try {
        await this.telegramNotifier.sendCycleLog(
          '🟢 Smart Money Bot запущен!\n' +
          '📡 Real-time DEX monitoring активен\n' +
          '🎭 Hunting for sleeping insiders...'
        );
      } catch (notificationError) {
        this.logger.error('Failed to send startup notification:', notificationError);
      }

      // Set up periodic aggregated reports (every 3 hours)
      const intervalMs = this.checkIntervalHours * 60 * 60 * 1000;
      
      const intervalId = setInterval(async () => {
        if (this.isRunning) {
          await this.sendAggregatedReport();
        } else {
          clearInterval(intervalId);
        }
      }, intervalMs);

      this.logger.info(`✅ Bot started successfully with real-time webhooks!`);
      this.logger.info(`📊 Aggregated reports every ${this.checkIntervalHours} hours`);
      this.logger.info(`🎯 Monitoring ALL DEX transactions in real-time`);

      // Keep the process alive
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      this.logger.error('💥 Failed to start bot:', error);
      process.exit(1);
    }
  }

  private async setupHeliusWebhook(): Promise<void> {
    try {
      // Determine webhook URL
      let webhookURL: string;
      
      if (process.env.NODE_ENV === 'production') {
        // Production: используем Render URL
        const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app.render.com';
        webhookURL = `${renderUrl}/webhook`;
      } else {
        // Development: используем ngrok или локальный URL
        webhookURL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
      }

      // Configure webhook для мониторинга всех основных DEX
      const webhookConfig = {
        webhookURL,
        transactionTypes: ['SWAP'], // Мониторим только SWAP транзакции
        accountAddresses: HeliusWebhookManager.getDEXProgramAddresses(),
        webhookType: 'enhanced' as const, // Получаем parsed данные
      };

      this.webhookId = await this.webhookManager.createDEXMonitoringWebhook(webhookConfig);
      
      this.logger.info('🎯 Successfully created DEX monitoring webhook');
      this.logger.info(`📡 Webhook URL: ${webhookURL}`);
      this.logger.info(`🔗 Webhook ID: ${this.webhookId}`);

    } catch (error) {
      this.logger.error('❌ Failed to setup Helius webhook:', error);
      throw error;
    }
  }

  private async sendAggregatedReport(): Promise<void> {
    try {
      this.logger.info('📊 Generating aggregated smart money report...');
      
      // Получаем транзакции за последние 3 часа
      const recentTransactions = await this.database.getRecentTransactions(this.checkIntervalHours);
      
      if (recentTransactions.length === 0) {
        await this.telegramNotifier.sendNoActivityAlert(
          parseInt(process.env.MIN_TRANSACTION_USD || '1500')
        );
        return;
      }

      // Группируем по токенам для агрегированного отчета
      const tokenAggregations = this.aggregateTransactionsByToken(recentTransactions);
      
      // Создаем отчет
      const report = {
        period: `${this.checkIntervalHours} hours`,
        tokenAggregations: Array.from(tokenAggregations.values())
          .sort((a, b) => b.totalVolumeUSD - a.totalVolumeUSD),
        totalVolumeUSD: recentTransactions.reduce((sum, tx) => sum + tx.amountUSD, 0),
        uniqueTokensCount: tokenAggregations.size,
        bigOrders: recentTransactions.filter(tx => 
          tx.amountUSD >= parseInt(process.env.BIG_ORDER_THRESHOLD || '10000')
        ),
        insiderAlerts: [], // Инсайдерские алерты отправляются в реальном времени
      };

      await this.telegramNotifier.sendTopInflowsReport(report);
      
      this.logger.info(`📊 Sent aggregated report: ${report.tokenAggregations.length} tokens, $${report.totalVolumeUSD.toFixed(2)} volume`);

    } catch (error) {
      this.logger.error('❌ Error generating aggregated report:', error);
      
      try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.telegramNotifier.sendCycleLog(`❌ Report generation failed: ${errorMessage}`);
      } catch (notificationError) {
        this.logger.error('Failed to send error notification:', notificationError);
      }
    }
  }

  private aggregateTransactionsByToken(transactions: any[]): Map<string, any> {
    const aggregations = new Map();

    for (const tx of transactions) {
      const key = tx.tokenAddress;
      
      if (!aggregations.has(key)) {
        aggregations.set(key, {
          tokenAddress: tx.tokenAddress,
          tokenSymbol: tx.tokenSymbol,
          tokenName: tx.tokenName,
          totalVolumeUSD: 0,
          uniqueWallets: new Set(),
          transactions: [],
          firstPurchaseTime: tx.timestamp,
          lastPurchaseTime: tx.timestamp,
          biggestPurchase: tx,
        });
      }

      const agg = aggregations.get(key);
      agg.totalVolumeUSD += tx.amountUSD;
      agg.uniqueWallets.add(tx.walletAddress);
      agg.transactions.push(tx);
      
      if (tx.timestamp < agg.firstPurchaseTime) {
        agg.firstPurchaseTime = tx.timestamp;
      }
      if (tx.timestamp > agg.lastPurchaseTime) {
        agg.lastPurchaseTime = tx.timestamp;
      }
      if (tx.amountUSD > agg.biggestPurchase.amountUSD) {
        agg.biggestPurchase = tx;
      }
    }

    return aggregations;
  }

  private async shutdown(): Promise<void> {
    this.logger.info('🛑 Shutting down bot...');
    
    this.isRunning = false;
    
    try {
      // Cleanup webhook
      if (this.webhookId) {
        await this.webhookManager.deleteWebhook(this.webhookId);
        this.logger.info('🗑️ Webhook cleaned up');
      }

      await this.telegramNotifier.sendCycleLog('🔴 Bot stopped gracefully');
      await this.database.close();
      this.logger.info('✅ Bot shut down successfully');
    } catch (error) {
      this.logger.error('❌ Error during shutdown:', error);
    }
    
    process.exit(0);
  }

  async runOnce(): Promise<void> {
    try {
      this.logger.info('🧪 Running bot once for testing...');
      
      await this.database.init();
      await this.sendAggregatedReport();
      await this.database.close();
      
      this.logger.info('✅ Single run completed');
      
    } catch (error) {
      this.logger.error('❌ Error during single run:', error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const runner = new BotRunner();
  
  // Check if running in "once" mode for testing
  const runOnce = process.argv.includes('--once');
  
  if (runOnce) {
    await runner.runOnce();
  } else {
    await runner.start();
  }
}

// Handle unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  Logger.getInstance().error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  Logger.getInstance().error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main().catch((error) => {
    Logger.getInstance().error('💥 Failed to start application:', error);
    process.exit(1);
  });
}

export { BotRunner };