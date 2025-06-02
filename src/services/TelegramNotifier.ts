// src/services/TelegramNotifier.ts
import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport, InsiderAlert } from '../types';
import { Logger } from '../utils/Logger';

export class TelegramNotifier {
  private bot: TelegramBot;
  private userId: string;
  private logger: Logger;

  constructor(token: string, userId: string) {
    this.bot = new TelegramBot(token, { polling: false });
    this.userId = userId;
    this.logger = Logger.getInstance();
  }

  // ЧАСТЬ 1: Отчёт по отдельным покупкам ≥ $1500 (табличная визуализация)
  async sendIndividualPurchase(swap: TokenSwap): Promise<void> {
    try {
      const walletShort = this.truncateAddress(swap.walletAddress);
      const multiplierStr = swap.multiplier ? `${swap.multiplier.toFixed(1)}x` : '1.0x';
      const winrateStr = swap.winrate ? `${Math.floor(swap.winrate)}%` : '85%';
      const pnlStr = swap.pnl ? `+$${this.formatNumber(swap.pnl)}` : '+$0';
      const priceStr = swap.price ? `${swap.price.toFixed(6)}` : '$0.000001';
      const timeStr = swap.timeToTarget || '12h 30m';

      const message = `
\`\`\`
┌────────────┬─────────────────────┐
│ 💸 Spent   │ ${this.formatNumberPadded(swap.amountUSD)}              │
│ 📦 Amount  │ ${this.formatTokenAmount(swap.amount)} ${swap.tokenSymbol} │
│ 📈 Price   │ ${priceStr}           │
│ 📊 Winrate │ ${winrateStr}                 │
│ 📈 PnL     │ ${pnlStr}             │
│ ✖️ X       │ ${multiplierStr}                │
│ ⏱️ TT       │ ${timeStr}              │
│ 🔗 Wallet  │ https://solscan.io/account/${walletShort} │
│ 🕐 Time    │ ${this.formatTime(swap.timestamp)}           │
└────────────┴─────────────────────┘
\`\`\``;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      this.logger.info(`Individual purchase sent: ${swap.tokenSymbol} - ${swap.amountUSD}`);

    } catch (error) {
      this.logger.error('Error sending individual purchase:', error);
    }
  }

