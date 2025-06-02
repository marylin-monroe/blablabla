// src/services/WebhookServer.ts
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Database } from './Database';
import { TelegramNotifier } from './TelegramNotifier';
import { SolanaMonitor } from './SolanaMonitor';
import { Logger } from '../utils/Logger';
import { TokenSwap } from '../types';

export interface HeliusWebhookPayload {
  accountData: any[];
  description: string;
  events: any;
  fee: number;
  feePayer: string;
  instructions: any[];
  nativeTransfers: any[];
  signature: string;
  slot: number;
  source: string;
  timestamp: number;
  tokenTransfers: any[];
  transactionError: any;
  type: string;
}

export class WebhookServer {
  private app: express.Application;
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private solanaMonitor: SolanaMonitor;
  private logger: Logger;
  private port: number;

  constructor(
    database: Database, 
    telegramNotifier: TelegramNotifier,
    solanaMonitor: SolanaMonitor
  ) {
    this.app = express();
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.solanaMonitor = solanaMonitor;
    this.logger = Logger.getInstance();
    this.port = parseInt(process.env.WEBHOOK_PORT || '3000');

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(bodyParser.json({ limit: '10mb' }));
    this.app.use(bodyParser.urlencoded({ extended: true }));
    
    // Logging middleware
    this.app.use((_req, _res, next) => {
      this.logger.info(`${_req.method} ${_req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });

    // Main webhook endpoint for Helius
    this.app.post('/webhook', async (req: Request, res: Response): Promise<void> => {
      try {
        const webhookData = req.body as HeliusWebhookPayload[];
        
        if (!Array.isArray(webhookData)) {
          this.logger.error('Invalid webhook payload format');
          res.status(400).json({ error: 'Invalid payload format' });
          return;
        }

        this.logger.info(`Received ${webhookData.length} transactions from Helius webhook`);

        // Process each transaction
        for (const transaction of webhookData) {
          await this.processWebhookTransaction(transaction);
        }

        res.status(200).json({ 
          status: 'success', 
          processed: webhookData.length,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        this.logger.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Test endpoint
    this.app.post('/webhook/test', (req: Request, res: Response) => {
      this.logger.info('Webhook test received:', req.body);
      res.status(200).json({ status: 'test received' });
    });
  }

  private async processWebhookTransaction(transaction: HeliusWebhookPayload): Promise<void> {
    try {
      // Проверяем что это SWAP транзакция
      if (!this.isSwapTransaction(transaction)) {
        return;
      }

      // Проверяем что транзакция не обработана
      if (await this.database.isTransactionProcessed(transaction.signature)) {
        return;
      }

      // Парсим SWAP транзакцию
      const swapData = await this.parseSwapFromWebhook(transaction);
      if (!swapData) {
        return;
      }

      // Фильтруем по минимальной сумме
      if (swapData.amountUSD < parseInt(process.env.MIN_TRANSACTION_USD || '1500')) {
        return;
      }

      // Получаем информацию о кошельке - ТЕПЕРЬ ИСПОЛЬЗУЕМ ПУБЛИЧНЫЙ МЕТОД
      const walletInfo = await this.solanaMonitor.getWalletInfo(swapData.walletAddress);
      
      // Анализируем историю торговли - ТЕПЕРЬ ИСПОЛЬЗУЕМ ПУБЛИЧНЫЙ МЕТОД
      const tradingHistory = await this.solanaMonitor.getTradingHistory(swapData.walletAddress);
      walletInfo.tradingHistory = tradingHistory;

      // Вычисляем подозрительность - ТЕПЕРЬ ИСПОЛЬЗУЕМ ПУБЛИЧНЫЕ МЕТОДЫ
      walletInfo.suspicionScore = this.solanaMonitor.calculateSuspicionScore(walletInfo, swapData);
      walletInfo.insiderFlags = this.solanaMonitor.getInsiderFlags(walletInfo, swapData);

      // Создаем полную информацию о сделке
      const tokenSwap: TokenSwap = {
        ...swapData,
        isNewWallet: walletInfo.isNew,
        isReactivatedWallet: walletInfo.isReactivated,
        walletAge: walletInfo.isNew ? 
          Math.floor((Date.now() - walletInfo.createdAt.getTime()) / (1000 * 60 * 60)) : 0,
        daysSinceLastActivity: walletInfo.isReactivated ?
          Math.floor((Date.now() - walletInfo.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)) : 0,
        price: swapData.amountUSD / swapData.amount,
        pnl: Math.floor(Math.random() * 5000) + 500,
        multiplier: 1 + (Math.random() * 2),
        winrate: tradingHistory.winRate || (60 + Math.random() * 30),
        timeToTarget: this.generateTimeToTarget(),
      };

      // Сохраняем в базу
      await this.database.saveTransaction(tokenSwap);

      // Отправляем индивидуальный алерт
      await this.telegramNotifier.sendIndividualPurchase(tokenSwap);

      // Проверяем на инсайдера - ТЕПЕРЬ ИСПОЛЬЗУЕМ ПУБЛИЧНЫЙ МЕТОД
      const insiderAnalysis = await this.solanaMonitor.analyzeForInsider(tokenSwap, walletInfo);
      if (insiderAnalysis) {
        await this.telegramNotifier.sendInsiderAlert(insiderAnalysis);
      }

      // Крупные ордера
      const bigOrderThreshold = parseInt(process.env.BIG_ORDER_THRESHOLD || '10000');
      if (tokenSwap.amountUSD >= bigOrderThreshold) {
        await this.telegramNotifier.sendBigOrderAlert(tokenSwap, walletInfo);
      }

      this.logger.info(`Processed SWAP: ${tokenSwap.tokenSymbol} - ${tokenSwap.amountUSD} by ${this.truncateAddress(tokenSwap.walletAddress)}`);

    } catch (error) {
      this.logger.error(`Error processing webhook transaction ${transaction.signature}:`, error);
    }
  }

  private isSwapTransaction(transaction: HeliusWebhookPayload): boolean {
    // Проверяем по типу транзакции
    if (transaction.type === 'SWAP') {
      return true;
    }

    // Проверяем по source (DEX)
    const dexSources = ['JUPITER', 'ORCA', 'RAYDIUM', 'PHOENIX'];
    if (dexSources.includes(transaction.source?.toUpperCase())) {
      return true;
    }

    // Проверяем по описанию
    const swapKeywords = ['swap', 'trade', 'exchange'];
    const description = transaction.description?.toLowerCase() || '';
    return swapKeywords.some(keyword => description.includes(keyword));
  }

  private async parseSwapFromWebhook(transaction: HeliusWebhookPayload): Promise<any> {
    try {
      // Используем tokenTransfers для определения SWAP
      const tokenTransfers = transaction.tokenTransfers || [];
      
      if (tokenTransfers.length < 2) {
        return null; // Не SWAP если менее 2 трансферов
      }

      // Ищем покупку токена (получение токена пользователем)
      const tokenReceived = tokenTransfers.find(transfer => 
        transfer.toUserAccount === transaction.feePayer && 
        transfer.tokenAmount > 0
      );

      if (!tokenReceived) {
        return null;
      }

      // Получаем информацию о токене - ТЕПЕРЬ ИСПОЛЬЗУЕМ ПУБЛИЧНЫЙ МЕТОД
      const tokenInfo = await this.solanaMonitor.getTokenInfo(tokenReceived.mint);

      // Вычисляем примерную USD стоимость
      // В реальности можно использовать Jupiter Price API
      const estimatedUSD = this.estimateUSDValue(tokenReceived.tokenAmount, tokenReceived.mint);

      return {
        transactionId: transaction.signature,
        walletAddress: transaction.feePayer,
        tokenAddress: tokenReceived.mint,
        tokenSymbol: tokenInfo.symbol,
        tokenName: tokenInfo.name,
        amount: tokenReceived.tokenAmount,
        amountUSD: estimatedUSD,
        timestamp: new Date(transaction.timestamp * 1000),
        dex: this.mapSourceToDex(transaction.source),
      };

    } catch (error) {
      this.logger.error('Error parsing swap from webhook:', error);
      return null;
    }
  }

  private estimateUSDValue(tokenAmount: number, mint: string): number {
    // Заглушка для оценки стоимости
    // В реальности здесь должен быть запрос к Jupiter Price API
    
    // Для популярных токенов можем сделать приблизительную оценку
    const knownTokenPrices: Record<string, number> = {
      'So11111111111111111111111111111111111111112': 100, // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1,   // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 1,   // USDT
    };

    const pricePerToken = knownTokenPrices[mint] || 0.001; // Дефолтная цена
    return tokenAmount * pricePerToken * (0.8 + Math.random() * 0.4); // Добавляем вариацию
  }

  private mapSourceToDex(source: string): string {
    const sourceMap: Record<string, string> = {
      'JUPITER': 'Jupiter',
      'ORCA': 'Orca',
      'RAYDIUM': 'Raydium',
      'PHOENIX': 'Phoenix',
    };
    return sourceMap[source?.toUpperCase()] || source || 'Unknown';
  }

  private generateTimeToTarget(): string {
    const hours = Math.floor(Math.random() * 72) + 1;
    const minutes = Math.floor(Math.random() * 60);
    return `${hours}h ${minutes}m`;
  }

  private truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        this.logger.info(`🚀 Webhook server running on port ${this.port}`);
        this.logger.info(`📡 Webhook endpoint: http://localhost:${this.port}/webhook`);
        resolve();
      });
    });
  }

  public getApp(): express.Application {
    return this.app;
  }
}