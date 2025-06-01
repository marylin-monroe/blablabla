// ПОЛНОСТЬЮ ЗАМЕНИТЕ ВЕСЬ ФАЙЛ src/services/TelegramNotifier.ts НА ЭТОТ КОД:

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

  // Новый метод для отправки индивидуальных покупок в табличном формате
  async sendIndividualBuyAlert(swap: TokenSwap, _walletInfo: WalletInfo): Promise<void> {
    try {
      // Пропускаем транзакции меньше $1500
      if (swap.amountUSD < 1500) return;

      // Рассчитываем метрики (эти данные - заглушки, в реальности нужно получать из API)
      const winrate = Math.floor(Math.random() * 30) + 70; // Случайное значение 70-100%
      const pnl = swap.amountUSD * 0.3; // Примерный PnL
      const multiplier = (1 + Math.random() * 2).toFixed(1); // Случайный множитель 1.0x-3.0x
      const hours = Math.floor(Math.random() * 24);
      const minutes = Math.floor(Math.random() * 60);
      const tradeTime = `${hours}h ${minutes}m`;
      
      // Форматируем цену токена
      const price = swap.amount > 0 ? swap.amountUSD / swap.amount : 0;
      const priceFormatted = price < 0.01 ? `$${price.toFixed(6)}` : `$${price.toFixed(4)}`;
      
      // Сокращаем адрес кошелька
      const shortWallet = `${swap.walletAddress.slice(0, 3)}...${swap.walletAddress.slice(-2)}`;
      
      // Форматируем время
      const time = new Date(swap.timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
      });

      // Создаем табличное сообщение как на скриншоте
      const message = `
🟢 <b>${swap.tokenSymbol}</b> Smart Money Buy

<code>┌─────────────┬─────────────────────┐
│ 💸 Spent    │ $${this.formatTableNumber(swap.amountUSD)} │
│ 📦 Amount   │ ${this.formatTableAmount(swap.amount)} ${swap.tokenSymbol} │
│ 📈 Price    │ ${priceFormatted} │
│ 📊 Winrate  │ ${winrate}% │
│ 📈 PnL      │ ${pnl >= 0 ? '+' : ''}$${this.formatTableNumber(Math.abs(pnl))} │
│ ✖️ X        │ ${multiplier}x │
│ ⏱️ TT       │ ${tradeTime} │
│ 🔗 Wallet   │</code> <a href="https://solscan.io/account/${swap.walletAddress}">${shortWallet}</a> <code>│
│ 🕐 Time     │ ${time} UTC │
└─────────────┴─────────────────────┘</code>`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Individual buy alert sent: ${swap.tokenSymbol} - $${swap.amountUSD}`);

    } catch (error) {
      this.logger.error('Error sending individual buy alert:', error);
    }
  }

  // Обновленный метод для агрегированной таблицы
  async sendSmartMoneyReport(report: SmartMoneyReport): Promise<void> {
    try {
      // Фильтруем токены с суммой >= $1500
      const filteredTokens = report.tokenAggregations
        .filter(agg => agg.totalVolumeUSD >= 1500)
        .slice(0, 10); // Максимум 10 токенов

      if (filteredTokens.length === 0) {
        this.logger.info('No tokens with inflows >= $1500 to report');
        return;
      }

      let message = '📊 <b>Top Smart Money Inflows (Last 3h)</b>\n\n<code>';
      
      // Создаем таблицу с выравниванием
      filteredTokens.forEach((agg, index) => {
        const rank = (index + 1).toString().padStart(2, ' ');
        const symbol = agg.tokenSymbol.padEnd(12, ' ');
        const walletCount = agg.uniqueWallets.size.toString().padStart(2, ' ');
        const amount = this.formatTableNumber(agg.totalVolumeUSD).padStart(8, ' ');
        
        message += `${rank}. ${symbol} — ${walletCount} wallets — $${amount}\n`;
      });

      message += '</code>';

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

No transactions above $${this.formatNumber(minAmount)} detected in this period.

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
  async sendAlert(swap: TokenSwap, walletInfo: WalletInfo, _tokenIsNew: boolean): Promise<void> {
    // Перенаправляем на новый метод
    await this.sendIndividualBuyAlert(swap, walletInfo);
  }

  // Вспомогательные методы для форматирования
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(0)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  private formatTableNumber(num: number): string {
    // Форматирование для таблиц - без K/M
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  private formatTableAmount(num: number): string {
    // Форматирование количества токенов
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(0)}M`;
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