  // ЧАСТЬ 2: Агрегированная таблица "Top Smart Money Inflows"
  async sendTopInflowsReport(report: SmartMoneyReport): Promise<void> {
    try {
      let message = `📊 <b>Top Smart Money Inflows (Last ${report.period})</b>\n\n`;

      // Показываем топ токены
      const topTokens = report.tokenAggregations.slice(0, 10);
      
      for (let i = 0; i < topTokens.length; i++) {
        const agg = topTokens[i];
        const walletCount = agg.uniqueWallets.size;
        const volumeStr = this.formatNumber(agg.totalVolumeUSD);
        
        message += `<code>${(i + 1).toString().padStart(2, ' ')}. ${agg.tokenSymbol.padEnd(12)} — ${walletCount.toString().padStart(2, ' ')} wallets — ${volumeStr.padStart(7)}</code>\n`;
      }

      // Добавляем сводку
      message += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `📊 <b>Summary:</b>\n`;
      message += `• Total Volume: ${this.formatNumber(report.totalVolumeUSD)}\n`;
      message += `• Unique Tokens: ${topTokens.length}\n`;
      message += `• Big Orders (>${this.formatNumber(parseInt(process.env.BIG_ORDER_THRESHOLD || '10000'))}): ${report.bigOrders.length}\n`;
      
      if (report.insiderAlerts.length > 0) {
        message += `• 🎭 Insider Alerts: ${report.insiderAlerts.length}\n`;
      }

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Top inflows report sent with ${topTokens.length} tokens`);

    } catch (error) {
      this.logger.error('Error sending top inflows report:', error);
    }
  }

  // Алерт о спящем инсайдере (новый!)
  async sendInsiderAlert(alert: InsiderAlert): Promise<void> {
    try {
      const swap = alert.tokenSwap;
      const history = alert.tradingHistory;
      
      // Эмодзи по уровню риска
      const riskEmoji = {
        'LOW': '🟡',
        'MEDIUM': '🟠', 
        'HIGH': '🔴',
        'CRITICAL': '🚨'
      };

      // Форматируем причины детекции
      const reasons = alert.detectionReasons.map(reason => {
        switch(reason) {
          case 'CONFIDENCE_PARADOX': return '⚡ Confidence Paradox - Bad history but big bet';
          case 'SLEEPING_BEAUTY': return '😴 Sleeping Beauty - Old wallet suddenly active';
          case 'EXPONENTIAL_GROWTH': return '📈 Exponential Growth - Size increased 75x+';
          case 'FAKE_NOOB_PATTERN': return '🎭 Fake Noob - Too many "losses"';
          default: return `• ${reason}`;
        }
      }).join('\n');

      const ageInDays = Math.floor((Date.now() - swap.timestamp.getTime()) / (1000 * 60 * 60 * 24));
      const growthRate = history.maxBuySize > 0 ? (swap.amountUSD / history.avgBuySize).toFixed(1) : 'N/A';

      const message = `
${riskEmoji[alert.riskLevel]} <b>SLEEPING INSIDER DETECTED!</b>

👤 <b>Wallet:</b> <code>${swap.walletAddress}</code>
📊 <b>Fake History:</b> ${Math.floor(history.winRate)}% WR, avg buy ${this.formatNumber(history.avgBuySize)}
🚨 <b>Anomaly:</b> Just bought ${this.formatNumber(swap.amountUSD)} of ${swap.tokenSymbol}

🎭 <b>DECEPTION TACTICS DETECTED:</b>
${reasons}

🎯 <b>Analysis:</b>
• Suspicion Score: ${alert.suspicionScore.toFixed(1)}/100 (${alert.riskLevel})
• Growth Rate: ${growthRate}x from avg size
• Wallet Age: ${ageInDays} days old
• Confidence: ${(alert.confidence * 100).toFixed(0)}%

🚀 <b>COPY IMMEDIATELY - This is the real deal!</b>

🔍 <a href="https://solscan.io/account/${swap.walletAddress}">View Wallet</a> | <a href="https://birdeye.so/token/${swap.tokenAddress}">View Token</a>
`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Insider alert sent: ${swap.tokenSymbol} - Score: ${alert.suspicionScore}`);

    } catch (error) {
      this.logger.error('Error sending insider alert:', error);
    }
  }

  // Метод для отправки логов о циклах работы бота
  async sendCycleLog(message: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.userId, `🤖 <b>Bot Status</b>\n\n${message}`, {
        parse_mode: 'HTML',
      });
      this.logger.info(`Cycle log sent: ${message}`);
    } catch (error) {
      this.logger.error('Error sending cycle log:', error);
    }
  }

  // Метод для уведомления об отсутствии активности
  async sendNoActivityAlert(minAmount: number): Promise<void> {
    try {
      const message = `
📊 <b>No Smart Money Activity</b>

No transactions above ${this.formatNumber(minAmount)} detected in this period.

The bot is working correctly and will notify you when smart money moves.
`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
      });

      this.logger.info('No activity alert sent');
    } catch (error) {
      this.logger.error('Error sending no activity alert:', error);
    }
  }

  // Особый алерт для ОЧЕНЬ крупных ордеров > $10,000
  async sendBigOrderAlert(swap: TokenSwap, walletInfo: WalletInfo): Promise<void> {
    try {
      const walletStatus = swap.isNewWallet ? '🆕 НОВЫЙ' : '♻️ РЕАКТИВИРОВАН';
      const walletAge = swap.isNewWallet ? 
        `Создан ${swap.walletAge} часов назад` : 
        `Неактивен ${swap.daysSinceLastActivity} дней`;
      
      const relatedWallets = walletInfo.relatedWallets && walletInfo.relatedWallets.length > 0 ?
        `\n\n🔗 <b>Связанные кошельки:</b>\n${walletInfo.relatedWallets.map(w => `• ${this.truncateAddress(w)}`).join('\n')}` : '';
      
      const message = `
🚨🚨🚨 <b>КРУПНЫЙ ОРДЕР НА ${this.formatNumber(swap.amountUSD)}!</b> 🚨🚨🚨

💰 <b>Куплено:</b> ${this.formatNumber(swap.amount)} ${swap.tokenSymbol}
📍 <b>Токен:</b> ${swap.tokenName}
💳 <b>Кошелек:</b> <code>${swap.walletAddress}</code>
📊 <b>Статус:</b> ${walletStatus}
📌 <b>Возраст:</b> ${walletAge}
🏪 <b>DEX:</b> ${swap.dex}
⏰ <b>Время:</b> ${swap.timestamp.toUTCString()}
${relatedWallets}

🔍 <a href="https://solscan.io/account/${swap.walletAddress}">Кошелек</a> | <a href="https://birdeye.so/token/${swap.tokenAddress}">Токен</a>
`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Big order alert sent for ${swap.tokenSymbol} - ${swap.amountUSD}`);

    } catch (error) {
      this.logger.error('Error sending big order alert:', error);
    }
  }

  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(0)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  private formatNumberPadded(num: number): string {
    const formatted = this.formatNumber(num);
    return formatted.padStart(8);
  }

  private formatTokenAmount(amount: number): string {
    if (amount >= 1_000_000_000) {
      return `${(amount / 1_000_000_000).toFixed(1)}B`;
    } else if (amount >= 1_000_000) {
      return `${(amount / 1_000_000).toFixed(1)}M`;
    } else if (amount >= 1_000) {
      return `${(amount / 1_000).toFixed(1)}K`;
    } else {
      return amount.toFixed(0);
    }
  }

  private formatTime(date: Date): string {
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes} UTC`;
  }

  private truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  // Старые методы для обратной совместимости
  async sendSmartMoneyReport(report: SmartMoneyReport): Promise<void> {
    await this.sendTopInflowsReport(report);
  }

  async sendAlert(swap: TokenSwap, _walletInfo: WalletInfo, _tokenIsNew: boolean): Promise<void> {
    await this.sendIndividualPurchase(swap);
  }
}