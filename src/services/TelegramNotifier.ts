// src/services/TelegramNotifier.ts - ПОЛНАЯ ВЕРСИЯ + INSIDER DETECTOR + MULTIPROVIDER + ВСЕ МЕТОДЫ
import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport, InsiderAlert, SmartMoneyFlow, HotNewToken, SmartMoneySwap, PositionAggregation, ProviderStats, MultiProviderMetrics, PositionAggregationStats } from '../types';
import { Logger } from '../utils/Logger';

// 🎯 ИНТЕРФЕЙСЫ ДЛЯ ВСЕХ ТИПОВ АЛЕРТОВ
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

// 🆕 ИНТЕРФЕЙСЫ ДЛЯ INSIDER DETECTOR
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
    ageAtEntry: number;
  }>;
}

interface MoonshotTokenAlert {
  tokenAddress: string;
  tokenSymbol: string;
  currentPrice: number;
  multiplier: number;
  launchTime: Date;
  marketCap: number;
  earlyBuyers: Array<{
    address: string;
    entryPrice: number;
    positionSize: number;
  }>;
}

// 🆕 ИНТЕРФЕЙСЫ ДЛЯ MULTIPROVIDER
interface ProviderFailoverAlert {
  fromProvider: string;
  toProvider: string;
  reason: string;
  timestamp: Date;
  affectedRequests: number;
}

interface MultiProviderHealthReport {
  totalProviders: number;
  healthyProviders: number;
  primaryProvider: string;
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  cacheHitRate: number;
  providers: Array<{
    name: string;
    type: string;
    isHealthy: boolean;
    successRate: number;
    avgResponseTime: number;
    priority: number;
    requestCount: number;
    errorCount: number;
  }>;
}

export class TelegramNotifier {
  private bot: TelegramBot;
  private userId: string;
  private logger: Logger;
  private stats = {
    totalSent: 0,
    positionAlerts: 0,
    insiderAlerts: 0,
    smartMoneySwaps: 0,
    multiProviderReports: 0,
    errorsSent: 0,
    lastMessageTime: new Date()
  };

  constructor(token: string, userId: string) {
    this.bot = new TelegramBot(token, { polling: false });
    this.userId = userId;
    this.logger = Logger.getInstance();
  }

