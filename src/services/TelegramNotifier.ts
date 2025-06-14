// src/services/TelegramNotifier.ts - ПОЛНАЯ ВЕРСИЯ + WHALE ALERTS + ИСПРАВЛЕНЫ АДРЕСА ТОКЕНОВ + ВСЕ МЕТОДЫ
import TelegramBot from 'node-telegram-bot-api';
import { TokenSwap, WalletInfo, SmartMoneyReport, InsiderAlert, SmartMoneyFlow, HotNewToken, SmartMoneySwap, PositionAggregation, ProviderStats, MultiProviderMetrics, PositionAggregationStats } from '../types';
import { Logger } from '../utils/Logger';
import { WhaleAlert } from '../types/WhaleTypes';


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

// 🆕 ИНТЕРФЕЙСЫ ДЛЯ TELEGRAM КОМАНД
interface StatsData {
  walletStats: any;
  dbStats: any;
  pollingStats: any;
  aggregationStats: any;
  loaderStats: any;
  notificationStats: any;
  whaleStats?: any; // 🆕 ДОБАВЛЕНЫ СТАТИСТИКИ КИТОВ
  webhookMode: 'polling' | 'webhook';
  uptime: number;
}

interface WalletsData {
  wallets: any[];
  stats: any;
  totalCount: number;
}

interface TopTokenData {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  volume24h: number;
  swapCount: number;
  uniqueWallets: number;
  priceChange24h: number;
}

interface PositionsData {
  totalPositions: number;
  highSuspicionPositions: number;
  totalValueUSD: number;
  avgSuspicionScore: number;
  activeMonitoring: number;
  detectedToday: number;
  alertsSentToday: number;
  riskDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  topWalletsByPositions: Array<{
    walletAddress: string;
    positionCount: number;
    totalValueUSD: number;
  }>;
}

interface DiscoveryData {
  totalAnalyzed: number;
  newWallets: number;
  updatedWallets: number;
  smartMoneyFound: number;
}

// 🆕 WHALE STATS INTERFACE
interface WhaleStatsData {
  totalScans: number;
  totalWhalesFound: number;
  validWhales: number;
  spamFiltered: number;
  notificationsSent: number;
  avgScanDuration: number;
  successRate: number;
  sourceStats: {
    dexScreener: { scans: number; candidates: number; validWhales: number; };
    jupiter: { scans: number; candidates: number; validWhales: number; };
  };
}

export class TelegramNotifier {
  private bot: TelegramBot;
  private userId: string;
  private logger: Logger;
  private commandHandlers: Map<string, () => Promise<void>> = new Map();
  private stats = {
    totalSent: 0,
    positionAlerts: 0,
    insiderAlerts: 0,
    smartMoneySwaps: 0,
    whaleAlerts: 0, // 🆕 ДОБАВЛЕНО
    multiProviderReports: 0,
    commandsProcessed: 0,
    errorsSent: 0,
    lastMessageTime: new Date()
  };

  constructor(token: string, userId: string) {
    // 🆕 ВКЛЮЧАЕМ POLLING ДЛЯ ОБРАБОТКИ КОМАНД
    this.bot = new TelegramBot(token, { polling: true });
    this.userId = userId;
    this.logger = Logger.getInstance();

    // 🆕 НАСТРОЙКА БАЗОВЫХ ОБРАБОТЧИКОВ
    this.setupBaseHandlers();
  }

  // 🆕 БАЗОВЫЕ ОБРАБОТЧИКИ
  private setupBaseHandlers(): void {
    this.bot.on('message', (msg) => {
      // Обрабатываем только сообщения от нужного пользователя
      if (msg.from?.id.toString() !== this.userId) {
        return;
      }

      // Обрабатываем только команды (начинающиеся с /)
      if (msg.text && msg.text.startsWith('/')) {
        const command = msg.text.split(' ')[0];
        const handler = this.commandHandlers.get(command);
        
        if (handler) {
          this.stats.commandsProcessed++;
          handler().catch(error => {
            this.logger.error(`Error handling command ${command}:`, error);
            this.sendCommandError(command.substring(1), error);
          });
        } else {
          // Неизвестная команда
          this.sendMessage(`❓ Неизвестная команда: <code>${command}</code>\n\nИспользуйте /help для списка доступных команд.`);
        }
      }
    });

    this.bot.on('polling_error', (error) => {
      this.logger.error('Telegram polling error:', error);
    });

    this.logger.info('🤖 Telegram base handlers setup completed');
  }

