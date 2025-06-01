// src/main.ts
import dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { Database } from './services/Database';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Logger } from './utils/Logger';

// Load environment variables
dotenv.config();

class BotRunner {
  private solanaMonitor: SolanaMonitor;
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  private checkIntervalHours: number;
  private isRunning: boolean = false;

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
    
    this.checkIntervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS || '3');
    
    this.logger.info('Bot initialized successfully');
  }

  /**
   * Validates all required environment variables
   */
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

    this.logger.info('Environment variables validated');
  }

  /**
   * Starts the bot in continuous monitoring mode
   */
  async start(): Promise<void> {
    try {
      this.logger.info('Starting Smart Money Bot...');
      
      // Initialize database
      await this.database.init();
      this.logger.info('Database initialized');

      // Set running flag
      this.isRunning = true;

      // Send startup notification
      try {
        await this.telegramNotifier.sendCycleLog('🟢 Smart Money Bot запущен и работает!');
      } catch (notificationError) {
        this.logger.error('Failed to send startup notification:', notificationError);
      }

      // Initial run
      await this.runSingleCycle();

      // Set up interval for continuous monitoring
      const intervalMs = this.checkIntervalHours * 60 * 60 * 1000;
      
      const intervalId = setInterval(async () => {
        if (this.isRunning) {
          await this.runSingleCycle();
        } else {
          clearInterval(intervalId);
        }
      }, intervalMs);

      this.logger.info(`Bot started successfully. Running every ${this.checkIntervalHours} hours`);

      // Keep the process alive
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      this.logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  /**
   * Runs a single monitoring cycle
   */
  private async runSingleCycle(): Promise<void> {
    try {
      this.logger.info('Starting monitoring cycle...');
      
      const startTime = Date.now();
      
      // Run the main monitoring logic
      await this.solanaMonitor.checkForNewWalletActivity();
      
      const duration = Date.now() - startTime;
      this.logger.info(`Monitoring cycle completed in ${duration}ms`);
      
    } catch (error) {
      this.logger.error('Error during monitoring cycle:', error);
      
      // Send error notification
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.telegramNotifier.sendCycleLog(`❌ Ошибка мониторинга: ${errorMessage}`);
      } catch (notificationError) {
        this.logger.error('Failed to send error notification:', notificationError);
      }
    }
  }

  /**
   * Gracefully shuts down the bot
   */
  private async shutdown(): Promise<void> {
    this.logger.info('Shutting down bot...');
    
    this.isRunning = false;
    
    try {
      await this.telegramNotifier.sendCycleLog('🔴 Bot остановлен');
      await this.database.close();
      this.logger.info('Bot shut down successfully');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
    }
    
    process.exit(0);
  }

  /**
   * Runs the bot once (for testing or manual execution)
   */
  async runOnce(): Promise<void> {
    try {
      this.logger.info('Running bot once...');
      
      await this.database.init();
      await this.runSingleCycle();
      await this.database.close();
      
      this.logger.info('Single run completed');
      
    } catch (error) {
      this.logger.error('Error during single run:', error);
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
  Logger.getInstance().error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  Logger.getInstance().error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main().catch((error) => {
    Logger.getInstance().error('Failed to start application:', error);
    process.exit(1);
  });
}

export { BotRunner };