  // 🎯 POSITION SPLITTING ALERTS
  async sendPositionSplittingAlert(alert: PositionSplittingAlert): Promise<void> {
    try {
      const walletShort = this.truncateAddress(alert.walletAddress);
      const timeSpanText = this.formatTimeSpan(alert.timeWindowMinutes);
      const riskLevel = this.determineRiskLevel(alert.suspicionScore);
      const riskEmoji = this.getRiskEmoji(riskLevel);
      
      const purchaseGroups = this.groupSimilarPurchases(alert.purchases);
      const topGroup = purchaseGroups[0];
      
      let message = `${riskEmoji}🎯🚨 <b>POSITION SPLITTING DETECTED</b> 🚨🎯

💰 <b>Total:</b> <code>$${this.formatNumber(alert.totalUSD)}</code> in <code>${alert.purchaseCount}</code> purchases
🪙 <b>Token:</b> <code>#${alert.tokenSymbol}</code>
👤 <b>Wallet:</b> <code>${walletShort}</code>
⏱️ <b>Time span:</b> <code>${timeSpanText}</code>
🎯 <b>Risk Level:</b> ${riskEmoji} <code>${riskLevel}</code>
📊 <b>Suspicion Score:</b> <code>${alert.suspicionScore}/100</code>

💡 <b>Pattern Analysis:</b>
• Average size: <code>$${this.formatNumber(alert.avgPurchaseSize)}</code>
• Size tolerance: <code>${alert.sizeTolerance.toFixed(2)}%</code>
• Similar purchases: <code>${topGroup?.count || 0}/${alert.purchaseCount}</code>
• Group avg: <code>$${this.formatNumber(topGroup?.avgAmount || 0)}</code>

<a href="https://solscan.io/account/${alert.walletAddress}">Wallet</a> | <a href="https://solscan.io/token/${alert.tokenAddress}">Token</a> | <a href="https://dexscreener.com/solana/${alert.tokenAddress}">Chart</a>

<code>#PositionSplitting #InsiderAlert #Solana #${riskLevel}Risk</code>`;

      await this.sendMessage(message);
      this.stats.positionAlerts++;

      if (alert.purchaseCount >= 5) {
        await this.sendDetailedPurchaseBreakdown(alert);
      }

      this.logger.info(`🎯 Position splitting alert sent: ${alert.tokenSymbol} - $${alert.totalUSD} in ${alert.purchaseCount} purchases`);
    } catch (error) {
      this.logger.error('Error sending position splitting alert:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 INSIDER DETECTOR METHODS
  async sendInsiderDetectionReport(insiders: InsiderCandidate[]): Promise<void> {
    try {
      if (insiders.length === 0) return;

      let message = `🕵️ <b>INSIDER DETECTION REPORT</b>\n\n`;
      message += `Found <code>${insiders.length}</code> potential insiders:\n\n`;

      for (const insider of insiders.slice(0, 10)) {
        const avgMultiplier = insider.successfulMoonshots.length > 0 ? 
          insider.successfulMoonshots.reduce((sum, ms) => sum + ms.multiplier, 0) / insider.successfulMoonshots.length : 0;
        
        message += `🎯 <code>${insider.address.slice(0, 8)}...${insider.address.slice(-4)}</code>\n`;
        message += `📊 Score: <code>${insider.insiderScore}/100</code>\n`;
        message += `🚀 Moonshots: <code>${insider.moonshotCount}</code>\n`;
        message += `⚡ Early Entry: <code>${insider.earlyEntryRate.toFixed(0)}%</code>\n`;
        message += `💎 Avg x<code>${avgMultiplier.toFixed(0)}</code>\n`;
        message += `💰 Est. Profit: <code>$${(insider.totalProfit/1000).toFixed(0)}K</code>\n`;
        message += `<a href="https://solscan.io/account/${insider.address}">View</a>\n\n`;
      }

      message += `🎯 <b>Consider adding these to Smart Money monitoring!</b>`;

      await this.sendMessage(message);
      this.stats.insiderAlerts++;
      this.logger.info(`✅ Sent insider report with ${insiders.length} candidates`);

    } catch (error) {
      this.logger.error('Error sending insider report:', error);
      this.stats.errorsSent++;
    }
  }

  async sendMoonshotTokenAlert(moonshot: MoonshotTokenAlert): Promise<void> {
    try {
      const ageText = this.formatTimeAgo(moonshot.launchTime);
      
      let message = `🚀💎 <b>MOONSHOT TOKEN DETECTED</b> 💎🚀

🪙 <b>Token:</b> <code>#${moonshot.tokenSymbol}</code>
📈 <b>Multiplier:</b> <code>x${moonshot.multiplier.toFixed(0)}</code>
💰 <b>Current Price:</b> <code>$${moonshot.currentPrice.toFixed(8)}</code>
🕒 <b>Age:</b> <code>${ageText}</code>
💎 <b>Market Cap:</b> <code>$${this.formatNumber(moonshot.marketCap)}</code>

👥 <b>Early Buyers (${moonshot.earlyBuyers.length}):</b>\n`;

      for (const buyer of moonshot.earlyBuyers.slice(0, 5)) {
        const profit = (moonshot.currentPrice - buyer.entryPrice) * buyer.positionSize;
        message += `• <code>${buyer.address.slice(0, 6)}...</code> $${this.formatNumber(buyer.positionSize)} → $${this.formatNumber(profit)} profit\n`;
      }

      message += `\n<a href="https://solscan.io/token/${moonshot.tokenAddress}">Token</a> | <a href="https://dexscreener.com/solana/${moonshot.tokenAddress}">Chart</a>

<code>#MoonshotAlert #InsiderOpportunity #Solana</code>`;

      await this.sendMessage(message);
      this.stats.insiderAlerts++;

    } catch (error) {
      this.logger.error('Error sending moonshot alert:', error);
      this.stats.errorsSent++;
    }
  }

  async sendAutoAddedInsiderNotification(insider: InsiderCandidate, addedCount: number): Promise<void> {
    try {
      const avgMultiplier = insider.successfulMoonshots.length > 0 ? 
        insider.successfulMoonshots.reduce((sum, ms) => sum + ms.multiplier, 0) / insider.successfulMoonshots.length : 0;

      let message = `🤖✅ <b>AUTO-ADDED INSIDER TO SMART MONEY</b>

👤 <b>Wallet:</b> <code>${insider.address.slice(0, 8)}...${insider.address.slice(-4)}</code>
🎯 <b>Insider Score:</b> <code>${insider.insiderScore}/100</code>
🚀 <b>Moonshots:</b> <code>${insider.moonshotCount}</code>
💎 <b>Avg Multiplier:</b> <code>x${avgMultiplier.toFixed(0)}</code>
💰 <b>Total Profit:</b> <code>$${this.formatNumber(insider.totalProfit)}</code>
⚡ <b>Early Entry Rate:</b> <code>${insider.earlyEntryRate.toFixed(0)}%</code>

📊 <b>Added to Smart Money monitoring as Sniper category</b>
🔄 <b>Total auto-added this cycle:</b> <code>${addedCount}</code>

<a href="https://solscan.io/account/${insider.address}">View Wallet</a>

<code>#AutoAddedInsider #SmartMoney #Discovery</code>`;

      await this.sendMessage(message);
      this.stats.insiderAlerts++;

    } catch (error) {
      this.logger.error('Error sending auto-added insider notification:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 POSITION AGGREGATION STATS
  async sendPositionAggregationStatsReport(stats: PositionAggregationStats): Promise<void> {
    try {
      let message = `🎯 <b>Position Aggregation Statistics Report</b>\n\n`;
      message += `📊 <b>Total Detected Positions:</b> <code>${stats.totalPositions}</code>\n`;
      message += `🚨 <b>High Suspicion (75+):</b> <code>${stats.highSuspicionPositions}</code>\n`;
      message += `💰 <b>Total Value:</b> <code>$${this.formatNumber(stats.totalValueUSD)}</code>\n`;
      message += `📈 <b>Avg Suspicion Score:</b> <code>${stats.avgSuspicionScore.toFixed(1)}</code>\n\n`;
      
      message += `📋 <b>Processing Status:</b>\n`;
      message += `⏳ Unprocessed: <code>${stats.unprocessedPositions}</code>\n`;
      message += `✅ Alerts sent: <code>${stats.alertsSent}</code>\n\n`;
      
      message += `⚠️ <b>Risk Distribution:</b>\n`;
      message += `🔴 High: <code>${stats.riskDistribution.high}</code>\n`;
      message += `🟡 Medium: <code>${stats.riskDistribution.medium}</code>\n`;
      message += `🟢 Low: <code>${stats.riskDistribution.low}</code>\n\n`;

      message += `🏆 <b>Top Wallets by Positions:</b>\n`;
      stats.topWalletsByPositions.slice(0, 5).forEach((wallet, i) => {
        message += `<code>${i + 1}.</code> <code>${wallet.walletAddress.slice(0, 8)}...${wallet.walletAddress.slice(-4)}</code> - <code>${wallet.positionCount}</code> positions, <code>$${this.formatNumber(wallet.totalValueUSD)}</code>\n`;
      });

      message += `\n<code>#PositionAggregation #SuspiciousActivity #Analytics</code>`;

      await this.sendMessage(message);
      this.stats.positionAlerts++;

    } catch (error) {
      this.logger.error('Error sending position aggregation stats:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 MULTIPROVIDER METHODS
  async sendMultiProviderHealthReport(report: MultiProviderHealthReport): Promise<void> {
    try {
      let message = `🌐 <b>MultiProvider Health Report</b>\n\n`;
      message += `📊 <b>Overview:</b>\n`;
      message += `• Total Providers: <code>${report.totalProviders}</code>\n`;
      message += `• Healthy: <code>${report.healthyProviders}/${report.totalProviders}</code>\n`;
      message += `• Primary: <code>${report.primaryProvider}</code>\n`;
      message += `• Success Rate: <code>${report.successRate.toFixed(1)}%</code>\n`;
      message += `• Avg Response: <code>${report.avgResponseTime.toFixed(0)}ms</code>\n`;
      message += `• Cache Hit Rate: <code>${report.cacheHitRate.toFixed(1)}%</code>\n\n`;

      message += `🏥 <b>Provider Status:</b>\n`;
      for (const provider of report.providers) {
        const statusEmoji = provider.isHealthy ? '✅' : '❌';
        const priorityStars = '⭐'.repeat(provider.priority);
        message += `${statusEmoji} <code>${provider.name}</code> ${priorityStars}\n`;
        message += `   Success: <code>${provider.successRate.toFixed(1)}%</code> | Response: <code>${provider.avgResponseTime.toFixed(0)}ms</code>\n`;
        message += `   Requests: <code>${provider.requestCount}</code> | Errors: <code>${provider.errorCount}</code>\n\n`;
      }

      message += `<code>#MultiProvider #HealthReport #Infrastructure</code>`;

      await this.sendMessage(message);
      this.stats.multiProviderReports++;

    } catch (error) {
      this.logger.error('Error sending MultiProvider health report:', error);
      this.stats.errorsSent++;
    }
  }

  async sendProviderFailoverAlert(alert: ProviderFailoverAlert): Promise<void> {
    try {
      let message = `🔄⚠️ <b>PROVIDER FAILOVER ALERT</b> ⚠️🔄

🚨 <b>Switched Provider:</b> <code>${alert.fromProvider}</code> → <code>${alert.toProvider}</code>
🕒 <b>Time:</b> <code>${alert.timestamp.toLocaleTimeString()}</code>
❌ <b>Reason:</b> <code>${alert.reason}</code>
📊 <b>Affected Requests:</b> <code>${alert.affectedRequests}</code>

🔧 <b>System automatically switched to backup provider</b>
✅ <b>Service continuity maintained</b>

<code>#ProviderFailover #SystemAlert #Infrastructure</code>`;

      await this.sendMessage(message);
      this.stats.multiProviderReports++;

    } catch (error) {
      this.logger.error('Error sending provider failover alert:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 ENHANCED CYCLE LOG WITH MULTIPROVIDER STATS
  async sendEnhancedCycleLogWithMultiProvider(
    message: string, 
    multiProviderMetrics?: MultiProviderMetrics,
    positionStats?: { activePositions: number; totalDetected: number; alertsSent: number }
  ): Promise<void> {
    try {
      let enhancedMessage = message;

      if (multiProviderMetrics) {
        enhancedMessage += `\n\n🌐 <b>MultiProvider Status:</b>\n`;
        enhancedMessage += `• Primary: <code>${multiProviderMetrics.primaryProvider}</code>\n`;
        enhancedMessage += `• Healthy: <code>${multiProviderMetrics.healthyProviders}/${multiProviderMetrics.totalProviders}</code>\n`;
        enhancedMessage += `• Success Rate: <code>${((multiProviderMetrics.successfulRequests / multiProviderMetrics.totalRequests) * 100).toFixed(1)}%</code>\n`;
        enhancedMessage += `• Avg Response: <code>${multiProviderMetrics.avgResponseTime.toFixed(0)}ms</code>\n`;
        enhancedMessage += `• Cache Hit Rate: <code>${multiProviderMetrics.cacheHitRate.toFixed(1)}%</code>\n`;
        enhancedMessage += `• Failovers: <code>${multiProviderMetrics.failovers}</code>\n`;
      }

      if (positionStats) {
        enhancedMessage += `\n🎯 <b>Position Monitoring:</b>\n`;
        enhancedMessage += `• Active: <code>${positionStats.activePositions}</code>\n`;
        enhancedMessage += `• Detected: <code>${positionStats.totalDetected}</code>\n`;
        enhancedMessage += `• Alerts: <code>${positionStats.alertsSent}</code>\n`;
      }

      await this.sendMessage(enhancedMessage);
      this.stats.multiProviderReports++;

    } catch (error) {
      this.logger.error('Error sending enhanced cycle log:', error);
      this.stats.errorsSent++;
    }
  }

  // СУЩЕСТВУЮЩИЕ МЕТОДЫ (сохранены без изменений)
  async sendSmartMoneySwap(swap: SmartMoneySwap): Promise<void> {
    try {
      const categoryEmoji = this.getCategoryEmoji(swap.category);
      const walletShort = this.truncateAddress(swap.walletAddress);

      const message = `${categoryEmoji}💚 <b>$${this.formatNumber(swap.amountUSD)}</b> 💚 <code>${this.formatTokenAmount(swap.tokenAmount)} #${swap.tokenSymbol}</code> <code>($${(swap.amountUSD / swap.tokenAmount).toFixed(6)})</code> <code>#${walletShort}</code> <b>WR:</b> <code>${swap.winRate.toFixed(2)}%</code> <b>PNL:</b> <code>$${this.formatNumber(swap.pnl)}</code> <b>TT:</b> <code>${swap.totalTrades}</code> <a href="https://solscan.io/token/${swap.tokenAddress}">SolS</a> <a href="https://dexscreener.com/solana/${swap.tokenAddress}">DS</a>

<a href="https://solscan.io/account/${swap.walletAddress}">Wallet</a> <a href="https://solscan.io/tx/${swap.transactionId}">TXN</a> <code>#SmartSwapSol</code>

<code>${swap.walletAddress}</code>`;

      await this.sendMessage(message);
      this.stats.smartMoneySwaps++;
      this.logger.info(`Smart Money swap sent: ${swap.tokenSymbol} - $${swap.amountUSD}`);
    } catch (error) {
      this.logger.error('Error sending smart money swap:', error);
      this.stats.errorsSent++;
    }
  }

  async sendTopSmartMoneyInflows(inflows: SmartMoneyFlow[]): Promise<void> {
    try {
      const message = `💚 <b>Top Smart Money Inflows in the past 1 hour (Solana)</b> <code>#TopSMIn1sol</code>\n\n${
        inflows.slice(0, 5).map(flow =>
          `<code>#${flow.tokenSymbol}</code> <b>$${this.formatNumber(flow.totalInflowUSD)}</b> <a href="https://solscan.io/token/${flow.tokenAddress}">SolS</a> <a href="https://dexscreener.com/solana/${flow.tokenAddress}">DS</a>`
        ).join('\n')
      }`;

      await this.sendMessage(message);
      this.logger.info(`Top Smart Money Inflows sent: ${inflows.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending top smart money inflows:', error);
      this.stats.errorsSent++;
    }
  }

  async sendHotNewTokenAlert(hotToken: HotNewToken): Promise<void> {
    try {
      const ageText = hotToken.ageHours < 1 
        ? `${Math.round(hotToken.ageHours * 60)}m` 
        : `${Math.round(hotToken.ageHours)}h`;

      const message = `🔥💎 <b>Hot New Token on Smart Money (Solana)</b> <code>FDV #HotNTSMsol</code>

<code>#${hotToken.symbol}</code> <b>FDV:</b> <code>$${this.formatNumber(hotToken.fdv)}</code> <b>SH:</b> <code>$${this.formatNumber(hotToken.smStakeUSD)}</code> <b>Age:</b> <code>${ageText}</code> <b>Buy:</b> <code>$${this.formatNumber(hotToken.buyVolumeUSD)} (${hotToken.buyCount})</code> <b>Sell:</b> <code>$${this.formatNumber(hotToken.sellVolumeUSD)} (${hotToken.sellCount})</code> <a href="https://solscan.io/token/${hotToken.address}">SolS</a> <a href="https://dexscreener.com/solana/${hotToken.address}">DS</a>`;

      await this.sendMessage(message);
      this.logger.info(`Hot New Token alert sent: ${hotToken.symbol} - $${hotToken.smStakeUSD}`);
    } catch (error) {
      this.logger.error('Error sending hot new token alert:', error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.logger.info(`Token Name Alert sent: ${tokenData.tokenName}`);
    } catch (error) {
      this.logger.error('Error sending token name alert:', error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.logger.info(`Smart Money ${typeText} ${period} summary sent: ${flows.length} tokens`);
    } catch (error) {
      this.logger.error(`Error sending ${type} summary:`, error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.logger.info(`Hot New Tokens by Wallets sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by wallets:', error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.logger.info(`Hot New Tokens by Age sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by age:', error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.logger.info(`Hot New Tokens by FDV sent: ${tokens.length} tokens`);
    } catch (error) {
      this.logger.error('Error sending hot new tokens by FDV:', error);
      this.stats.errorsSent++;
    }
  }

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

✅ <b>Newly Added:</b> <code>${stats.newlyAdded}</code>
❌ <b>Deactivated:</b> <code>${stats.deactivated}</code>

<i>Next update in 48 hours</i>`;

      await this.sendMessage(message);
      this.logger.info(`Wallet Database Stats sent: ${stats.active} active wallets`);
    } catch (error) {
      this.logger.error('Error sending wallet database stats:', error);
      this.stats.errorsSent++;
    }
  }

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

      await this.sendMessage(message);
      this.stats.insiderAlerts++;
      this.logger.info(`Insider alert sent: ${alert.tokenSymbol} - $${amountUSD}`);
    } catch (error) {
      this.logger.error('Error sending insider alert:', error);
      this.stats.errorsSent++;
    }
  }

  async sendCycleLog(message: string): Promise<void> {
    try {
      await this.sendMessage(message);
    } catch (error) {
      this.logger.error('Error sending cycle log:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 DETAILED PURCHASE BREAKDOWN
  private async sendDetailedPurchaseBreakdown(alert: PositionSplittingAlert): Promise<void> {
    try {
      const sortedPurchases = alert.purchases.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      let breakdown = `📊 <b>Detailed Purchase Breakdown</b>\n\n`;
      breakdown += `🎯 <b>Token:</b> <code>#${alert.tokenSymbol}</code>\n`;
      breakdown += `👤 <b>Wallet:</b> <code>${this.truncateAddress(alert.walletAddress)}</code>\n\n`;

      sortedPurchases.forEach((purchase, index) => {
        const timeStr = this.formatTime(purchase.timestamp);
        breakdown += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <b>$${this.formatNumber(purchase.amountUSD)}</b> at <code>${timeStr}</code>\n`;
      });

      const groups = this.groupSimilarPurchases(alert.purchases);
      if (groups.length > 1) {
        breakdown += `\n🔍 <b>Similar Amount Groups:</b>\n`;
        groups.forEach((group, index) => {
          breakdown += `<code>${index + 1}.</code> <code>${group.count}x</code> ~<b>$${this.formatNumber(group.avgAmount)}</b> (±${group.tolerance.toFixed(1)}%)\n`;
        });
      }

      breakdown += `\n<code>#PurchaseBreakdown</code>`;

      await this.sendMessage(breakdown);

    } catch (error) {
      this.logger.error('Error sending detailed purchase breakdown:', error);
      this.stats.errorsSent++;
    }
  }

  // UTILITY METHODS
  private async sendMessage(message: string): Promise<void> {
    await this.bot.sendMessage(this.userId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    this.stats.totalSent++;
    this.stats.lastMessageTime = new Date();
  }

  private groupSimilarPurchases(purchases: Array<{amountUSD: number; timestamp: Date; transactionId: string}>): Array<{
    count: number;
    avgAmount: number;
    tolerance: number;
    amounts: number[];
  }> {
    const tolerance = 2.0;
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

    return groups.sort((a, b) => b.count - a.count);
  }

  private formatTimeSpan(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
  }

  private formatTimeAgo(date: Date): string {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours < 1) {
      return `${Math.round(diffHours * 60)}m ago`;
    } else if (diffHours < 24) {
      return `${Math.round(diffHours)}h ago`;
    } else {
      return `${Math.round(diffHours / 24)}d ago`;
    }
  }

  private determineRiskLevel(suspicionScore: number): string {
    if (suspicionScore >= 90) return 'CRITICAL';
    if (suspicionScore >= 80) return 'HIGH';
    if (suspicionScore >= 70) return 'MEDIUM';
    return 'LOW';
  }

  private getRiskEmoji(riskLevel: string): string {
    switch (riskLevel) {
      case 'CRITICAL': return '🔴🚨';
      case 'HIGH': return '🔴';
      case 'MEDIUM': return '🟡';
      case 'LOW': return '🟢';
      default: return '⚪';
    }
  }

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

  // 🆕 GET STATS
  getNotificationStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.lastMessageTime.getTime(),
      avgMessagesPerHour: this.stats.totalSent / Math.max(1, (Date.now() - this.stats.lastMessageTime.getTime()) / (1000 * 60 * 60)),
      errorRate: this.stats.totalSent > 0 ? (this.stats.errorsSent / this.stats.totalSent * 100).toFixed(2) + '%' : '0%'
    };
  }
}