  // 🆕 НАСТРОЙКА ОБРАБОТЧИКОВ КОМАНД
  setupCommandHandlers(handlers: Record<string, () => Promise<void>>): void {
    for (const [command, handler] of Object.entries(handlers)) {
      this.commandHandlers.set(command, handler);
    }
    this.logger.info(`🤖 Registered ${Object.keys(handlers).length} command handlers`);
  }

  // 🆕 WHALE ALERT METHODS - ГЛАВНАЯ НОВАЯ ФУНКЦИЯ!
  async sendWhaleAlert(whale: WhaleAlert): Promise<void> {
    try {
      const walletShort = this.truncateAddress(whale.walletAddress);
      const ageText = this.formatTransactionAge(whale.timestamp);
      const riskEmoji = whale.validationScore >= 80 ? '✅' : whale.validationScore >= 60 ? '⚠️' : '🚨';
      
      // 🔥 ОПРЕДЕЛЯЕМ КАТЕГОРИЮ КИТА
      let whaleEmoji = '🐋';
      let categoryText = 'WHALE';
      
      if (whale.amountUSD >= 50_000_000) {
        whaleEmoji = '🐋👑';
        categoryText = 'ULTRA WHALE';
      } else if (whale.amountUSD >= 10_000_000) {
        whaleEmoji = '🐋💎';
        categoryText = 'MEGA WHALE';
      }

      let message = `${whaleEmoji}💎 <b>${categoryText} ALERT</b> 💎${whaleEmoji}\n\n`;
      message += `💰 <b>Amount:</b> <code>$${this.formatNumber(whale.amountUSD)}</code> ${whale.swapType.toUpperCase()}\n`;
      message += `🪙 <b>Token:</b> <code>#${whale.tokenSymbol}</code>\n`;
      message += `📍 <b>Token Address:</b> <code>${whale.tokenAddress}</code>\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
      message += `👤 <b>Wallet:</b> <code>${walletShort}</code>\n`;
      message += `⏰ <b>Age:</b> <code>${ageText}</code>\n`;
      message += `🏦 <b>DEX:</b> <code>${whale.dex}</code>\n`;
      message += `📊 <b>Source:</b> <code>${whale.source}</code>\n\n`;

      message += `🔍 <b>Validation</b> ${riskEmoji}\n`;
      message += `• <b>Score:</b> <code>${whale.validationScore}/100</code>\n`;
      if (whale.riskFlags.length > 0) {
        message += `• <b>Risk Flags:</b> <code>${whale.riskFlags.join(', ')}</code>\n`;
      }

      message += `\n<a href="https://solscan.io/tx/${whale.signature}">TXN</a> | `;
      message += `<a href="https://solscan.io/account/${whale.walletAddress}">Wallet</a> | `;
      message += `<a href="https://solscan.io/token/${whale.tokenAddress}">Token</a> | `;
      message += `<a href="https://dexscreener.com/solana/${whale.tokenAddress}">DS</a>\n\n`;

      message += `<code>#WhaleAlert #${whale.swapType.toUpperCase()}${whale.amountUSD >= 10_000_000 ? ' #MegaWhale' : ''}</code>`;

      await this.sendMessage(message);
      this.stats.whaleAlerts++;

      this.logger.info(`🐋 Whale alert sent: ${whale.tokenSymbol} - $${whale.amountUSD.toFixed(0)} (${whale.source})`);

    } catch (error) {
      this.logger.error('Error sending whale alert:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 WHALE SCAN SUMMARY
  async sendWhaleScanSummary(result: {
    totalFound: number;
    validWhales: number;
    spamFiltered: number;
    processedSources: string[];
    timeWindow: string;
  }): Promise<void> {
    try {
      if (result.validWhales === 0) return; // Не отправляем пустые отчеты
      
      let message = `🐋 <b>Whale Scan Summary</b>\n\n`;
      message += `📊 <b>Results:</b>\n`;
      message += `• <b>Total found:</b> <code>${result.totalFound}</code>\n`;
      message += `• <b>Valid whales:</b> <code>${result.validWhales}</code>\n`;
      message += `• <b>Spam filtered:</b> <code>${result.spamFiltered}</code>\n`;
      message += `• <b>Sources:</b> <code>${result.processedSources.join(', ')}</code>\n`;
      message += `• <b>Time window:</b> <code>${result.timeWindow}</code>\n\n`;
      
      const successRate = result.totalFound > 0 ? ((result.validWhales / result.totalFound) * 100).toFixed(1) : '0';
      message += `📈 <b>Success Rate:</b> <code>${successRate}%</code>\n\n`;
      
      message += `<code>#WhaleScanSummary #WhaleHunting</code>`;

      await this.sendMessage(message);
      this.stats.whaleAlerts++;

    } catch (error) {
      this.logger.error('Error sending whale scan summary:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 WHALE STATS RESPONSE
  async sendWhaleStatsResponse(stats: WhaleStatsData): Promise<void> {
    try {
      let message = `🐋 <b>Whale Detection Statistics</b>\n\n`;
      
      message += `📊 <b>Overall Performance:</b>\n`;
      message += `🔍 <b>Total Scans:</b> <code>${stats.totalScans}</code>\n`;
      message += `🐋 <b>Whales Found:</b> <code>${stats.totalWhalesFound}</code>\n`;
      message += `✅ <b>Valid Whales:</b> <code>${stats.validWhales}</code>\n`;
      message += `🚫 <b>Spam Filtered:</b> <code>${stats.spamFiltered}</code>\n`;
      message += `📢 <b>Notifications Sent:</b> <code>${stats.notificationsSent}</code>\n`;
      message += `📈 <b>Success Rate:</b> <code>${stats.successRate.toFixed(1)}%</code>\n`;
      message += `⏱️ <b>Avg Scan Time:</b> <code>${stats.avgScanDuration.toFixed(0)}ms</code>\n\n`;
      
      message += `📡 <b>Source Performance:</b>\n`;
      message += `🌐 <b>DexScreener:</b>\n`;
      message += `  • Scans: <code>${stats.sourceStats.dexScreener.scans}</code>\n`;
      message += `  • Candidates: <code>${stats.sourceStats.dexScreener.candidates}</code>\n`;
      message += `  • Valid: <code>${stats.sourceStats.dexScreener.validWhales}</code>\n\n`;
      
      message += `🪐 <b>Jupiter:</b>\n`;
      message += `  • Scans: <code>${stats.sourceStats.jupiter.scans}</code>\n`;
      message += `  • Candidates: <code>${stats.sourceStats.jupiter.candidates}</code>\n`;
      message += `  • Valid: <code>${stats.sourceStats.jupiter.validWhales}</code>\n\n`;
      
      message += `🎯 <b>Detection Criteria:</b>\n`;
      message += `• Min Amount: <code>$2,000,000+</code>\n`;
      message += `• Max Age: <code>10 minutes</code>\n`;
      message += `• Validation: <code>Multi-level filtering</code>\n`;
      message += `• Sources: <code>DexScreener + Jupiter</code>\n\n`;
      
      message += `<code>#WhaleStats #Detection #Performance</code>`;

      await this.sendMessage(message);
      this.logger.info('🐋 Whale stats response sent');

    } catch (error) {
      this.logger.error('Error sending whale stats response:', error);
      this.stats.errorsSent++;
    }
  }

  // 🆕 МЕТОДЫ ДЛЯ ОТВЕТОВ НА КОМАНДЫ С ОБНОВЛЕННОЙ СТАТИСТИКОЙ

  async sendStatsResponse(data: StatsData): Promise<void> {
    try {
      const uptimeHours = Math.floor(data.uptime / 3600);
      const uptimeMinutes = Math.floor((data.uptime % 3600) / 60);
      
      let message = `📊 <b>Smart Money Bot Statistics</b>\n\n`;
      
      message += `🟢 <b>System Status:</b>\n`;
      message += `⏱️ Uptime: <code>${uptimeHours}h ${uptimeMinutes}m</code>\n`;
      message += `🔄 Mode: <code>${data.webhookMode === 'polling' ? 'Polling (5min)' : 'Real-time Webhooks'}</code>\n`;
      message += `📡 Monitoring: <code>${data.pollingStats?.monitoredWallets || 0}/20</code> wallets\n\n`;
      
      message += `👥 <b>Smart Money Wallets:</b>\n`;
      message += `🟢 Active: <code>${data.walletStats?.active || 0}</code>\n`;
      message += `✅ Enabled: <code>${data.walletStats?.enabled || 0}</code>\n`;
      message += `🔫 Snipers: <code>${data.walletStats?.byCategory?.sniper || 0}</code>\n`;
      message += `💡 Hunters: <code>${data.walletStats?.byCategory?.hunter || 0}</code>\n`;
      message += `🐳 Traders: <code>${data.walletStats?.byCategory?.trader || 0}</code>\n\n`;
      
      // 🆕 WHALE STATISTICS SECTION
      if (data.whaleStats) {
        message += `🐋 <b>Whale Detection:</b>\n`;
        message += `🔍 Total Scans: <code>${data.whaleStats.totalScans || 0}</code>\n`;
        message += `🐋 Whales Found: <code>${data.whaleStats.totalWhalesFound || 0}</code>\n`;
        message += `✅ Valid Whales: <code>${data.whaleStats.validWhales || 0}</code>\n`;
        message += `📢 Alerts Sent: <code>${data.whaleStats.notificationsSent || 0}</code>\n`;
        message += `📈 Success Rate: <code>${(data.whaleStats.successRate || 0).toFixed(1)}%</code>\n\n`;
      }
      
      message += `📊 <b>Database:</b>\n`;
      message += `💱 Total Swaps: <code>${data.dbStats?.totalSwaps || 0}</code>\n`;
      message += `🎯 Positions: <code>${data.dbStats?.positionAggregations || 0}</code>\n`;
      message += `🚨 High Suspicion: <code>${data.dbStats?.highSuspicionPositions || 0}</code>\n\n`;
      
      message += `🤖 <b>Notifications:</b>\n`;
      message += `📤 Total Sent: <code>${data.notificationStats?.totalSent || 0}</code>\n`;
      message += `🎯 Position Alerts: <code>${data.notificationStats?.positionAlerts || 0}</code>\n`;
      message += `🐋 Whale Alerts: <code>${this.stats.whaleAlerts}</code>\n`; // 🆕 ДОБАВЛЕНО
      message += `🚀 Smart Swaps: <code>${data.notificationStats?.smartMoneySwaps || 0}</code>\n`;
      message += `⚙️ Commands: <code>${this.stats.commandsProcessed}</code>\n`;
      message += `❌ Errors: <code>${data.notificationStats?.errorsSent || 0}</code>\n\n`;
      
      message += `📈 <b>Performance:</b>\n`;
      message += `🎯 Position Monitoring: <code>${data.aggregationStats?.activePositions || 0}</code> active\n`;
      message += `🐋 Whale Scanning: <code>Every 5 minutes</code>\n`;
      message += `🔍 Discovery: Every 48 hours\n`;
      message += `🔄 Flow Analysis: Every 4 hours\n\n`;
      
      message += `<code>#BotStats #SystemStatus #WhaleHunting</code>`;

      await this.sendMessage(message);
      this.logger.info('📊 Stats response sent');

    } catch (error) {
      this.logger.error('Error sending stats response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendWalletsResponse(data: WalletsData): Promise<void> {
    try {
      let message = `👥 <b>Active Smart Money Wallets</b>\n\n`;
      
      message += `📊 <b>Summary:</b>\n`;
      message += `🟢 Active: <code>${data.stats?.active || 0}</code>\n`;
      message += `✅ Enabled: <code>${data.stats?.enabled || 0}</code>\n`;
      message += `👥 Total: <code>${data.totalCount}</code>\n\n`;
      
      message += `🏆 <b>Top Performers (showing ${Math.min(data.wallets.length, 15)}):</b>\n\n`;
      
      data.wallets.slice(0, 15).forEach((wallet, index) => {
        const categoryEmoji = this.getCategoryEmoji(wallet.category || 'unknown');
        const priorityEmoji = wallet.priority === 'high' ? '🔴' : wallet.priority === 'medium' ? '🟡' : '🟢';
        const statusEmoji = wallet.enabled ? '✅' : '⚪';
        
        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> ${categoryEmoji} <b>${wallet.nickname || 'Unknown'}</b> ${priorityEmoji}${statusEmoji}\n`;
        message += `    <code>${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)}</code>\n`;
        message += `    WR: <code>${(wallet.winRate || 0).toFixed(1)}%</code> | PnL: <code>$${this.formatNumber(wallet.totalPnL || 0)}</code> | Trades: <code>${wallet.totalTrades || 0}</code>\n`;
        message += `    Avg: <code>$${this.formatNumber(wallet.avgTradeSize || 0)}</code> | Score: <code>${wallet.performanceScore || 0}</code>\n\n`;
      });
      
      if (data.wallets.length > 15) {
        message += `<i>... and ${data.wallets.length - 15} more wallets</i>\n\n`;
      }
      
      message += `🔫 <b>Snipers:</b> <code>${data.stats?.byCategory?.sniper || 0}</code> | `;
      message += `💡 <b>Hunters:</b> <code>${data.stats?.byCategory?.hunter || 0}</code> | `;
      message += `🐳 <b>Traders:</b> <code>${data.stats?.byCategory?.trader || 0}</code>\n\n`;
      
      message += `<code>#SmartWallets #ActiveMonitoring</code>`;

      await this.sendMessage(message);
      this.logger.info(`👥 Wallets response sent: ${data.wallets.length} wallets`);

    } catch (error) {
      this.logger.error('Error sending wallets response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendSettingsResponse(settings: any): Promise<void> {
    try {
      let message = `⚙️ <b>Bot Configuration & Settings</b>\n\n`;
      
      message += `🔄 <b>Monitoring:</b>\n`;
      message += `• Mode: <code>${settings.monitoringMode}</code>\n`;
      message += `• Wallets: <code>${settings.pollingWallets}/20</code> active\n`;
      message += `• Min Trade: <code>${settings.minTradeAmount}</code>\n`;
      message += `• Whale Detection: <code>$2M+ threshold</code>\n\n`; // 🆕 ДОБАВЛЕНО
      
      message += `🕒 <b>Intervals:</b>\n`;
      message += `• Flow Analysis: <code>${settings.flowAnalysisInterval}</code>\n`;
      message += `• Wallet Discovery: <code>${settings.discoveryInterval}</code>\n`;
      message += `• Whale Scanning: <code>5 minutes</code>\n`; // 🆕 ДОБАВЛЕНО
      message += `• Position Reports: <code>12 hours</code>\n\n`;
      
      message += `🎯 <b>Features:</b>\n`;
      message += `• Position Aggregation: <code>${settings.positionAggregation}</code>\n`;
      message += `• Whale Detection: <code>Enabled (DexScreener + Jupiter)</code>\n`; // 🆕 ДОБАВЛЕНО
      message += `• Wallet Discovery: <code>${settings.walletDiscoveryEnabled ? 'Enabled' : 'Disabled'}</code>\n`;
      message += `• Family Detection: <code>${settings.familyDetection}</code>\n`;
      message += `• API Optimization: <code>${settings.apiOptimization}</code>\n\n`;
      
      message += `💾 <b>Cache Settings:</b>\n`;
      message += `• Token Cache: <code>${settings.cacheSettings.tokenCache}</code>\n`;
      message += `• Price Cache: <code>${settings.cacheSettings.priceCache}</code>\n\n`;
      
      message += `🐋 <b>Whale Detection:</b>\n`;
      message += `• Min Amount: <code>$2,000,000+</code>\n`;
      message += `• Max Age: <code>10 minutes</code>\n`;
      message += `• Sources: <code>DexScreener + Jupiter</code>\n`;
      message += `• Validation: <code>Multi-level filtering</code>\n\n`;
      
      message += `🎯 <b>Position Aggregation:</b>\n`;
      message += `• Min Amount: <code>$10,000+ total</code>\n`;
      message += `• Min Purchases: <code>3+ similar sizes</code>\n`;
      message += `• Time Window: <code>90 minutes</code>\n`;
      message += `• Size Tolerance: <code>2%</code>\n\n`;
      
      message += `<code>#BotSettings #Configuration #WhaleHunting</code>`;

      await this.sendMessage(message);
      this.logger.info('⚙️ Settings response sent');

    } catch (error) {
      this.logger.error('Error sending settings response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendTopTokensResponse(tokens: TopTokenData[]): Promise<void> {
    try {
      let message = `📈 <b>Top Tokens by Volume (24h)</b>\n\n`;
      
      if (tokens.length === 0) {
        message += `<i>No token data available for the last 24 hours</i>\n\n`;
        message += `<code>#TopTokens #NoData</code>`;
        await this.sendMessage(message);
        return;
      }
      
      message += `🏆 <b>Top ${Math.min(tokens.length, 15)} by Smart Money Volume:</b>\n\n`;
      
      tokens.slice(0, 15).forEach((token, index) => {
        const changeEmoji = token.priceChange24h >= 0 ? '📈' : '📉';
        const changeText = token.priceChange24h >= 0 ? '+' : '';
        
        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${token.tokenSymbol}</code> ${changeEmoji}\n`;
        message += `    Vol: <code>$${this.formatNumber(token.volume24h)}</code> | Swaps: <code>${token.swapCount}</code>\n`;
        message += `    Wallets: <code>${token.uniqueWallets}</code> | Change: <code>${changeText}${token.priceChange24h.toFixed(1)}%</code>\n`;
        message += `    <code>${token.tokenAddress}</code>\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
        message += `    <a href="https://solscan.io/token/${token.tokenAddress}">SolS</a> | <a href="https://dexscreener.com/solana/${token.tokenAddress}">DS</a>\n\n`;
      });
      
      const totalVolume = tokens.reduce((sum, t) => sum + t.volume24h, 0);
      const totalSwaps = tokens.reduce((sum, t) => sum + t.swapCount, 0);
      
      message += `📊 <b>24h Summary:</b>\n`;
      message += `💰 Total Volume: <code>$${this.formatNumber(totalVolume)}</code>\n`;
      message += `🔄 Total Swaps: <code>${totalSwaps}</code>\n`;
      message += `🪙 Unique Tokens: <code>${tokens.length}</code>\n\n`;
      
      message += `<code>#TopTokens #Volume24h #SmartMoney</code>`;

      await this.sendMessage(message);
      this.logger.info(`📈 Top tokens response sent: ${tokens.length} tokens`);

    } catch (error) {
      this.logger.error('Error sending top tokens response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendPositionsResponse(data: PositionsData): Promise<void> {
    try {
      let message = `🎯 <b>Position Aggregation Status</b>\n\n`;
      
      message += `📊 <b>Overview:</b>\n`;
      message += `🎯 Total Positions: <code>${data.totalPositions}</code>\n`;
      message += `🚨 High Suspicion (75+): <code>${data.highSuspicionPositions}</code>\n`;
      message += `💰 Total Value: <code>$${this.formatNumber(data.totalValueUSD)}</code>\n`;
      message += `📈 Avg Suspicion: <code>${data.avgSuspicionScore.toFixed(1)}/100</code>\n\n`;
      
      message += `🔄 <b>Real-time Monitoring:</b>\n`;
      message += `⚡ Active Positions: <code>${data.activeMonitoring}</code>\n`;
      message += `🆕 Detected Today: <code>${data.detectedToday}</code>\n`;
      message += `📢 Alerts Sent Today: <code>${data.alertsSentToday}</code>\n\n`;
      
      message += `⚠️ <b>Risk Distribution:</b>\n`;
      message += `🔴 High Risk (80+): <code>${data.riskDistribution.high}</code>\n`;
      message += `🟡 Medium Risk (60-79): <code>${data.riskDistribution.medium}</code>\n`;
      message += `🟢 Low Risk (<60): <code>${data.riskDistribution.low}</code>\n\n`;
      
      if (data.topWalletsByPositions.length > 0) {
        message += `🏆 <b>Top Wallets by Position Count:</b>\n`;
        data.topWalletsByPositions.slice(0, 8).forEach((wallet, index) => {
          message += `<code>${index + 1}.</code> <code>${wallet.walletAddress.slice(0, 8)}...${wallet.walletAddress.slice(-4)}</code>\n`;
          message += `    Positions: <code>${wallet.positionCount}</code> | Value: <code>$${this.formatNumber(wallet.totalValueUSD)}</code>\n`;
        });
        message += '\n';
      }
      
      message += `🎯 <b>Detection Criteria:</b>\n`;
      message += `• Min Total: <code>$10,000+</code>\n`;
      message += `• Min Purchases: <code>3+ similar sizes</code>\n`;
      message += `• Time Window: <code>90 minutes max</code>\n`;
      message += `• Size Tolerance: <code>2%</code>\n\n`;
      
      message += `<code>#PositionAggregation #SuspiciousActivity #Monitoring</code>`;

      await this.sendMessage(message);
      this.logger.info('🎯 Positions response sent');

    } catch (error) {
      this.logger.error('Error sending positions response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendDiscoveryResponse(data: DiscoveryData): Promise<void> {
    try {
      let message = `🔍 <b>Wallet Discovery Completed</b>\n\n`;
      
      message += `📊 <b>Discovery Results:</b>\n`;
      message += `🔍 Analyzed: <code>${data.totalAnalyzed}</code> wallets\n`;
      message += `💡 Smart Money Found: <code>${data.smartMoneyFound}</code>\n`;
      message += `➕ New Wallets Added: <code>${data.newWallets}</code>\n`;
      message += `🔄 Updated Existing: <code>${data.updatedWallets}</code>\n\n`;
      
      if (data.newWallets > 0) {
        message += `✅ <b>Successfully added ${data.newWallets} new Smart Money wallets to monitoring!</b>\n\n`;
        message += `🎯 New wallets will be included in the next monitoring cycle.\n`;
        message += `📊 Use /wallets to see the updated list.\n\n`;
      } else {
        message += `ℹ️ <b>No new wallets met the Smart Money criteria this time.</b>\n\n`;
        message += `🔍 Current criteria:\n`;
        message += `• Win Rate: 65%+\n`;
        message += `• Total PnL: $50,000+\n`;
        message += `• Total Trades: 30+\n`;
        message += `• Performance Score: 75+\n\n`;
      }
      
      const successRate = data.totalAnalyzed > 0 ? ((data.smartMoneyFound / data.totalAnalyzed) * 100).toFixed(1) : '0';
      message += `📈 <b>Discovery Rate:</b> <code>${successRate}%</code> Smart Money\n\n`;
      
      message += `⏰ <b>Next automatic discovery:</b> <code>48 hours</code>\n\n`;
      
      message += `<code>#WalletDiscovery #SmartMoney #ManualScan</code>`;

      await this.sendMessage(message);
      this.logger.info(`🔍 Discovery response sent: ${data.newWallets} new wallets`);

    } catch (error) {
      this.logger.error('Error sending discovery response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendHelpResponse(): Promise<void> {
    try {
      let message = `🤖 <b>Smart Money Bot Commands</b>\n\n`;
      
      message += `📊 <b>Monitoring Commands:</b>\n`;
      message += `/stats - Bot & wallet statistics\n`;
      message += `/wallets - Active Smart Money wallets\n`;
      message += `/settings - Current monitoring settings\n`;
      message += `/positions - Position aggregation status\n`;
      message += `/whales - Whale detection statistics\n\n`; // 🆕 ДОБАВЛЕНО
      
      message += `📈 <b>Analysis Commands:</b>\n`;
      message += `/top - Top tokens by volume (24h)\n`;
      message += `/discover - Force wallet discovery\n\n`;
      
      message += `❓ <b>Help & Info:</b>\n`;
      message += `/help - This help message\n\n`;
      
      message += `🔥 <b>Key Features:</b>\n`;
      message += `• Real-time Smart Money monitoring\n`;
      message += `• Whale transaction detection ($2M+)\n`; // 🆕 ДОБАВЛЕНО
      message += `• Position splitting detection\n`;
      message += `• Automatic wallet discovery (48h)\n`;
      message += `• Flow analysis every 4 hours\n`;
      message += `• API optimized (-95% requests)\n\n`;
      
      message += `🎯 <b>Current Settings:</b>\n`;
      message += `• Min Trade Alert: $8,000+\n`;
      message += `• Whale Alert: $2,000,000+\n`; // 🆕 ДОБАВЛЕНО
      message += `• Position Detection: $10,000+\n`;
      message += `• Monitoring: 20 top wallets\n`;
      message += `• Discovery: Every 48 hours\n\n`;
      
      message += `📝 <b>Note:</b> All commands work only for authorized users.\n\n`;
      
      message += `<code>#Help #BotCommands #SmartMoney #WhaleHunting</code>`;

      await this.sendMessage(message);
      this.logger.info('❓ Help response sent');

    } catch (error) {
      this.logger.error('Error sending help response:', error);
      this.stats.errorsSent++;
    }
  }

  async sendCommandError(command: string, error: any): Promise<void> {
    try {
      let message = `❌ <b>Command Error</b>\n\n`;
      message += `🤖 Command: <code>/${command}</code>\n`;
      message += `⚠️ Error: <code>${error.message || 'Unknown error'}</code>\n\n`;
      message += `💡 Try again in a few seconds, or use /help for available commands.`;

      await this.sendMessage(message);
      this.stats.errorsSent++;

    } catch (sendError) {
      this.logger.error('Error sending command error message:', sendError);
    }
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
📍 <b>Token Address:</b> <code>${alert.tokenAddress}</code>
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
📍 <b>Token Address:</b> <code>${moonshot.tokenAddress}</code>
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
        message += `<code>${(index + 1).toString().padStart(2, '0')}.</code> <code>#${flow.tokenSymbol}</code>\n`;
        message += `<code>${flow.tokenAddress}</code>\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
        message += `<b>$${this.formatNumber(amount)}</b> <code>(${flow.uniqueWallets} wallets)</code>\n\n`;
      });

      message += `<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

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
        message += `<code>${token.address}</code>\n\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
      });

      message += `<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

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
        message += `<code>${token.address}</code>\n\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
      });

      message += `<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

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
        message += `<code>${token.address}</code>\n\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС ТОКЕНА
      });

      message += `<a href="https://solscan.io">SolS</a> <a href="https://dexscreener.com/solana">DS</a>`;

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
📍 <b>Token Address:</b> <code>${alert.tokenAddress}</code>
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
      breakdown += `📍 <b>Token Address:</b> <code>${alert.tokenAddress}</code>\n`; // 🔧 ИСПРАВЛЕНО: ПОЛНЫЙ АДРЕС
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

  // 🆕 НОВЫЙ МЕТОД: Форматирование возраста транзакции
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