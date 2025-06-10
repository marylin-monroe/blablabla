// src/services/QuickNodeWebhookManager.ts - БЕЗ Family Detection
import { Logger } from '../utils/Logger';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { SmartMoneyWallet, SmartMoneySwap } from '../types';

interface QuickNodeStreamConfig {
  name: string;
  webhook_url: string;
  filters: Array<{
    program_id?: string[];
    account_type?: string;
  }>;
  region?: string;
}

interface QuickNodeStreamResponse {
  id: string;
  name: string;
  webhook_url: string;
  status: string;
  filters: any;
}

export class QuickNodeWebhookManager {
  private logger: Logger;
  private httpUrl: string;
  private apiKey: string;
  private smDatabase: SmartMoneyDatabase | null = null;
  private telegramNotifier: TelegramNotifier | null = null;
  
  // Polling service properties
  private isPollingActive: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastProcessedSignatures = new Map<string, string>(); // wallet -> last signature
  private monitoredWallets: SmartMoneyWallet[] = [];
  private tokenInfoCache = new Map<string, { symbol: string; name: string; timestamp: number }>();

  constructor() {
    this.logger = Logger.getInstance();
    this.httpUrl = process.env.QUICKNODE_HTTP_URL!;
    this.apiKey = process.env.QUICKNODE_API_KEY!;
  }

  // Инициализация зависимостей для polling
  setDependencies(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier): void {
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
  }

