// src/services/WhaleTransactionScanner.ts - ИСПРАВЛЕНЫ ВСЕ ОШИБКИ TYPESCRIPT
import { DexScreenerService } from './DexScreenerService';
import { JupiterService } from './JupiterService';
import { WhaleTransactionFilter } from './WhaleTransactionFilter'; // 🔧 ИСПРАВЛЕНО: Правильный импорт
import { Database } from './Database';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';

interface WhaleTransaction {
  signature: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amountUSD: number;
  timestamp: Date;
  source: 'dexscreener' | 'jupiter';
  dex: string;
  swapType: 'buy' | 'sell';
  validationScore: number;
  riskFlags: string[];
}

interface WhaleScanResult {
  totalFound: number;
  validWhales: number;
  spamFiltered: number;
  processedSources: string[];
  timeWindow: string;
}

export class WhaleTransactionScanner {
  private dexScreener: DexScreenerService;
  private jupiter: JupiterService;
  private filter: WhaleTransactionFilter;
  private database: Database;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;

  // Конфигурация
  private readonly WHALE_THRESHOLD_USD = 2_000_000; // $2M+ для китов
  private readonly LARGE_THRESHOLD_USD = 500_000;   // $500K+ для крупных сделок
  private readonly MAX_TRANSACTION_AGE_MINUTES = 10; // Максимальный возраст транзакции
  private readonly SCAN_INTERVALS = {
    intensive: 60 * 60 * 1000,     // 60 минут (рабочие часы)
    moderate: 4 * 60 * 60 * 1000,     // 360 минут (обычное время)
    minimal: 12 * 60 * 60 * 1000       // 720 минут (выходные)
  };

  // Кеш для избежания дублирования
  private processedTransactions = new Map<string, number>(); // signature -> timestamp
  private lastScanTime = new Map<string, number>(); // source -> timestamp

  constructor(
    dexScreener: DexScreenerService,
    jupiter: JupiterService,
    database: Database,
    telegramNotifier: TelegramNotifier
  ) {
    this.dexScreener = dexScreener;
    this.jupiter = jupiter;
    this.filter = new WhaleTransactionFilter();
    this.database = database;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();

    this.logger.info('🐋 Whale Transaction Scanner initialized with $2M+ threshold');
  }

  /**
   * Главный метод сканирования крупных транзакций
   */
  async scanForWhaleTransactions(): Promise<WhaleScanResult> {
    try {
      this.logger.info('🔍 Starting whale transaction scan...');
      
      const startTime = Date.now();
      const results: WhaleTransaction[] = [];
      
      // Этап 1: Сбор данных из внешних API (БЕЗ QuickNode credits)
      const [dexWhales, jupiterWhales] = await Promise.allSettled([
        this.getDexScreenerWhales(),
        this.getJupiterWhales()
      ]);

      let totalFound = 0;
      const processedSources: string[] = [];

      // Обработка результатов DexScreener
      if (dexWhales.status === 'fulfilled' && dexWhales.value.length > 0) {
        results.push(...dexWhales.value);
        totalFound += dexWhales.value.length;
        processedSources.push('DexScreener');
        this.logger.info(`📊 DexScreener: ${dexWhales.value.length} whale candidates`);
      }

      // Обработка результатов Jupiter
      if (jupiterWhales.status === 'fulfilled' && jupiterWhales.value.length > 0) {
        results.push(...jupiterWhales.value);
        totalFound += jupiterWhales.value.length;
        processedSources.push('Jupiter');
        this.logger.info(`🪐 Jupiter: ${jupiterWhales.value.length} whale candidates`);
      }

      // Этап 2: Дедупликация
      const uniqueWhales = this.deduplicateTransactions(results);
      this.logger.info(`🔄 After deduplication: ${uniqueWhales.length}/${totalFound} unique whales`);

      // Этап 3: Фильтрация спама и валидация
      const validWhales = await this.validateAndFilterWhales(uniqueWhales);
      this.logger.info(`✅ After validation: ${validWhales.length}/${uniqueWhales.length} valid whales`);

      // Этап 4: Уведомления
      for (const whale of validWhales) {
        await this.sendWhaleAlert(whale);
        await this.sleep(1000); // Пауза между уведомлениями
      }

      // Этап 5: Сохранение в БД
      await this.saveWhaleTransactions(validWhales);

      const scanTime = Date.now() - startTime;
      this.logger.info(`🐋 Whale scan completed in ${scanTime}ms: ${validWhales.length} whales found`);

      return {
        totalFound,
        validWhales: validWhales.length,
        spamFiltered: uniqueWhales.length - validWhales.length,
        processedSources,
        timeWindow: `${this.MAX_TRANSACTION_AGE_MINUTES} minutes`
      };

    } catch (error) {
      this.logger.error('❌ Error in whale transaction scan:', error);
      return {
        totalFound: 0,
        validWhales: 0,
        spamFiltered: 0,
        processedSources: [],
        timeWindow: 'failed'
      };
    }
  }

