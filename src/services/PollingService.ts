// src/services/PollingService.ts
import { Logger } from '../utils/Logger';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';

export class PollingService {
  private logger: Logger;
  private httpUrl: string;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private lastSignature: string | null = null;

  constructor(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier) {
    this.logger = Logger.getInstance();
    this.httpUrl = process.env.QUICKNODE_HTTP_URL!;
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.logger.info('🔄 Starting QuickNode polling service...');

    // Получаем Smart Money кошельки для мониторинга
    const smartWallets = await this.smDatabase.getAllActiveSmartWallets();
    const walletAddresses = smartWallets.map(w => w.address);

    this.logger.info(`🎯 Monitoring ${walletAddresses.length} Smart Money wallets`);

    // Запускаем polling каждые 10 секунд
    this.intervalId = setInterval(async () => {
      try {
        await this.pollWalletTransactions(walletAddresses);
      } catch (error) {
        this.logger.error('❌ Error in polling cycle:', error);
      }
    }, 10000); // 10 секунд

    // Первый запуск сразу
    setTimeout(() => this.pollWalletTransactions(walletAddresses), 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.logger.info('🔴 Polling service stopped');
  }

  private async pollWalletTransactions(walletAddresses: string[]): Promise<void> {
    if (walletAddresses.length === 0) return;

    try {
      // Получаем последние транзакции для каждого кошелька
      for (const walletAddress of walletAddresses.slice(0, 10)) { // Ограничиваем до 10 за раз
        await this.checkWalletTransactions(walletAddress);
        
        // Небольшая пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      this.logger.error('❌ Error polling wallet transactions:', error);
    }
  }

  private async checkWalletTransactions(walletAddress: string): Promise<void> {
    try {
      const response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            walletAddress,
            {
              limit: 5, // Последние 5 транзакций
              commitment: 'confirmed'
            }
          ]
        })
      });

      if (!response.ok) {
        this.logger.error(`HTTP error for wallet ${walletAddress}: ${response.status}`);
        return;
      }

      const data = await response.json() as any;
      
      if (data.result && Array.isArray(data.result)) {
        // Обрабатываем новые транзакции
        for (const txInfo of data.result) {
          if (this.lastSignature && txInfo.signature === this.lastSignature) {
            break; // Дошли до уже обработанных
          }

          await this.processTransaction(txInfo.signature, walletAddress);
        }

        // Обновляем последнюю обработанную транзакцию
        if (data.result.length > 0) {
          this.lastSignature = data.result[0].signature;
        }
      }

    } catch (error) {
      this.logger.error(`Error checking transactions for wallet ${walletAddress}:`, error);
    }
  }

  private async processTransaction(signature: string, walletAddress: string): Promise<void> {
    try {
      // Получаем детали транзакции
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

      if (!response.ok) return;

      const data = await response.json() as any;
      
      if (data.result) {
        // Анализируем транзакцию на наличие swaps
        await this.analyzeTransactionForSwaps(data.result, walletAddress);
      }

    } catch (error) {
      this.logger.error(`Error processing transaction ${signature}:`, error);
    }
  }

  private async analyzeTransactionForSwaps(transaction: any, walletAddress: string): Promise<void> {
    try {
      // Упрощенный анализ - ищем token transfers
      const meta = transaction.meta;
      if (!meta || meta.err) return;

      const preTokenBalances = meta.preTokenBalances || [];
      const postTokenBalances = meta.postTokenBalances || [];

      // Сравниваем балансы до и после для определения swaps
      for (const postBalance of postTokenBalances) {
        if (postBalance.owner === walletAddress) {
          const preBalance = preTokenBalances.find(
            (pre: any) => pre.accountIndex === postBalance.accountIndex
          );

          const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
          const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
          const difference = postAmount - preAmount;

          if (Math.abs(difference) > 100) { // Минимальное изменение в токенах
            this.logger.info(`💰 Detected token change: ${difference} ${postBalance.uiTokenAmount.uiAmountString} for wallet ${walletAddress}`);
            
            // Здесь можно добавить логику отправки уведомлений
            // await this.sendSwapNotification(walletAddress, transaction, difference);
          }
        }
      }

    } catch (error) {
      this.logger.error('Error analyzing transaction for swaps:', error);
    }
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      lastSignature: this.lastSignature,
      intervalActive: !!this.intervalId
    };
  }
}