import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport } from '../types';
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

  // Особый алерт для ОЧЕНЬ крупных ордеров > $10,000
  async sendBigOrderAlert(swap: TokenSwap, walletInfo: WalletInfo): Promise<void> {
    try {
      const walletStatus = swap.isNewWallet ? '🆕 НОВЫЙ' : '♻️ РЕАКТИВИРОВАН';
      const walletAge = swap.isNewWallet ? 
        `Создан ${swap.walletAge} часов назад` : 
        `Неактивен ${swap.daysSinceLastActivity} дней`;
      
      // Показываем связанные кошельки если есть
      const relatedWallets = walletInfo.relatedWallets && walletInfo.relatedWallets.length > 0 ?
        `\n\n🔗 <b>Связанные кошельки:</b>\n${walletInfo.relatedWallets.map(w => `• ${this.truncateAddress(w)}`).join('\n')}` : '';
      
      const message = `
🚨🚨🚨 <b>КРУПНЫЙ ОРДЕР НА $${this.formatNumber(swap.amountUSD)}!</b> 🚨🚨🚨

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

      this.logger.info(`Big order alert sent for ${swap.tokenSymbol} - $${swap.amountUSD}`);

    } catch (error) {
      this.logger.error('Error sending big order alert:', error);
      throw error;
    }
  }

  // Индивидуальный алерт для всех покупок > $2,000
  async sendIndividualBuyAlert(swap: TokenSwap, _walletInfo: WalletInfo): Promise<void> {
    try {
      const walletType = swap.isNewWallet ? '🆕 NEW WALLET' : 
                        swap.isReactivatedWallet ? '♻️ REACTIVATED' : '👤 SMART MONEY';
      
      const walletDetails = swap.isNewWallet ? 
        `(${swap.walletAge}h old)` : 
        swap.isReactivatedWallet ? 
        `(inactive ${swap.daysSinceLastActivity}d)` : '';
      
      const message = `
💰 <b>Large Buy Alert</b>

${walletType} ${walletDetails}
<b>Wallet:</b> <code>${swap.walletAddress}</code>
<b>Bought:</b> ${swap.tokenSymbol}
<b>Amount:</b> $${this.formatNumber(swap.amountUSD)}
<b>DEX:</b> ${swap.dex}

<a href="https://solscan.io/account/${swap.walletAddress}">View Wallet</a> | <a href="https://birdeye.so/token/${swap.tokenAddress}">View Token</a>
`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Individual buy alert sent: ${swap.tokenSymbol} - $${swap.amountUSD}`);

    } catch (error) {
      this.logger.error('Error sending individual buy alert:', error);
    }
  }

  // Агрегированный отчет по умным деньгам
  async sendSmartMoneyReport(report: SmartMoneyReport): Promise<void> {
    try {
      let message = `
💰 <b>Top Smart Money Inflows in the past ${report.period} (Solana)</b>
━━━━━━━━━━━━━━━━━━━━━━━━

`;

      // Показываем только токены с суммой > $2000
      const filteredTokens = report.tokenAggregations
        .filter(agg => agg.totalVolumeUSD >= 2000);

      if (filteredTokens.length === 0) {
        message += `No tokens with smart money inflows > $2000 in this period.`;
      } else {
        for (const agg of filteredTokens) {
          const emoji = agg.isNewToken ? '🔥' : '';
          message += `#${agg.tokenSymbol} $${this.formatNumber(agg.totalVolumeUSD)} ${emoji}\n`;
        }
      }

      message += `
━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Summary:</b>
• Total Volume: $${this.formatNumber(report.totalVolumeUSD)}
• Unique Tokens: ${filteredTokens.length}
• Large Orders (>$10k): ${report.bigOrders.length}
`;

      // Добавляем детали по топ-3 токенам
      if (filteredTokens.length > 0) {
        message += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n📈 <b>Top 3 Token Details:</b>\n`;
        
        for (const agg of filteredTokens.slice(0, 3)) {
          message += `
<b>${agg.tokenSymbol}</b>
• Volume: $${this.formatNumber(agg.totalVolumeUSD)}
• Unique Wallets: ${agg.uniqueWallets.size}
• Transactions: ${agg.transactions.length}
• Biggest Buy: $${this.formatNumber(agg.biggestPurchase?.amountUSD || 0)}
`;
        }
      }

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Smart money report sent with ${filteredTokens.length} tokens`);

    } catch (error) {
      this.logger.error('Error sending smart money report:', error);
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

  // Старый метод для обратной совместимости
  async sendAlert(swap: TokenSwap, walletInfo: WalletInfo, tokenIsNew: boolean): Promise<void> {
    try {
      let alertType = '';
      let walletStatus = '';

      if (swap.isNewWallet) {
        alertType = '🆕 New Wallet Activity';
        walletStatus = `Created ${swap.walletAge} hours ago`;
      } else if (swap.isReactivatedWallet) {
        alertType = '♻️ Reactivated Wallet';
        walletStatus = `Inactive for ${swap.daysSinceLastActivity} days`;
      }

      const tokenStatus = tokenIsNew ? '🔥 NEW TOKEN' : '';
      const relatedWallets = walletInfo.relatedWallets && walletInfo.relatedWallets.length > 0 ?
        `\n\n🔗 <b>Related Wallets:</b>\n${walletInfo.relatedWallets.map(w => `• ${this.truncateAddress(w)}`).join('\n')}` : '';

      const message = `
🚨 <b>${alertType}</b>

💳 <b>Wallet:</b> <code>${swap.walletAddress}</code>
${walletStatus}

💰 <b>Purchased:</b> ${this.formatNumber(swap.amount)} ${swap.tokenSymbol} ${tokenStatus}
💵 <b>Value:</b> ~$${this.formatNumber(swap.amountUSD)}
📍 <b>Token:</b> ${swap.tokenName}
📎 <b>Address:</b> <code>${swap.tokenAddress}</code>
🏪 <b>DEX:</b> ${swap.dex}
⏰ <b>Time:</b> ${swap.timestamp.toUTCString()}
${relatedWallets}

🔍 <a href="https://solscan.io/account/${swap.walletAddress}">View on Solscan</a>
📊 <a href="https://birdeye.so/token/${swap.tokenAddress}">View Token</a>
`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Alert sent for wallet ${swap.walletAddress}`);

    } catch (error) {
      this.logger.error('Error sending alert:', error);
      throw error;
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(0)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  private truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}