  /**
   * Получение крупных транзакций из DexScreener
   */
  private async getDexScreenerWhales(): Promise<WhaleTransaction[]> {
    try {
      // Используем новые методы DexScreenerService для поиска крупных транзакций
      const largeTransactions = await this.dexScreener.getRecentLargeTransactions();
      const whales: WhaleTransaction[] = [];

      for (const tx of largeTransactions) {
        if (tx.amountUSD >= this.WHALE_THRESHOLD_USD) {
          // Проверяем возраст транзакции
          const age = Date.now() - tx.timestamp.getTime();
          if (age <= this.MAX_TRANSACTION_AGE_MINUTES * 60 * 1000) {
            whales.push({
              signature: tx.signature,
              walletAddress: tx.walletAddress,
              tokenAddress: tx.tokenAddress,
              tokenSymbol: tx.tokenSymbol,
              tokenName: tx.tokenName,
              amountUSD: tx.amountUSD,
              timestamp: tx.timestamp,
              source: 'dexscreener',
              dex: tx.dex,
              swapType: tx.swapType,
              validationScore: 0, // Будет рассчитан позже
              riskFlags: []
            });
          }
        }
      }

      return whales;
    } catch (error) {
      this.logger.error('❌ Error getting DexScreener whales:', error);
      return [];
    }
  }

  /**
   * Получение крупных транзакций из Jupiter
   */
  private async getJupiterWhales(): Promise<WhaleTransaction[]> {
    try {
      // Используем новые методы JupiterService для поиска крупных свапов
      const largeSwaps = await this.jupiter.getHighVolumeSwaps();
      const whales: WhaleTransaction[] = [];

      for (const swap of largeSwaps) {
        if (swap.amountUSD >= this.WHALE_THRESHOLD_USD) {
          // Проверяем возраст транзакции
          const age = Date.now() - swap.timestamp.getTime();
          if (age <= this.MAX_TRANSACTION_AGE_MINUTES * 60 * 1000) {
            whales.push({
              signature: swap.signature,
              walletAddress: swap.walletAddress,
              tokenAddress: swap.tokenAddress,
              tokenSymbol: swap.tokenSymbol,
              tokenName: swap.tokenName,
              amountUSD: swap.amountUSD,
              timestamp: swap.timestamp,
              source: 'jupiter',
              dex: 'Jupiter',
              swapType: swap.swapType,
              validationScore: 0, // Будет рассчитан позже
              riskFlags: []
            });
          }
        }
      }

      return whales;
    } catch (error) {
      this.logger.error('❌ Error getting Jupiter whales:', error);
      return [];
    }
  }

  /**
   * Дедупликация транзакций по signature
   */
  private deduplicateTransactions(transactions: WhaleTransaction[]): WhaleTransaction[] {
    const unique = new Map<string, WhaleTransaction>();
    
    for (const tx of transactions) {
      const existing = unique.get(tx.signature);
      if (!existing || tx.amountUSD > existing.amountUSD) {
        // Проверяем, не обрабатывали ли мы эту транзакцию недавно
        const lastProcessed = this.processedTransactions.get(tx.signature);
        if (!lastProcessed || Date.now() - lastProcessed > 60 * 60 * 1000) { // 1 час
          unique.set(tx.signature, tx);
        }
      }
    }

    return Array.from(unique.values());
  }

