// src/services/TelegramNotifier.ts - ИСПРАВЛЕНО все ошибки
import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport, InsiderAlert, SmartMoneyFlow, HotNewToken, SmartMoneySwap } from '../types';
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

  // Улучшенный метод для отправки Smart Money свапов
  async sendSmartMoneySwap(swap: SmartMoneySwap): Promise<void> {
    try {
      const categoryEmoji = this.getCategoryEmoji(swap.category);
      const familyText = swap.isFamilyMember ? ` <b>Family:</b> <code>${swap.familySize}</code>` : '';
      const walletShort = this.truncateAddress(swap.walletAddress);

      const message = `${categoryEmoji}💚 <b>$${this.formatNumber(swap.amountUSD)}</b> 💚 <code>${this.formatTokenAmount(swap.tokenAmount)} #${swap.tokenSymbol}</code> <code>($${(swap.amountUSD / swap.tokenAmount).toFixed(6)})</code> <code>#${walletShort}</code> <b>WR:</b> <code>${swap.winRate.toFixed(2)}%</code> <b>PNL:</b> <code>$${this.formatNumber(swap.pnl)}</code> <b>TT:</b> <code>${swap.totalTrades}</code>${familyText} <a href="https://solscan.io/token/${swap.tokenAddress}">SolS</a> <a href="https://dexscreener.com/solana/${swap.tokenAddress}">DS</a>

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

  // Метод для отправки уведомлений о семейных кошельках
  async sendFamilyWalletAlert(familyData: {
    id: string;
    wallets: string[];
    suspicionScore: number;
    detectionMethod: string;
    totalPnL: number;
    coordinationScore: number;
  }): Promise<void> {
    try {
      const message = `🔗👥 <b>Family Wallet Detected</b> <code>#FamilyWallet</code>

<b>Cluster ID:</b> <code>${familyData.id}</code>
<b>Wallets:</b> <code>${familyData.wallets.length}</code>
<b>Suspicion Score:</b> <code>${familyData.suspicionScore}/100</code>
<b>Detection Method:</b> <code>${familyData.detectionMethod}</code>
<b>Combined PnL:</b> <code>$${this.formatNumber(familyData.totalPnL)}</code>
<b>Coordination:</b> <code>${familyData.coordinationScore.toFixed(1)}%</code>

<b>Wallets:</b>
${familyData.wallets.slice(0, 5).map(wallet => 
  `<code>${this.truncateAddress(wallet)}</code>`
).join('\n')}`;

      await this.bot.sendMessage(this.userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.logger.info(`Family Wallet Alert sent: ${familyData.wallets.length} wallets`);
    } catch (error) {
      this.logger.error('Error sending family wallet alert:', error);
    }
  }

  // Метод для отправки статистики базы Smart Money кошельков
  async sendWalletDatabaseStats(stats: {
    total: number;
    active: number;
    byCategory: Record<string, number>;
    familyMembers: number;
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

👥 <b>Family Members:</b> <code>${stats.familyMembers}</code>
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