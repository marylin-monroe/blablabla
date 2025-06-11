// src/services/InsiderDetector.ts - СИСТЕМА ПОИСКА ИНСАЙДЕРОВ
import { Database } from './Database';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';

interface InsiderCandidate {
  address: string;
  insiderScore: number;
  moonshotCount: number;
  earlyEntryRate: number;
  avgHoldTime: number;
  totalProfit: number;
  successfulMoonshots: Array<{
    tokenAddress: string;
    tokenSymbol: string;
    entryPrice: number;
    currentPrice: number;
    multiplier: number;
    entryTime: Date;
    ageAtEntry: number; // часов
  }>;
}

interface MoonshotToken {
  tokenAddress: string;
  tokenSymbol: string;
  launchTime: Date;
  currentPrice: number;
  multiplier: number; // x100, x1000 etc
  marketCap: number;
}

export class InsiderDetector {
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;

  constructor(database: Database, smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier) {
    this.database = database;
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
  }

  // 🎯 ГЛАВНЫЙ МЕТОД - поиск инсайдеров
  async findInsiders(): Promise<InsiderCandidate[]> {
    this.logger.info('🔍 Starting insider detection...');

    try {
      // 1. Находим токены, которые сделали moonshot (x100+)
      const moonshotTokens = await this.findMoonshotTokens();
      this.logger.info(`Found ${moonshotTokens.length} moonshot tokens`);

      // 2. Для каждого moonshot'а находим early buyers
      const insiderCandidates = new Map<string, InsiderCandidate>();

      for (const moonshot of moonshotTokens) {
        const earlyBuyers = await this.getEarlyBuyers(moonshot);
        
        for (const buyer of earlyBuyers) {
          if (!insiderCandidates.has(buyer.address)) {
            insiderCandidates.set(buyer.address, {
              address: buyer.address,
              insiderScore: 0,
              moonshotCount: 0,
              earlyEntryRate: 0,
              avgHoldTime: 0,
              totalProfit: 0,
              successfulMoonshots: []
            });
          }

          const candidate = insiderCandidates.get(buyer.address)!;
          candidate.moonshotCount++;
          candidate.successfulMoonshots.push({
            tokenAddress: moonshot.tokenAddress,
            tokenSymbol: moonshot.tokenSymbol,
            entryPrice: buyer.entryPrice,
            currentPrice: moonshot.currentPrice,
            multiplier: moonshot.currentPrice / buyer.entryPrice,
            entryTime: buyer.entryTime,
            ageAtEntry: buyer.tokenAgeAtEntry
          });
        }
      }

      // 3. Вычисляем insider score для каждого кандидата
      const scoredInsiders: InsiderCandidate[] = [];
      
      for (const [address, candidate] of insiderCandidates) {
        const metrics = await this.calculateInsiderMetrics(candidate);
        candidate.insiderScore = metrics.insiderScore;
        candidate.earlyEntryRate = metrics.earlyEntryRate;
        candidate.avgHoldTime = metrics.avgHoldTime;
        candidate.totalProfit = metrics.totalProfit;

        // Фильтруем только реальных инсайдеров
        if (candidate.insiderScore > 75 && candidate.moonshotCount >= 2) {
          scoredInsiders.push(candidate);
        }
      }

      // 4. Сортируем по insider score
      scoredInsiders.sort((a, b) => b.insiderScore - a.insiderScore);

      this.logger.info(`✅ Found ${scoredInsiders.length} potential insiders`);
      return scoredInsiders.slice(0, 50); // Топ-50

    } catch (error) {
      this.logger.error('❌ Error in insider detection:', error);
      return [];
    }
  }

