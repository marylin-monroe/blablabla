// src/services/TelegramNotifier.ts - БЕЗ Family Detection + АГРЕГАЦИЯ ПОЗИЦИЙ
import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport, InsiderAlert, SmartMoneyFlow, HotNewToken, SmartMoneySwap } from '../types';
import { Logger } from '../utils/Logger';

// 🎯 ИНТЕРФЕЙС ДЛЯ АЛЕРТА РАЗБИВКИ ПОЗИЦИИ
interface PositionSplittingAlert {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  totalUSD: number;
  purchaseCount: number;
  avgPurchaseSize: number;
  timeWindowMinutes: number;
  suspicionScore: number;
  sizeTolerance: number;
  firstBuyTime: Date;
  lastBuyTime: Date;
  purchases: Array<{
    amountUSD: number;
    timestamp: Date;
    transactionId: string;
  }>;
}

export class TelegramNotifier {
  private bot: TelegramBot;
  private userId: string;
  private logger: Logger;

  constructor(token: string, userId: string) {
    this.bot = new TelegramBot(token, { polling: false });
    this.userId = userId;
    this.logger = Logger.getInstance();
  }

  // 🎯 НОВЫЙ МЕТОД: Алерт о разбивке позиции
  async sendPositionSplittingAlert(alert: PositionSplittingAlert): Promise<void> {
    try {
      const walletShort = this.truncateAddress(alert.walletAddress);
      const timeSpanText = this.formatTimeSpan(alert.timeWindowMinutes);
      
      // Группируем покупки по схожим суммам для отображения
      const purchaseGroups = this.groupSimilarPurchases(alert.purchases);
      const topGroup = purchaseGroups[0]; // Самая большая группа
      
      // Основное сообщение
      let message = `🎯🚨 <b>POSITION SPLITTING DETECTED</b> 🚨🎯

💰 <b>Total:</b> <code>$${this.formatNumber(alert.totalUSD)}</code> in <code>${alert.purchaseCount}</code> purchases
🪙 <b>Token:</b> <code>#${alert.tokenSymbol}</code>
👤 <b>Wallet:</b> <code>${walletShort}</code>
⏱️ <b>Time span:</b> <code>${timeSpanText}</code>
🎯 <b>Suspicion Score:</b> <code>${alert.suspicionScore}/100</code>

💡 <b>Pattern Analysis:</b>
• Average size: <code>$${this.formatNumber(alert.avgPurchaseSize)}</code>
• Size tolerance: <code>${alert.sizeTolerance.toFixed(2)}%</code>
• Similar purchases: <code>${topGroup.count}/${alert.purchaseCount}</code>
• Group avg: <code>$${this.formatNumber(topGroup.avgAmount)}</code>

<a href="https://solscan.io/account/${alert.walletAddress}">Wallet</a> | <a href="https://solscan.io/token/${alert.tokenAddress}">Token</a> | <a href="https://dexscreener.com/solana/${alert.tokenAddress}">Chart</a>

<code>#PositionSplitting #InsiderAlert #Solana</code>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      // Если много покупок - отправляем детальный breakdown
      if (alert.purchaseCount >= 5) {
        await this.sendDetailedPurchaseBreakdown(alert);
      }

      this.logger.info(`🎯 Position splitting alert sent: ${alert.tokenSymbol} - $${alert.totalUSD} in ${alert.purchaseCount} purchases`);
    } catch (error) {
      this.logger.error('Error sending position splitting alert:', error);
    }
  }

  // 🎯 ДЕТАЛЬНЫЙ BREAKDOWN ПОКУПОК
  private async sendDetailedPurchaseBreakdown(alert: PositionSplittingAlert): Promise<void> {
    try {
      // Сортируем покупки по времени
      const sortedPurchases = alert.purchases.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      let breakdown = `📊 <b>Detailed Purchase Breakdown</b>\n\n`;
      breakdown += `🎯 <b>Token:</b> <code>#${alert.tokenSymbol}</code>\n`;
      breakdown += `👤 <b>Wallet:</b> <code>${this.truncateAddress(alert.walletAddress)}</code>\n\n`;

      // Показываем каждую покупку
      sortedPurchases.forEach((purchase, index) => {
        const timeStr = this.formatTime(purchase.timestamp);
        breakdown += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <b>$${this.formatNumber(purchase.amountUSD)}</b> at <code>${timeStr}</code>\n`;
      });

      // Группируем по схожим суммам
      const groups = this.groupSimilarPurchases(alert.purchases);
      if (groups.length > 1) {
        breakdown += `\n🔍 <b>Similar Amount Groups:</b>\n`;
        groups.forEach((group, index) => {
          breakdown += `<code>${index + 1}.</code> <code>${group.count}x</code> ~<b>$${this.formatNumber(group.avgAmount)}</b> (±${group.tolerance.toFixed(1)}%)\n`;
        });
      }

      breakdown += `\n<code>#PurchaseBreakdown</code>`;

      await this.bot.sendMessage(this.userId, breakdown, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

    } catch (error) {
      this.logger.error('Error sending detailed purchase breakdown:', error);
    }
  }

  // 🎯 ГРУППИРОВКА ПОХОЖИХ ПОКУПОК
  private groupSimilarPurchases(purchases: Array<{amountUSD: number; timestamp: Date; transactionId: string}>): Array<{
    count: number;
    avgAmount: number;
    tolerance: number;
    amounts: number[];
  }> {
    const tolerance = 2.0; // 2% толерантность
    const groups: Array<{
      count: number;
      avgAmount: number;
      tolerance: number;
      amounts: number[];
    }> = [];

    const amounts = purchases.map(p => p.amountUSD);
    const processed = new Set<number>();

    for (const amount of amounts) {
      if (processed.has(amount)) continue;

      const similarAmounts = amounts.filter(a => {
        const diff = Math.abs(a - amount) / amount * 100;
        return diff <= tolerance;
      });

      if (similarAmounts.length >= 2) {
        similarAmounts.forEach(a => processed.add(a));
        
        const avgAmount = similarAmounts.reduce((sum, a) => sum + a, 0) / similarAmounts.length;
        const maxDev = Math.max(...similarAmounts.map(a => Math.abs(a - avgAmount) / avgAmount * 100));
        
        groups.push({
          count: similarAmounts.length,
          avgAmount,
          tolerance: maxDev,
          amounts: similarAmounts
        });
      }
    }

    // Сортируем по количеству в группе (убывание)
    return groups.sort((a, b) => b.count - a.count);
  }

  // 🎯 ФОРМАТИРОВАНИЕ ВРЕМЕННОГО ПРОМЕЖУТКА
  private formatTimeSpan(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) { // меньше дня
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ (без изменений)

  // Метод для отправки топ притоков Smart Money
  async sendTopSmartMoneyInflows(inflows: SmartMoneyFlow[]): Promise<void> {
    try {
      const message = `💚 <b>Top Smart Money Inflows in the past 1 hour (Solana)</b> <code>#TopSMIn1sol</code>\n\n${
        inflows.slice(0, 5).map(flow =>
          `<code>#${flow.tokenSymbol}</code> <b>$${this.formatNumber(flow.totalInflowUSD)}</b> <a href="https://solscan.io/token/${flow.tokenAddress}">SolS</a> <a href="https://dexscreener.com/solana/${flow.tokenAddress}">DS</a>`
        ).join('\n')
      }`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Top Smart Money Inflows sent: ${inflows.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending top smart money inflows:', error);
    }
  }

  // Метод для отправки алертов Hot New Token
  async sendHotNewTokenAlert(hotToken: HotNewToken): Promise<void> {
    try {
      const ageText = hotToken.ageHours < 1 
        ? `${Math.round(hotToken.ageHours * 60)}m` 
        : `${Math.round(hotToken.ageHours)}h`;

      const message = `🔥💎 <b>Hot New Token on Smart Money (Solana)</b> <code>FDV #HotNTSMsol</code>

<code>#${hotToken.symbol}</code> <b>FDV:</b> <code>$${this.formatNumber(hotToken.fdv)}</code> <b>SH:</b> <code>$${this.formatNumber(hotToken.smStakeUSD)}</code> <b>Age:</b> <code>${ageText}</code> <b>Buy:</b> <code>$${this.formatNumber(hotToken.buyVolumeUSD)} (${hotToken.buyCount})</code> <b>Sell:</b> <code>$${this.formatNumber(hotToken.sellVolumeUSD)} (${hotToken.sellCount})</code> <a href="https://solscan.io/token/${hotToken.address}">SolS</a> <a href="https://dexscreener.com/solana/${hotToken.address}">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Hot New Token alert sent: ${hotToken.symbol} - $${hotToken.smStakeUSD}`);
    } catch (error) {
      this.logger.error('Error sending hot new token alert:', error);
    }
  }

  // Улучшенный метод для отправки Smart Money свапов - БЕЗ FAMILY ИНФОРМАЦИИ
  async sendSmartMoneySwap(swap: SmartMoneySwap): Promise<void> {
    try {
      const categoryEmoji = this.getCategoryEmoji(swap.category);
      // УБРАЛИ family информацию
      const walletShort = this.truncateAddress(swap.walletAddress);

      const message = `${categoryEmoji}💚 <b>$${this.formatNumber(swap.amountUSD)}</b> 💚 <code>${this.formatTokenAmount(swap.tokenAmount)} #${swap.tokenSymbol}</code> <code>($${(swap.amountUSD / swap.tokenAmount).toFixed(6)})</code> <code>#${walletShort}</code> <b>WR:</b> <code>${swap.winRate.toFixed(2)}%</code> <b>PNL:</b> <code>$${this.formatNumber(swap.pnl)}</code> <b>TT:</b> <code>${swap.totalTrades}</code> <a href="https://solscan.io/token/${swap.tokenAddress}">SolS</a> <a href="https://dexscreener.com/solana/${swap.tokenAddress}">DS</a>

<a href="https://solscan.io/account/${swap.walletAddress}">Wallet</a> <a href="https://solscan.io/tx/${swap.transactionId}">TXN</a> <code>#SmartSwapSol</code>

<code>${swap.walletAddress}</code>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Smart Money swap sent: ${swap.tokenSymbol} - $${swap.amountUSD}`);
    } catch (error) {
      this.logger.error('Error sending smart money swap:', error);
    }
  }

  // Метод для отправки Token Name Alerts
  async sendTokenNameAlert(tokenData: {
    tokenName: string;
    contractAddress: string;
    holders: number;
    similarTokens: number;
  }): Promise<void> {
    try {
      const message = `⚠️ <b>Token Name Alert</b> <code>#TokenNameAlert</code>

<b>Token:</b> <code>#${tokenData.tokenName}</code>
<b>Contract:</b> <code>${tokenData.contractAddress}</code>
<b>Holders:</b> <code>${tokenData.holders}+</code>
<b>Similar tokens created:</b> <code>${tokenData.similarTokens}</code>

⚠️ <i>99% of such tokens are scam. Be careful!</i>

<a href="https://solscan.io/token/${tokenData.contractAddress}">SolS</a> <a href="https://dexscreener.com/solana/${tokenData.contractAddress}">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Token Name Alert sent: ${tokenData.tokenName}`);
    } catch (error) {
      this.logger.error('Error sending token name alert:', error);
    }
  }