  /**
   * Валидация и фильтрация китов
   */
  private async validateAndFilterWhales(whales: WhaleTransaction[]): Promise<WhaleTransaction[]> {
    const validWhales: WhaleTransaction[] = [];

    for (const whale of whales) {
      try {
        // Используем WhaleTransactionFilter для проверки
        const validation = await this.filter.validateWhaleTransaction({
          walletAddress: whale.walletAddress,
          tokenAddress: whale.tokenAddress,
          amountUSD: whale.amountUSD,
          timestamp: whale.timestamp,
          swapType: whale.swapType
        });

        if (validation.isValid) {
          whale.validationScore = validation.validationScore;
          whale.riskFlags = validation.riskFlags;
          validWhales.push(whale);
        } else {
          this.logger.debug(`🚫 Filtered whale: ${validation.reason} (${whale.signature})`);
        }

      } catch (error) {
        this.logger.error(`❌ Error validating whale ${whale.signature}:`, error);
      }
    }

    return validWhales;
  }

  /**
   * Отправка уведомления о ките
   */
  private async sendWhaleAlert(whale: WhaleTransaction): Promise<void> {
    try {
      const ageText = this.formatTransactionAge(whale.timestamp);
      const riskEmoji = whale.validationScore >= 80 ? '✅' : whale.validationScore >= 60 ? '⚠️' : '🚨';

      let message = `🐋💎 WHALE ALERT 💎🐋\n\n`;
      message += `💰 $${this.formatNumber(whale.amountUSD)} ${whale.swapType.toUpperCase()}\n`;
      message += `🪙 Token: #${whale.tokenSymbol}\n`;
      message += `📍 Address: <code>${whale.tokenAddress}</code>\n`;
      message += `👤 Wallet: <code>${whale.walletAddress}</code>\n`;
      message += `⏰ Age: ${ageText}\n`;
      message += `🏦 DEX: ${whale.dex}\n`;
      message += `📊 Source: ${whale.source}\n\n`;

      message += `🔍 Validation ${riskEmoji}\n`;
      message += `• Score: <code>${whale.validationScore}/100</code>\n`;
      if (whale.riskFlags.length > 0) {
        message += `• Flags: <code>${whale.riskFlags.join(', ')}</code>\n`;
      }

      message += `\n<a href="https://solscan.io/tx/${whale.signature}">TXN</a> | `;
      message += `<a href="https://solscan.io/account/${whale.walletAddress}">Wallet</a> | `;
      message += `<a href="https://solscan.io/token/${whale.tokenAddress}">Token</a> | `;
      message += `<a href="https://dexscreener.com/solana/${whale.tokenAddress}">DS</a>\n\n`;

      message += `<code>#WhaleAlert #${whale.swapType.toUpperCase()}${whale.amountUSD >= 10_000_000 ? ' #MegaWhale' : ''}</code>`;

      // 🔧 ИСПРАВЛЕНО: Заменено на публичный метод
      await this.telegramNotifier.sendCycleLog(message);
      
      // Помечаем как обработанную
      this.processedTransactions.set(whale.signature, Date.now());

      this.logger.info(`🐋 Whale alert sent: ${whale.tokenSymbol} - $${whale.amountUSD.toFixed(0)} (${whale.source})`);

    } catch (error) {
      this.logger.error('❌ Error sending whale alert:', error);
    }
  }

  /**
   * Сохранение транзакций китов в БД
   */
  private async saveWhaleTransactions(whales: WhaleTransaction[]): Promise<void> {
    try {
      for (const whale of whales) {
        // Создаем запись как обычную транзакцию, но с меткой "whale"
        const tokenSwap = {
          transactionId: whale.signature,
          walletAddress: whale.walletAddress,
          tokenAddress: whale.tokenAddress,
          tokenSymbol: whale.tokenSymbol,
          tokenName: whale.tokenName,
          amount: whale.amountUSD, // Для китов amount = amountUSD
          amountUSD: whale.amountUSD,
          timestamp: whale.timestamp,
          dex: whale.dex,
          isNewWallet: false, // Неизвестно
          isReactivatedWallet: false,
          walletAge: 0, // Неизвестно
          daysSinceLastActivity: 0,
          swapType: whale.swapType,
          // Дополнительные поля для агрегации
          suspicionScore: whale.validationScore,
          aggregationGroup: 'whale_transaction'
        };

        await this.database.saveTransaction(tokenSwap);
        this.logger.debug(`💾 Saved whale transaction: ${whale.signature}`);
      }

      if (whales.length > 0) {
        this.logger.info(`💾 Saved ${whales.length} whale transactions to database`);
      }

    } catch (error) {
      this.logger.error('❌ Error saving whale transactions:', error);
    }
  }