  async createDEXMonitoringStream(webhookUrl: string): Promise<string> {
    try {
      this.logger.info('🔗 Creating QuickNode stream...');

      // DEX программы на Solana
      const dexPrograms = [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
        '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
        'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S', // Lifinity
        'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora
      ];

      const streamConfig: QuickNodeStreamConfig = {
        name: 'smart-money-dex-monitor',
        webhook_url: webhookUrl,
        filters: [{
          program_id: dexPrograms,
          account_type: 'transaction'
        }],
        region: 'us-east-1'
      };

      this.logger.info(`📡 Making request to QuickNode Streams API...`);
      
      // Попробуем несколько endpoint'ов QuickNode
      const endpoints = [
        'https://api.quicknode.com/v1/streams',
        `${this.getApiBaseUrl()}/streams`,
        `${this.httpUrl.replace('/rpc', '')}/api/v1/streams`
      ];

      let lastError: any = null;
      
      for (const endpoint of endpoints) {
        try {
          this.logger.info(`🔄 Trying endpoint: ${endpoint}`);
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'Authorization': `Bearer ${this.apiKey}`,
              'User-Agent': 'Solana-Smart-Money-Bot/3.0'
            },
            body: JSON.stringify(streamConfig)
          });

          if (response.ok) {
            const streamData = await response.json() as QuickNodeStreamResponse;
            
            this.logger.info(`✅ QuickNode stream created: ${streamData.id}`);
            this.logger.info(`📡 Monitoring ${dexPrograms.length} DEX programs`);
            
            return streamData.id;
          } else {
            const errorText = await response.text();
            this.logger.warn(`❌ Endpoint ${endpoint} failed: ${response.status} - ${errorText}`);
            lastError = new Error(`${response.status}: ${errorText}`);
          }
        } catch (error) {
          this.logger.warn(`❌ Endpoint ${endpoint} error:`, error);
          lastError = error;
        }
      }

      // Все endpoints не сработали
      this.logger.error('❌ All QuickNode Streams endpoints failed:', lastError);
      
      // Запускаем polling mode
      await this.startPollingMode();
      return 'polling-mode';

    } catch (error) {
      this.logger.error('❌ Error creating QuickNode stream:', error);
      
      // Fallback к polling режиму
      await this.startPollingMode();
      return 'polling-mode';
    }
  }

  // POLLING SERVICE INTEGRATION
  async startPollingMode(): Promise<void> {
    if (this.isPollingActive) return;
    if (!this.smDatabase || !this.telegramNotifier) {
      this.logger.error('❌ Dependencies not set for polling mode');
      return;
    }

    this.logger.info('🔄 Starting QuickNode polling mode...');
    
    try {
      // Получаем Smart Money кошельки для мониторинга
      this.monitoredWallets = await this.smDatabase.getAllActiveSmartWallets();
      this.logger.info(`🎯 Monitoring ${this.monitoredWallets.length} Smart Money wallets via polling`);

      this.isPollingActive = true;

      // Запускаем polling каждые 15 секунд (чтобы не превысить rate limits)
      this.pollingInterval = setInterval(async () => {
        try {
          await this.pollSmartMoneyWallets();
        } catch (error) {
          this.logger.error('❌ Error in polling cycle:', error);
        }
      }, 15000); // 15 секунд

      // Первый запуск через 2 секунды
      setTimeout(() => this.pollSmartMoneyWallets(), 2000);

      this.logger.info('✅ Polling mode started successfully');

    } catch (error) {
      this.logger.error('❌ Failed to start polling mode:', error);
    }
  }

  stopPollingMode(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPollingActive = false;
    this.logger.info('🔴 Polling mode stopped');
  }

  private async pollSmartMoneyWallets(): Promise<void> {
    if (!this.isPollingActive || this.monitoredWallets.length === 0) return;

    try {
      // Обрабатываем кошельки батчами по 5 штук
      const batchSize = 5;
      const batches = [];
      
      for (let i = 0; i < this.monitoredWallets.length; i += batchSize) {
        batches.push(this.monitoredWallets.slice(i, i + batchSize));
      }

      // Обрабатываем каждый батч
      for (const batch of batches) {
        const promises = batch.map(wallet => this.checkWalletForNewTransactions(wallet));
        await Promise.allSettled(promises);
        
        // Пауза между батчами чтобы не превысить rate limits
        await this.sleep(2000); // 2 секунды
      }

    } catch (error) {
      this.logger.error('❌ Error polling smart money wallets:', error);
    }
  }

  private async checkWalletForNewTransactions(wallet: SmartMoneyWallet): Promise<void> {
    try {
      const walletAddress = wallet.address;
      const lastSignature = this.lastProcessedSignatures.get(walletAddress);

      // Получаем последние транзакции
      const signatures = await this.getWalletSignatures(walletAddress, lastSignature);
      
      if (signatures.length === 0) return;

      // Обновляем последнюю обработанную транзакцию
      this.lastProcessedSignatures.set(walletAddress, signatures[0].signature);

      // Обрабатываем новые транзакции (в обратном порядке - от старых к новым)
      for (const sigInfo of signatures.reverse()) {
        try {
          await this.processWalletTransaction(sigInfo.signature, wallet);
          await this.sleep(100); // Пауза между транзакциями
        } catch (error) {
          this.logger.error(`❌ Error processing transaction ${sigInfo.signature}:`, error);
        }
      }

    } catch (error) {
      this.logger.error(`❌ Error checking wallet ${wallet.address}:`, error);
    }
  }

  private async getWalletSignatures(walletAddress: string, beforeSignature?: string): Promise<Array<{signature: string; blockTime: number}>> {
    try {
      const params: any = [
        walletAddress,
        {
          limit: 10,
          commitment: 'confirmed'
        }
      ];

      if (beforeSignature) {
        params[1].before = beforeSignature;
      }

      const response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.result || [];

    } catch (error) {
      this.logger.error(`Error getting signatures for ${walletAddress}:`, error);
      return [];
    }
  }

  private async processWalletTransaction(signature: string, wallet: SmartMoneyWallet): Promise<void> {
    try {
      // Получаем детали транзакции
      const transaction = await this.getTransactionDetails(signature);
      if (!transaction) return;

      // Анализируем на предмет swaps
      const swaps = await this.extractSwapsFromTransaction(transaction, wallet);
      
      for (const swap of swaps) {
        // Применяем фильтры Smart Money
        if (this.shouldProcessSmartMoneySwap(swap, wallet)) {
          // Сохраняем и отправляем уведомление
          await this.saveAndNotifySwap(swap);
          
          this.logger.info(`🔥 Smart Money swap detected: ${swap.tokenSymbol} - $${swap.amountUSD.toFixed(0)}`);
        }
      }

    } catch (error) {
      this.logger.error(`Error processing transaction ${signature}:`, error);
    }
  }

  private async getTransactionDetails(signature: string): Promise<any> {
    try {
      const response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            }
          ]
        })
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      return data.result;

    } catch (error) {
      this.logger.error(`Error getting transaction details for ${signature}:`, error);
      return null;
    }
  }

  private async extractSwapsFromTransaction(transaction: any, wallet: SmartMoneyWallet): Promise<SmartMoneySwap[]> {
    const swaps: SmartMoneySwap[] = [];

    try {
      if (!transaction || !transaction.meta || transaction.meta.err) return swaps;

      const preTokenBalances = transaction.meta.preTokenBalances || [];
      const postTokenBalances = transaction.meta.postTokenBalances || [];
      const blockTime = transaction.blockTime;

      // Анализируем изменения токен балансов
      for (const postBalance of postTokenBalances) {
        if (postBalance.owner !== wallet.address) continue;

        const preBalance = preTokenBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex
        );

        const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
        const difference = postAmount - preAmount;

        // Игнорируем мелкие изменения
        if (Math.abs(difference) < 1) continue;

        const tokenMint = postBalance.mint;
        const tokenInfo = await this.getTokenInfo(tokenMint);

        // Определяем тип операции и размер в USD (упрощенно)
        const swapType: 'buy' | 'sell' = difference > 0 ? 'buy' : 'sell';
        const tokenAmount = Math.abs(difference);
        
        // Примерная оценка в USD (нужно улучшить с реальными ценами)
        const estimatedUSD = await this.estimateTokenValueUSD(tokenMint, tokenAmount);

        if (estimatedUSD > 1000) { // Минимум $1K для обработки
          const swap: SmartMoneySwap = {
            transactionId: transaction.transaction.signatures[0],
            walletAddress: wallet.address,
            tokenAddress: tokenMint,
            tokenSymbol: tokenInfo.symbol,
            tokenName: tokenInfo.name,
            tokenAmount,
            amountUSD: estimatedUSD,
            swapType,
            timestamp: new Date(blockTime * 1000),
            category: wallet.category,
            winRate: wallet.winRate,
            pnl: wallet.totalPnL,
            totalTrades: wallet.totalTrades,
            // FAMILY ПОЛЯ ОТКЛЮЧЕНЫ
            isFamilyMember: false, // всегда false
            familySize: 0, // всегда 0
            familyId: undefined // всегда undefined
          };

          swaps.push(swap);
        }
      }

    } catch (error) {
      this.logger.error('Error extracting swaps from transaction:', error);
    }

    return swaps;
  }

  private shouldProcessSmartMoneySwap(swap: SmartMoneySwap, wallet: SmartMoneyWallet): boolean {
    // Минимальные суммы по категориям
    const minAmounts: Record<string, number> = {
      sniper: 3000,   // $3K для снайперов
      hunter: 5000,   // $5K для хантеров  
      trader: 15000   // $15K для трейдеров
    };

    const minAmount = minAmounts[wallet.category] || 5000;
    
    if (swap.amountUSD < minAmount) return false;

    // Проверяем активность кошелька
    const daysSinceActive = (Date.now() - wallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 30) return false;

    // Минимальный win rate
    if (wallet.winRate < 65) return false;

    return true;
  }

  private async saveAndNotifySwap(swap: SmartMoneySwap): Promise<void> {
    try {
      if (!this.smDatabase || !this.telegramNotifier) return;

      // Сохраняем в базу данных
      const stmt = this.smDatabase['db'].prepare(`
        INSERT OR IGNORE INTO smart_money_transactions (
          transaction_id, wallet_address, token_address, token_symbol, token_name,
          amount, amount_usd, swap_type, timestamp, dex,
          wallet_category, is_family_member, family_id,
          wallet_pnl, wallet_win_rate, wallet_total_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        swap.transactionId,
        swap.walletAddress,
        swap.tokenAddress,
        swap.tokenSymbol,
        swap.tokenName,
        swap.tokenAmount,
        swap.amountUSD,
        swap.swapType,
        swap.timestamp.toISOString(),
        'Polling',
        swap.category,
        0, // is_family_member всегда 0
        null, // family_id всегда null
        swap.pnl,
        swap.winRate,
        swap.totalTrades
      );

      // Отправляем уведомление
      await this.telegramNotifier.sendSmartMoneySwap(swap);

    } catch (error) {
      this.logger.error('Error saving and notifying swap:', error);
    }
  }

  private async getTokenInfo(tokenMint: string): Promise<{ symbol: string; name: string }> {
    // Проверяем кэш
    const cached = this.tokenInfoCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < 3600000) { // 1 час
      return { symbol: cached.symbol, name: cached.name };
    }

    try {
      // Запрос метаданных токена
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mintAccounts: [tokenMint]
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
          const tokenInfo = {
            symbol: data[0].onChainMetadata?.metadata?.symbol || 'UNKNOWN',
            name: data[0].onChainMetadata?.metadata?.name || 'Unknown Token',
            timestamp: Date.now()
          };
          
          this.tokenInfoCache.set(tokenMint, tokenInfo);
          return { symbol: tokenInfo.symbol, name: tokenInfo.name };
        }
      }
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenMint}:`, error);
    }

    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  }

  private async estimateTokenValueUSD(tokenMint: string, amount: number): Promise<number> {
    try {
      // Простая оценка через DexScreener API
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      
      if (response.ok) {
        const data = await response.json() as any;
        if (data.pairs && data.pairs.length > 0) {
          const price = parseFloat(data.pairs[0].priceUsd || '0');
          return price * amount;
        }
      }
    } catch (error) {
      // Игнорируем ошибки, используем fallback
    }

    // Fallback: средняя оценка для неизвестных токенов
    return amount * 0.01; // $0.01 за токен
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ
  private getApiBaseUrl(): string {
    const baseUrl = this.httpUrl.replace(/\/$/, '');
    return baseUrl.replace(/\/rpc$/, '') + '/api/v1';
  }

  async deleteStream(streamId: string): Promise<void> {
    try {
      if (streamId === 'polling-mode') {
        this.stopPollingMode();
        return;
      }

      this.logger.info(`🗑️ Deleting QuickNode stream: ${streamId}`);

      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': this.apiKey,
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Smart-Money-Bot/3.0'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      this.logger.info(`✅ QuickNode stream deleted: ${streamId}`);

    } catch (error) {
      this.logger.error('❌ Error deleting QuickNode stream:', error);
    }
  }

  async listStreams(): Promise<QuickNodeStreamResponse[]> {
    try {
      const response = await fetch(`${this.getApiBaseUrl()}/streams`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Smart-Money-Bot/3.0'
        }
      });

      if (!response.ok) {
        return [];
      }

      const streams = await response.json() as QuickNodeStreamResponse[];
      this.logger.info(`📋 Found ${streams.length} existing QuickNode streams`);
      
      return streams;

    } catch (error) {
      this.logger.error('❌ Error listing QuickNode streams:', error);
      return [];
    }
  }

  async getStreamStatus(streamId: string): Promise<{
    isActive: boolean;
    status?: string;
  }> {
    try {
      if (streamId === 'polling-mode') {
        return { 
          isActive: this.isPollingActive, 
          status: this.isPollingActive ? 'polling' : 'stopped' 
        };
      }

      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Smart-Money-Bot/3.0'
        }
      });

      if (!response.ok) {
        return { isActive: false };
      }

      const streamData = await response.json() as QuickNodeStreamResponse;
      
      return {
        isActive: streamData.status === 'active',
        status: streamData.status
      };

    } catch (error) {
      this.logger.error(`Error getting stream status for ${streamId}:`, error);
      return { isActive: false };
    }
  }

  async cleanupOldStreams(): Promise<void> {
    try {
      this.logger.info('🧹 Cleaning up old QuickNode streams...');
      
      const streams = await this.listStreams();
      
      for (const stream of streams) {
        try {
          await this.deleteStream(stream.id);
          await this.sleep(1000);
        } catch (error) {
          this.logger.warn(`Failed to delete stream ${stream.id}:`, error);
        }
      }
      
      this.logger.info(`✅ Cleaned up ${streams.length} old streams`);

    } catch (error) {
      this.logger.error('❌ Error during stream cleanup:', error);
    }
  }

  // Статистика polling сервиса
  getPollingStats() {
    return {
      isActive: this.isPollingActive,
      monitoredWallets: this.monitoredWallets.length,
      processedWallets: this.lastProcessedSignatures.size,
      cacheSize: this.tokenInfoCache.size
    };
  }
}