  // Метод для отправки сводки Smart Money Inflows/Outflows
  async sendInflowOutflowSummary(type: 'inflow' | 'outflow', period: '1h' | '24h', flows: SmartMoneyFlow[]): Promise<void> {
    try {
      const emoji = type === 'inflow' ? '📈💚' : '📉🔴';
      const typeText = type === 'inflow' ? 'Inflows' : 'Outflows';
      const periodText = period === '1h' ? '1 hour' : '24 hours';
      
      let message = `${emoji} <b>Smart Money ${typeText} (${periodText})</b> <code>#SM${typeText}${period}sol</code>\n\n`;

      flows.slice(0, 8).forEach((flow, index) => {
        const amount = type === 'inflow' ? flow.totalInflowUSD : flow.totalOutflowUSD;
        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${flow.tokenSymbol}</code> <b>$${this.formatNumber(amount)}</b> <code>(${flow.uniqueWallets} wallets)</code>\n`;
      });

      message += `\n<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Smart Money ${typeText} ${period} summary sent: ${flows.length} tokens`);
    } catch (error) {
      this.logger.error(`Error sending ${type} summary:`, error);
    }
  }

  // Метод для отправки Hot New Tokens сортированных по кошелькам
  async sendHotNewTokensByWallets(tokens: HotNewToken[]): Promise<void> {
    try {
      let message = `🔥💎 <b>Hot New Tokens by Smart Money Wallets</b> <code>#HotNTWalletsSol</code>\n\n`;

      tokens.slice(0, 10).forEach((token, index) => {
        const ageText = token.ageHours < 1 
          ? `${Math.round(token.ageHours * 60)}m` 
          : `${Math.round(token.ageHours)}h`;

        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${token.symbol}</code> <b>${token.uniqueSmWallets} wallets</b> <code>$${this.formatNumber(token.smStakeUSD)}</code> <code>${ageText}</code>\n`;
      });

      message += `\n<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Hot New Tokens by Wallets sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by wallets:', error);
    }
  }

  // Метод для отправки Hot New Tokens сортированных по возрасту
  async sendHotNewTokensByAge(tokens: HotNewToken[]): Promise<void> {
    try {
      let message = `🔥⏰ <b>Hot New Tokens by Age</b> <code>#HotNTAgeSol</code>\n\n`;

      const sortedByAge = tokens.sort((a, b) => a.ageHours - b.ageHours);

      sortedByAge.slice(0, 10).forEach((token, index) => {
        const ageText = token.ageHours < 1 
          ? `${Math.round(token.ageHours * 60)}m` 
          : `${Math.round(token.ageHours)}h`;

        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${token.symbol}</code> <code>${ageText}</code> <b>$${this.formatNumber(token.smStakeUSD)}</b> <code>${token.uniqueSmWallets}w</code>\n`;
      });

      message += `\n<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Hot New Tokens by Age sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by age:', error);
    }
  }

  // Метод для отправки Hot New Tokens сортированных по FDV
  async sendHotNewTokensByFDV(tokens: HotNewToken[]): Promise<void> {
    try {
      let message = `🔥💰 <b>Hot New Tokens by FDV</b> <code>#HotNTFDVSol</code>\n\n`;

      const sortedByFDV = tokens.sort((a, b) => b.fdv - a.fdv);

      sortedByFDV.slice(0, 10).forEach((token, index) => {
        const ageText = token.ageHours < 1 
          ? `${Math.round(token.ageHours * 60)}m` 
          : `${Math.round(token.ageHours)}h`;

        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${token.symbol}</code> <b>$${this.formatNumber(token.fdv)}</b> <code>$${this.formatNumber(token.smStakeUSD)}</code> <code>${ageText}</code>\n`;
      });

      message += `\n<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Hot New Tokens by FDV sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by FDV:', error);
    }
  }

  // УДАЛЕН: sendFamilyWalletAlert - больше не используется

  // Метод для отправки статистики базы Smart Money кошельков - БЕЗ FAMILY INFO
  async sendWalletDatabaseStats(stats: {
    total: number;
    active: number;
    byCategory: Record<string, number>;
    familyMembers: number; // игнорируется, всегда 0
    newlyAdded: number;
    deactivated: number;
  }): Promise<void> {
    try {
      const message = `📊 <b>Smart Money Database Update</b> <code>#SMDBUpdate</code>

<b>📈 Active Wallets:</b> <code>${stats.active}</code> (Total: <code>${stats.total}</code>)

<b>By Category:</b>
🔫 <b>Snipers:</b> <code>${stats.byCategory.sniper || 0}</code>
💡 <b>Hunters:</b> <code>${stats.byCategory.hunter || 0}</code>
🐳 <b>Traders:</b> <code>${stats.byCategory.trader || 0}</code>

✅ <b>Newly Added:</b> <code>${stats.newlyAdded}</code>
❌ <b>Deactivated:</b> <code>${stats.deactivated}</code>

<i>Next update in 2 weeks</i>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Wallet Database Stats sent: ${stats.active} active wallets`);
    } catch (error) {
      this.logger.error('Error sending wallet database stats:', error);
    }
  }

  // Существующие методы из оригинального кода
  async sendInsiderAlert(alert: InsiderAlert): Promise<void> {
    try {
      const walletShort = this.truncateAddress(alert.walletAddress);
      const amountUSD = alert.amountUSD || 0;
      const price = alert.price || 0;
      
      const message = `🚨 <b>INSIDER ALERT</b> 🚨

💰 <b>Spent:</b> <code>$${this.formatNumber(amountUSD)}</code>
🪙 <b>Token:</b> <code>#${alert.tokenSymbol}</code>
📊 <b>Price:</b> <code>$${price.toFixed(8)}</code>
👤 <b>Wallet:</b> <code>${walletShort}</code>
⚡ <b>Signal Strength:</b> <code>${alert.signalStrength || 0}/10</code>

<a href="https://solscan.io/account/${alert.walletAddress}">View Wallet</a> | <a href="https://dexscreener.com/solana/${alert.tokenAddress}">Chart</a>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Insider alert sent: ${alert.tokenSymbol} - $${amountUSD}`);
    } catch (error) {
      this.logger.error('Error sending insider alert:', error);
    }
  }

  async sendCycleLog(message: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.logger.error('Error sending cycle log:', error);
    }
  }

  // Вспомогательные методы для форматирования
  private getCategoryEmoji(category: string): string {
    switch (category) {
      case 'sniper': return '🔫';
      case 'hunter': return '💡';
      case 'trader': return '🐳';
      default: return '💡';
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  private formatTokenAmount(amount: number): string {
    if (amount >= 1_000_000_000) {
      return `${(amount / 1_000_000_000).toFixed(2)}B`;
    } else if (amount >= 1_000_000) {
      return `${(amount / 1_000_000).toFixed(2)}M`;
    } else if (amount >= 1_000) {
      return `${(amount / 1_000).toFixed(2)}K`;
    } else {
      return amount.toFixed(2);
    }
  }

  private truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  private formatTime(timestamp: Date): string {
    return timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
  }
}