  /**
   * Получение интервала сканирования на основе времени
   */
  getCurrentScanInterval(): number {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay(); // 0 = воскресенье, 6 = суббота

    // Выходные - minimal режим
    if (day === 0 || day === 6) {
      return this.SCAN_INTERVALS.minimal;
    }

    // Рабочие часы UTC (примерно совпадают с активным трейдингом)
    if (hour >= 9 && hour <= 21) {
      return this.SCAN_INTERVALS.intensive;
    }

    // Остальное время
    return this.SCAN_INTERVALS.moderate;
  }

  /**
   * Запуск автоматического сканирования
   */
  startAutomaticScanning(): void {
    const runScan = async () => {
      try {
        const result = await this.scanForWhaleTransactions();
        
        // Отправляем статистику каждые 10 сканов или если найдены киты
        if (result.validWhales > 0) {
          await this.sendScanSummary(result);
        }

      } catch (error) {
        this.logger.error('❌ Error in automatic whale scan:', error);
      }
    };

    // Первый запуск через 30 секунд
    setTimeout(runScan, 30000);

    // Динамический интервал на основе времени
    const scheduleNext = () => {
      const interval = this.getCurrentScanInterval();
      setTimeout(async () => {
        await runScan();
        scheduleNext(); // Планируем следующий скан
      }, interval);
    };

    scheduleNext();
    this.logger.info('🔄 Automatic whale scanning started with dynamic intervals');
  }

  /**
   * Отправка сводки сканирования
   */
  private async sendScanSummary(result: WhaleScanResult): Promise<void> {
    try {
      let message = `🐋 <b>Whale Scan Summary</b>\n\n`;
      message += `📊 <b>Results:</b>\n`;
      message += `• Total found: <code>${result.totalFound}</code>\n`;
      message += `• Valid whales: <code>${result.validWhales}</code>\n`;
      message += `• Spam filtered: <code>${result.spamFiltered}</code>\n`;
      message += `• Sources: <code>${result.processedSources.join(', ')}</code>\n`;
      message += `• Time window: <code>${result.timeWindow}</code>\n\n`;
      message += `<code>#WhaleScanSummary</code>`;

      // Отправляем только если есть результаты
      if (result.validWhales > 0) {
        // 🔧 ИСПРАВЛЕНО: Заменено на публичный метод
        await this.telegramNotifier.sendCycleLog(message);
      }

    } catch (error) {
      this.logger.error('❌ Error sending scan summary:', error);
    }
  }

  /**
   * Получение статистики сканера
   */
  getStats(): {
    processedTransactions: number;
    lastScanTimes: { [source: string]: string };
    currentInterval: number;
    thresholds: { whale: number; large: number };
  } {
    const lastScanTimes: { [source: string]: string } = {};
    for (const [source, timestamp] of this.lastScanTime) {
      lastScanTimes[source] = new Date(timestamp).toISOString();
    }

    return {
      processedTransactions: this.processedTransactions.size,
      lastScanTimes,
      currentInterval: this.getCurrentScanInterval(),
      thresholds: {
        whale: this.WHALE_THRESHOLD_USD,
        large: this.LARGE_THRESHOLD_USD
      }
    };
  }

  // Вспомогательные методы
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toFixed(0);
  }

  private formatTransactionAge(timestamp: Date): string {
    const ageMs = Date.now() - timestamp.getTime();
    const ageMinutes = Math.floor(ageMs / (1000 * 60));
    
    if (ageMinutes < 1) {
      return 'Just now';
    } else if (ageMinutes < 60) {
      return `${ageMinutes}m ago`;
    } else {
      const ageHours = Math.floor(ageMinutes / 60);
      return `${ageHours}h ${ageMinutes % 60}m ago`;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}