  // 🚀 Поиск токенов-moonshot'ов (x100+)
  private async findMoonshotTokens(): Promise<MoonshotToken[]> {
    try {
      const moonshots: MoonshotToken[] = [];
      
      // Получаем транзакции за последние 3 месяца
      const recentTxs = await this.database.getRecentTransactions(24 * 90);
      
      // Группируем по токенам
      const tokenGroups = new Map<string, any[]>();
      
      for (const tx of recentTxs) {
        if (!tokenGroups.has(tx.tokenAddress)) {
          tokenGroups.set(tx.tokenAddress, []);
        }
        tokenGroups.get(tx.tokenAddress)!.push(tx);
      }

      // Анализируем каждый токен на moonshot потенциал
      for (const [tokenAddress, transactions] of tokenGroups) {
        const analysis = await this.analyzeMoonshotPotential(tokenAddress, transactions);
        
        if (analysis.isMovement && analysis.multiplier >= 100) {
          moonshots.push({
            tokenAddress,
            tokenSymbol: analysis.symbol,
            launchTime: analysis.launchTime,
            currentPrice: analysis.currentPrice,
            multiplier: analysis.multiplier,
            marketCap: analysis.marketCap
          });
        }
      }

      return moonshots.sort((a, b) => b.multiplier - a.multiplier);

    } catch (error) {
      this.logger.error('Error finding moonshot tokens:', error);
      return [];
    }
  }

