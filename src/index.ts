import dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Database } from './services/Database';
import { Logger } from './utils/Logger';
import * as cron from 'node-cron';

// Load environment variables
dotenv.config();

const logger = Logger.getInstance();

async function main() {
  try {
    logger.info('Starting Solana Smart Money Tracker Bot...');

    // Initialize services
    const database = new Database();
    await database.init();

    const telegramNotifier = new TelegramNotifier(
      process.env.TELEGRAM_BOT_TOKEN!,
      process.env.TELEGRAM_USER_ID!
    );

    const solanaMonitor = new SolanaMonitor(database, telegramNotifier);

    // Run immediately on startup
    await solanaMonitor.checkForNewWalletActivity();

    // Schedule periodic checks
    const intervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS || '3');
    const cronExpression = `0 */${intervalHours} * * *`;

    cron.schedule(cronExpression, async () => {
      logger.info('Running scheduled wallet activity check...');
      await solanaMonitor.checkForNewWalletActivity();
    });

    logger.info(`Bot started successfully. Checking every ${intervalHours} hours.`);

    // Keep the process alive
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      await database.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();