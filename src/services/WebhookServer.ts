// src/services/WebhookServer.ts - ИСПРАВЛЕНО для Background Worker
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

export class WebhookServer {
  private app: express.Application;
  private server: any;
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private solanaMonitor: SolanaMonitor;
  private logger: Logger;
  private port: number;

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
  }

  private setupMiddleware(): void {
    // Увеличиваем лимит для webhook payload
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // CORS для development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint для Background Worker
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Smart Money Tracker Background Worker',
        version: '3.0.0',
        uptime: process.uptime()
      });
    });

    // Main webhook endpoint для Helius
    this.app.post('/webhook', async (req, res) => {
      try {
        const webhookData: HeliusWebhookPayload[] = Array.isArray(req.body) ? req.body : [req.body];
        
        this.logger.info(`📡 Received webhook with ${webhookData.length} transactions`);

        // Обрабатываем каждую транзакцию
        for (const txData of webhookData) {
          await this.processWebhookTransaction(txData);
        }

        res.status(200).json({ success: true, processed: webhookData.length });
      } catch (error) {
        this.logger.error('❌ Error processing webhook:', error as Error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Test endpoint для проверки работы
    this.app.post('/test', async (req, res) => {
      try {
        this.logger.info('🧪 Test endpoint called');
        
        await this.telegramNotifier.sendCycleLog(
          '🧪 <b>Test notification</b>\n' +
          `Background Worker is running correctly\n` +
          `Timestamp: <code>${new Date().toISOString()}</code>`
        );

        res.json({ 
          success: true, 
          message: 'Test notification sent',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('❌ Error in test endpoint:', error as Error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Statistics endpoint
    this.app.get('/stats', async (req, res) => {
      try {
        const dbStats = await this.smDatabase.getWalletStats();
        const recentTransactions = await this.database.getRecentTransactions(24);
        
        res.json({
          smartMoneyWallets: dbStats,
          recentActivity: {
            last24h: recentTransactions.length,
            lastUpdate: new Date().toISOString()
          },
          service: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: '3.0.0'
          }
        });
      } catch (error) {
        this.logger.error('❌ Error getting stats:', error as Error);
        res.status(500).json({ error: 'Failed to get statistics' });
      }
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  private async processWebhookTransaction(txData: HeliusWebhookPayload): Promise<void> {
    try {
      // Проверяем Token Name Alerts
      await this.checkTokenNameAlerts(txData);

      // Проверяем, что это swap транзакция
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
    try {
      // Извлекаем информацию о свапе
      const walletAddress = this.extractWalletAddress(swapEvent);
      if (!walletAddress) return;

      // Проверяем, является ли кошелек Smart Money
      const smartWallet = await this.smDatabase.getSmartWallet(walletAddress);
      if (!smartWallet || !smartWallet.isActive) {
        // Если это не Smart Money кошелек, используем обычную обработку
        await this.solanaMonitor.processTransaction(txData);
        return;
      }

      // Обрабатываем как Smart Money транзакцию
      const swapInfo = await this.extractSwapInfo(txData, swapEvent, smartWallet);
      if (!swapInfo) return;

      // Применяем фильтры для Smart Money
      if (!this.shouldProcessSmartMoneySwap(swapInfo, smartWallet)) {
        return;
      }

      // Сохраняем транзакцию в базу
      await this.saveSmartMoneyTransaction(swapInfo);

      // Отправляем уведомление
      await this.sendSmartMoneyNotification(swapInfo, smartWallet);

      this.logger.info(`✅ Smart Money swap processed: ${swapInfo.tokenSymbol} - $${swapInfo.amountUSD}`);

    } catch (error) {
      this.logger.error('❌ Error processing swap event:', error as Error);
    }
  }

  private extractWalletAddress(swapEvent: any): string | null {
    // Извлекаем адрес кошелька из события свапа
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
      // Определяем направление свапа и токены
      let tokenAddress = '';
      let tokenAmount = 0;
      let amountUSD = 0;
      let swapType: 'buy' | 'sell' = 'buy';

      // Логика извлечения данных свапа
      if (swapEvent.tokenInputs && swapEvent.tokenOutputs) {
        // Обычный token-to-token swap
        const tokenInput = swapEvent.tokenInputs[0];
        const tokenOutput = swapEvent.tokenOutputs[0];
        
        // Определяем, какой токен не SOL/USDC (основной торгуемый токен)
        const mainTokens = ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']; // SOL, USDC
        
        if (mainTokens.includes(tokenInput.mint)) {
          // Покупка: SOL/USDC -> Token
          swapType = 'buy';
          tokenAddress = tokenOutput.mint;
          tokenAmount = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
          amountUSD = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
        } else {
          // Продажа: Token -> SOL/USDC
          swapType = 'sell';
          tokenAddress = tokenInput.mint;
          tokenAmount = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
          amountUSD = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
        }
      } else if (swapEvent.nativeInput && swapEvent.tokenOutputs) {
        // SOL -> Token (покупка)
        swapType = 'buy';
        const tokenOutput = swapEvent.tokenOutputs[0];
        tokenAddress = tokenOutput.mint;
        tokenAmount = parseFloat(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenOutput.rawTokenAmount.decimals);
        amountUSD = parseFloat(swapEvent.nativeInput.amount) / 1e9; // SOL в USD (упрощенно)
      } else if (swapEvent.tokenInputs && swapEvent.nativeOutput) {
        // Token -> SOL (продажа)
        swapType = 'sell';
        const tokenInput = swapEvent.tokenInputs[0];
        tokenAddress = tokenInput.mint;
        tokenAmount = parseFloat(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, tokenInput.rawTokenAmount.decimals);
        amountUSD = parseFloat(swapEvent.nativeOutput.amount) / 1e9; // SOL в USD (упрощенно)
      }

      if (!tokenAddress || amountUSD === 0) {
        return null;
      }

      // Получаем информацию о токене (символ, название)
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
        isFamilyMember: smartWallet.isFamilyMember || false,
        familySize: smartWallet.familyAddresses?.length || 0,
        familyId: smartWallet.familyAddresses?.[0] || undefined
      };
    } catch (error) {
      this.logger.error('Error extracting swap info:', error as Error);
      return null;
    }
  }

  private shouldProcessSmartMoneySwap(swapInfo: SmartMoneySwap, smartWallet: SmartMoneyWallet): boolean {
    // Фильтры для Smart Money уведомлений
    
    // Минимальная сумма сделки по категориям
    const minAmounts: Record<string, number> = {
      sniper: 5000,   // $5K для снайперов
      hunter: 5000,   // $5K для хантеров  
      trader: 20000   // $20K для трейдеров
    };

    const minAmount = minAmounts[smartWallet.category] || 5000;
    
    if (swapInfo.amountUSD < minAmount) {
      return false;
    }

    // Фильтруем слишком старые кошельки (неактивные более 45 дней)
    const daysSinceActive = (Date.now() - smartWallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 45) {
      return false;
    }

    // Минимальный win rate
    if (smartWallet.winRate < 60) {
      return false;
    }

    return true;
  }

  private async saveSmartMoneyTransaction(swapInfo: SmartMoneySwap): Promise<void> {
    try {
      // Сохраняем в таблицу Smart Money транзакций
      const stmt = this.smDatabase['db'].prepare(`
        INSERT OR REPLACE INTO smart_money_transactions (
          transaction_id, wallet_address, token_address, token_symbol, token_name,
          amount, amount_usd, swap_type, timestamp, dex,
          wallet_category, is_family_member, family_id,
          wallet_pnl, wallet_win_rate, wallet_total_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        swapInfo.transactionId,
        swapInfo.walletAddress,
        swapInfo.tokenAddress,
        swapInfo.tokenSymbol,
        swapInfo.tokenName,
        swapInfo.tokenAmount,
        swapInfo.amountUSD,
        swapInfo.swapType,
        swapInfo.timestamp.toISOString(),
        'Unknown', // DEX будет определяться отдельно
        swapInfo.category,
        swapInfo.isFamilyMember ? 1 : 0,
        swapInfo.familyId || null,
        swapInfo.pnl,
        swapInfo.winRate,
        swapInfo.totalTrades
      );

      // Также сохраняем в основную таблицу транзакций для совместимости
      const tokenSwap: TokenSwap = {
        transactionId: swapInfo.transactionId,
        walletAddress: swapInfo.walletAddress,
        tokenAddress: swapInfo.tokenAddress,
        tokenSymbol: swapInfo.tokenSymbol,
        tokenName: swapInfo.tokenName,
        amount: swapInfo.tokenAmount,
        amountUSD: swapInfo.amountUSD,
        timestamp: swapInfo.timestamp,
        dex: 'Smart Money',
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
      // Отправляем уведомление через TelegramNotifier
      await this.telegramNotifier.sendSmartMoneySwap(swapInfo);
      
    } catch (error) {
      this.logger.error('Error sending Smart Money notification:', error as Error);
    }
  }

  private async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; name: string }> {
    try {
      // Кэшируем информацию о токенах для производительности
      const cachedInfo = this.tokenInfoCache.get(tokenAddress);
      if (cachedInfo) {
        return cachedInfo;
      }

      // Запрос к Helius для получения метаданных токена
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mintAccounts: [tokenAddress]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data && Array.isArray(data) && data.length > 0) {
        const tokenInfo = {
          symbol: data[0].onChainMetadata?.metadata?.symbol || 'UNKNOWN',
          name: data[0].onChainMetadata?.metadata?.name || 'Unknown Token'
        };
        
        // Кэшируем на 1 час
        this.tokenInfoCache.set(tokenAddress, tokenInfo);
        setTimeout(() => {
          this.tokenInfoCache.delete(tokenAddress);
        }, 60 * 60 * 1000);
        
        return tokenInfo;
      }

      return { symbol: 'UNKNOWN', name: 'Unknown Token' };
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenAddress}:`, error as Error);
      return { symbol: 'UNKNOWN', name: 'Unknown Token' };
    }
  }

  // Метод для проверки Token Name Alerts
  private async checkTokenNameAlerts(txData: HeliusWebhookPayload): Promise<void> {
    try {
      // Ищем новые токены в транзакции
      const tokenAddresses = new Set<string>();
      
      // Извлекаем адреса токенов из transfers
      if (txData.tokenTransfers) {
        for (const transfer of txData.tokenTransfers) {
          tokenAddresses.add(transfer.mint);
        }
      }

      // Проверяем каждый токен
      for (const tokenAddress of tokenAddresses) {
        await this.analyzeTokenForNameAlert(tokenAddress);
      }

    } catch (error) {
      this.logger.error('Error checking token name alerts:', error as Error);
    }
  }

  private async analyzeTokenForNameAlert(tokenAddress: string): Promise<void> {
    try {
      // Получаем метаданные токена
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      if (!tokenInfo.name || tokenInfo.name === 'Unknown Token') {
        return;
      }

      // Получаем количество держателей через Helius API
      const holdersCount = await this.getTokenHoldersCount(tokenAddress);
      
      // Проверяем паттерн имени токена
      const alertData = await this.database.checkTokenNamePattern(
        tokenInfo.name,
        tokenAddress,
        holdersCount
      );

      if (alertData.shouldAlert) {
        // Отправляем уведомление
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

  // Кэш для информации о токенах
  private tokenInfoCache = new Map<string, { symbol: string; name: string }>();

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
          this.logger.info(`🌐 Background Worker webhook server started on port ${this.port}`);
          this.logger.info(`📡 Webhook endpoint ready: http://localhost:${this.port}/webhook`);
          this.logger.info(`💊 Health check: http://localhost:${this.port}/health`);
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
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('🔴 Webhook server stopped');
          resolve();
        });
      });
    }
  }

  // Метод для получения статистики сервера
  getServerStats() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      port: this.port,
      environment: process.env.NODE_ENV || 'development'
    };
  }
}