  // 🔍 Анализ moonshot потенциала токена
  private async analyzeMoonshotPotential(tokenAddress: string, transactions: any[]): Promise<{
    isMovement: boolean;
    multiplier: number;
    symbol: string;
    launchTime: Date;
    currentPrice: number;
    marketCap: number;
  }> {
    try {
      if (transactions.length < 10) {
        return { isMovement: false, multiplier: 0, symbol: '', launchTime: new Date(), currentPrice: 0, marketCap: 0 };
      }

      // Сортируем по времени
      transactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      const firstTx = transactions[0];
      const lastTx = transactions[transactions.length - 1];
      
      // Проверяем возраст токена (должен быть достаточно новым)
      const tokenAge = (Date.now() - firstTx.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      if (tokenAge > 180) { // Старше 6 месяцев - скорее всего не moonshot
        return { isMovement: false, multiplier: 0, symbol: firstTx.tokenSymbol, launchTime: firstTx.timestamp, currentPrice: 0, marketCap: 0 };
      }

      // Получаем текущую цену токена
      const currentPrice = await this.getCurrentTokenPrice(tokenAddress);
      if (!currentPrice || currentPrice <= 0) {
        return { isMovement: false, multiplier: 0, symbol: firstTx.tokenSymbol, launchTime: firstTx.timestamp, currentPrice: 0, marketCap: 0 };
      }

      // Оцениваем early price (средняя цена первых 10% транзакций)
      const earlyTxs = transactions.slice(0, Math.max(1, Math.floor(transactions.length * 0.1)));
      const avgEarlyPrice = earlyTxs.reduce((sum, tx) => sum + (tx.price || 0), 0) / earlyTxs.length;
      
      if (avgEarlyPrice <= 0) {
        return { isMovement: false, multiplier: 0, symbol: firstTx.tokenSymbol, launchTime: firstTx.timestamp, currentPrice, marketCap: 0 };
      }

      const multiplier = currentPrice / avgEarlyPrice;
      const marketCap = await this.getTokenMarketCap(tokenAddress, currentPrice);

      return {
        isMovement: multiplier >= 10, // Минимум x10 для рассмотрения
        multiplier,
        symbol: firstTx.tokenSymbol,
        launchTime: firstTx.timestamp,
        currentPrice,
        marketCap
      };

    } catch (error) {
      this.logger.error(`Error analyzing moonshot potential for ${tokenAddress}:`, error);
      return { isMovement: false, multiplier: 0, symbol: '', launchTime: new Date(), currentPrice: 0, marketCap: 0 };
    }
  }

  // 👥 Поиск early buyers для конкретного moonshot токена
  private async getEarlyBuyers(moonshot: MoonshotToken): Promise<Array<{
    address: string;
    entryPrice: number;
    entryTime: Date;
    tokenAgeAtEntry: number; // в часах
    positionSize: number;
  }>> {
    try {
      const earlyBuyers: Array<{
        address: string;
        entryPrice: number;
        entryTime: Date;
        tokenAgeAtEntry: number;
        positionSize: number;
      }> = [];

      // Получаем все транзакции этого токена
      const tokenTxs = await this.database.getTransactionsByTokenAddress(moonshot.tokenAddress, 1000);
      
      // Сортируем по времени
      tokenTxs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Анализируем первые 48 часов торговли
      const earlyWindow = 48 * 60 * 60 * 1000; // 48 часов
      const earlyDeadline = new Date(moonshot.launchTime.getTime() + earlyWindow);

      // Группируем по кошелькам
      const walletEntries = new Map<string, any>();

      for (const tx of tokenTxs) {
        if (tx.timestamp > earlyDeadline) break;
        if (tx.swapType !== 'buy') continue;
        if (tx.amountUSD < 1000) continue; // Минимум $1K

        const tokenAgeAtEntry = (tx.timestamp.getTime() - moonshot.launchTime.getTime()) / (1000 * 60 * 60);
        
        if (!walletEntries.has(tx.walletAddress) || tx.timestamp < walletEntries.get(tx.walletAddress).entryTime) {
          walletEntries.set(tx.walletAddress, {
            address: tx.walletAddress,
            entryPrice: tx.price || 0,
            entryTime: tx.timestamp,
            tokenAgeAtEntry,
            positionSize: tx.amountUSD
          });
        }
      }

      // Фильтруем только серьезные позиции и ранние входы
      for (const [_, entry] of walletEntries) {
        if (entry.tokenAgeAtEntry <= 24 && entry.positionSize >= 5000) { // Первые 24 часа, минимум $5K
          earlyBuyers.push(entry);
        }
      }

      return earlyBuyers.sort((a, b) => a.tokenAgeAtEntry - b.tokenAgeAtEntry);

    } catch (error) {
      this.logger.error(`Error getting early buyers for ${moonshot.tokenSymbol}:`, error);
      return [];
    }
  }

  // 📊 Вычисление insider метрик
  private async calculateInsiderMetrics(candidate: InsiderCandidate): Promise<{
    insiderScore: number;
    earlyEntryRate: number;
    avgHoldTime: number;
    totalProfit: number;
  }> {
    try {
      let totalScore = 0;
      let totalProfit = 0;

      // Анализируем успешные moonshots
      const avgEntryAge = candidate.successfulMoonshots.reduce((sum, ms) => sum + ms.ageAtEntry, 0) / candidate.successfulMoonshots.length;
      const avgMultiplier = candidate.successfulMoonshots.reduce((sum, ms) => sum + ms.multiplier, 0) / candidate.successfulMoonshots.length;

      // Подсчитываем общую прибыль (примерно)
      for (const moonshot of candidate.successfulMoonshots) {
        totalProfit += moonshot.multiplier * 5000; // Предполагаем среднюю позицию $5K
      }

      // Бонусы за insider поведение
      if (avgEntryAge <= 6) totalScore += 30;     // Очень ранние входы
      if (avgEntryAge <= 24) totalScore += 20;    // Ранние входы
      if (candidate.moonshotCount >= 3) totalScore += 25; // Множественные успехи
      if (candidate.moonshotCount >= 5) totalScore += 15; // Супер-инсайдер
      if (avgMultiplier >= 1000) totalScore += 20; // Выбирает x1000+ токены
      if (avgMultiplier >= 100) totalScore += 10;  // Выбирает x100+ токены

      const earlyEntryRate = candidate.successfulMoonshots.filter(ms => ms.ageAtEntry <= 24).length / candidate.successfulMoonshots.length * 100;

      return {
        insiderScore: Math.min(totalScore, 100),
        earlyEntryRate,
        avgHoldTime: 0, // TODO: implement
        totalProfit
      };

    } catch (error) {
      this.logger.error('Error calculating insider metrics:', error);
      return { insiderScore: 0, earlyEntryRate: 0, avgHoldTime: 0, totalProfit: 0 };
    }
  }

  // 💰 Получение текущей цены токена
  private async getCurrentTokenPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (response.ok) {
        const data = await response.json() as any;
        if (data.pairs && data.pairs.length > 0) {
          return parseFloat(data.pairs[0].priceUsd || '0');
        }
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  // 📈 Получение рыночной капитализации
  private async getTokenMarketCap(tokenAddress: string, price: number): Promise<number> {
    try {
      // Упрощенный расчет - можно улучшить
      return price * 1000000000; // Предполагаем 1B supply
    } catch (error) {
      return 0;
    }
  }

  // 📢 Отправка отчета о найденных инсайдерах
  async sendInsiderReport(insiders: InsiderCandidate[]): Promise<void> {
    try {
      if (insiders.length === 0) return;

      let message = `🕵️ <b>INSIDER DETECTION REPORT</b>\n\n`;
      message += `Found <code>${insiders.length}</code> potential insiders:\n\n`;

      for (const insider of insiders.slice(0, 10)) { // Топ-10
        const avgMultiplier = insider.successfulMoonshots.reduce((sum, ms) => sum + ms.multiplier, 0) / insider.successfulMoonshots.length;
        
        message += `🎯 <code>${insider.address.slice(0, 8)}...${insider.address.slice(-4)}</code>\n`;
        message += `📊 Score: <code>${insider.insiderScore}/100</code>\n`;
        message += `🚀 Moonshots: <code>${insider.moonshotCount}</code>\n`;
        message += `⚡ Avg Entry: <code>${insider.earlyEntryRate.toFixed(0)}%</code> early\n`;
        message += `💎 Avg x<code>${avgMultiplier.toFixed(0)}</code>\n`;
        message += `💰 Est. Profit: <code>$${(insider.totalProfit/1000).toFixed(0)}K</code>\n`;
        message += `<a href="https://solscan.io/account/${insider.address}">View Wallet</a>\n\n`;
      }

      message += `🎯 <b>Add these to your Smart Money monitoring!</b>`;

      await this.telegramNotifier.sendCycleLog(message);
      this.logger.info(`✅ Sent insider report with ${insiders.length} candidates`);

    } catch (error) {
      this.logger.error('Error sending insider report:', error);
    }
  }

  // 🤖 Автоматическое добавление лучших инсайдеров в Smart Money базу
  async autoAddTopInsiders(insiders: InsiderCandidate[]): Promise<number> {
    try {
      let addedCount = 0;
      
      // Добавляем только топ-5 инсайдеров с очень высоким score
      const topInsiders = insiders.filter(i => i.insiderScore >= 85).slice(0, 5);
      
      for (const insider of topInsiders) {
        // Проверяем, нет ли уже в базе
        const existing = await this.smDatabase.getSmartWallet(insider.address);
        if (existing) continue;

        // Создаем Smart Money кошелек
        const avgMultiplier = insider.successfulMoonshots.reduce((sum, ms) => sum + ms.multiplier, 0) / insider.successfulMoonshots.length;
        
        const smartWallet = {
          address: insider.address,
          category: 'sniper' as const, // Инсайдеры обычно снайперы
          winRate: Math.min(95, 70 + (insider.insiderScore * 0.3)),
          totalPnL: insider.totalProfit,
          totalTrades: insider.moonshotCount * 10, // Оценка
          avgTradeSize: 25000, // Инсайдеры торгуют крупными суммами
          maxTradeSize: 100000,
          minTradeSize: 5000,
          lastActiveAt: new Date(),
          performanceScore: insider.insiderScore,
          isActive: true
        };

        await this.smDatabase.saveSmartWallet(smartWallet, {
          nickname: `Insider ${insider.address.slice(0, 8)}`,
          description: `Auto-detected insider: ${insider.moonshotCount} moonshots, avg x${avgMultiplier.toFixed(0)}`,
          addedBy: 'discovery',
          verified: true
        });

        addedCount++;
        this.logger.info(`✅ Added insider to Smart Money: ${insider.address.slice(0, 8)}`);
      }

      return addedCount;

    } catch (error) {
      this.logger.error('Error auto-adding insiders:', error);
      return 0;
    }
  }
}
