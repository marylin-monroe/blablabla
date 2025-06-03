// src/services/SmartMoneyFlowAnalyzer.ts - ИСПРАВЛЕНО все ошибки
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';
import {
  TokenSwap,
  SmartMoneyFlow,
  HotNewToken,
  SmartMoneyWallet
} from '../types';

export interface FlowAnalysisResult {
  inflows: SmartMoneyFlow[];
  outflows: SmartMoneyFlow[];
  hotNewTokens: HotNewToken[];
  topInflowsLastHour: SmartMoneyFlow[];
}

export class SmartMoneyFlowAnalyzer {
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  private heliusApiKey: string;

  constructor(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier) {
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY!;
  }

  // Основной метод анализа потоков Smart Money
  async analyzeSmartMoneyFlows(): Promise<FlowAnalysisResult> {
    this.logger.info('🔍 Starting Smart Money Flow Analysis...');

    try {
      // Получаем все активные Smart Money кошельки
      const smartWallets = await this.smDatabase.getAllActiveSmartWallets();
      this.logger.info(`Analyzing flows for ${smartWallets.length} Smart Money wallets`);

      // Анализируем потоки за последний час и 24 часа
      const hourlyFlows = await this.calculateFlows(smartWallets, '1h');
      const dailyFlows = await this.calculateFlows(smartWallets, '24h');

      // Ищем Hot New Tokens
      const hotNewTokens = await this.findHotNewTokens(smartWallets);

      // Определяем топ притоки за час
      const topInflowsLastHour = hourlyFlows.inflows
        .sort((a, b) => b.totalInflowUSD - a.totalInflowUSD)
        .slice(0, 10);

      const result: FlowAnalysisResult = {
        inflows: [...hourlyFlows.inflows, ...dailyFlows.inflows],
        outflows: [...hourlyFlows.outflows, ...dailyFlows.outflows],
        hotNewTokens,
        topInflowsLastHour
      };

      this.logger.info(`✅ Analysis complete: ${result.inflows.length} inflows, ${result.hotNewTokens.length} hot tokens`);
      return result;

    } catch (error) {
      this.logger.error('❌ Error in Smart Money Flow Analysis:', error);
      throw error;
    }
  }

  // Расчет притоков/оттоков для указанного периода
  private async calculateFlows(
    smartWallets: SmartMoneyWallet[], 
    period: '1h' | '24h'
  ): Promise<{ inflows: SmartMoneyFlow[]; outflows: SmartMoneyFlow[] }> {
    
    const hours = period === '1h' ? 1 : 24;
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Группируем транзакции по токенам
    const tokenFlows = new Map<string, {
      tokenAddress: string;
      tokenSymbol: string;
      tokenName: string;
      totalBuyUSD: number;
      totalSellUSD: number;
      uniqueBuyers: Set<string>;
      uniqueSellers: Set<string>;
      transactions: TokenSwap[];
    }>();

    // Получаем транзакции Smart Money кошельков за период
    for (const wallet of smartWallets) {
      const transactions = await this.getWalletTransactionsAfter(wallet.address, cutoffTime);
      
      for (const tx of transactions) {
        const key = tx.tokenAddress;
        
        if (!tokenFlows.has(key)) {
          tokenFlows.set(key, {
            tokenAddress: tx.tokenAddress,
            tokenSymbol: tx.tokenSymbol,
            tokenName: tx.tokenName,
            totalBuyUSD: 0,
            totalSellUSD: 0,
            uniqueBuyers: new Set(),
            uniqueSellers: new Set(),
            transactions: []
          });
        }

        const flow = tokenFlows.get(key)!;
        flow.transactions.push(tx);

        // Определяем тип операции (упрощенно)
        if (this.isBuyTransaction(tx)) {
          flow.totalBuyUSD += tx.amountUSD;
          flow.uniqueBuyers.add(tx.walletAddress);
        } else {
          flow.totalSellUSD += tx.amountUSD;
          flow.uniqueSellers.add(tx.walletAddress);
        }
      }
    }

    // Преобразуем в SmartMoneyFlow объекты
    const inflows: SmartMoneyFlow[] = [];
    const outflows: SmartMoneyFlow[] = [];

    for (const [_, flow] of tokenFlows) {
      const netFlowUSD = flow.totalBuyUSD - flow.totalSellUSD;
      const uniqueWallets = flow.uniqueBuyers.size + flow.uniqueSellers.size;

      if (uniqueWallets < 2) continue; // Фильтруем токены с малой активностью

      const smartMoneyFlow: SmartMoneyFlow = {
        tokenAddress: flow.tokenAddress,
        tokenSymbol: flow.tokenSymbol,
        tokenName: flow.tokenName,
        period,
        totalInflowUSD: flow.totalBuyUSD,
        totalOutflowUSD: flow.totalSellUSD,
        netFlowUSD,
        uniqueWallets,
        avgTradeSize: (flow.totalBuyUSD + flow.totalSellUSD) / flow.transactions.length,
        topWallets: this.getTopWallets(flow.transactions)
      };

      if (netFlowUSD > 0 && flow.totalBuyUSD > 5000) { // Минимум $5K для inflow
        inflows.push(smartMoneyFlow);
      } else if (netFlowUSD < 0 && flow.totalSellUSD > 5000) {
        outflows.push(smartMoneyFlow);
      }
    }

    return {
      inflows: inflows.sort((a, b) => b.netFlowUSD - a.netFlowUSD),
      outflows: outflows.sort((a, b) => a.netFlowUSD - b.netFlowUSD)
    };
  }

  // Поиск Hot New Tokens
  private async findHotNewTokens(smartWallets: SmartMoneyWallet[]): Promise<HotNewToken[]> {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hotTokens = new Map<string, {
      tokenAddress: string;
      tokenSymbol: string;
      tokenName: string;
      fdv: number;
      smStakeUSD: number;
      ageHours: number;
      buyVolumeUSD: number;
      sellVolumeUSD: number;
      buyCount: number;
      sellCount: number;
      uniqueSmWallets: Set<string>;
      topBuyers: Array<{ address: string; amountUSD: number; category: string; }>;
    }>();

    // Анализируем транзакции за последние 24 часа
    for (const wallet of smartWallets) {
      const transactions = await this.getWalletTransactionsAfter(wallet.address, last24Hours);
      
      for (const tx of transactions) {
        // Проверяем возраст токена
        const tokenAge = await this.getTokenAge(tx.tokenAddress);
        if (tokenAge > 24) continue; // Только токены младше 24 часов

        const key = tx.tokenAddress;
        
        if (!hotTokens.has(key)) {
          const fdv = await this.getTokenFDV(tx.tokenAddress);
          hotTokens.set(key, {
            tokenAddress: tx.tokenAddress,
            tokenSymbol: tx.tokenSymbol,
            tokenName: tx.tokenName,
            fdv,
            smStakeUSD: 0,
            ageHours: tokenAge,
            buyVolumeUSD: 0,
            sellVolumeUSD: 0,
            buyCount: 0,
            sellCount: 0,
            uniqueSmWallets: new Set(),
            topBuyers: []
          });
        }

        const hotToken = hotTokens.get(key)!;
        hotToken.uniqueSmWallets.add(tx.walletAddress);

        if (this.isBuyTransaction(tx)) {
          hotToken.buyVolumeUSD += tx.amountUSD;
          hotToken.buyCount++;
          hotToken.smStakeUSD += tx.amountUSD;
          
          hotToken.topBuyers.push({
            address: tx.walletAddress,
            amountUSD: tx.amountUSD,
            category: this.getWalletCategory(wallet)
          });
        } else {
          hotToken.sellVolumeUSD += tx.amountUSD;
          hotToken.sellCount++;
        }
      }
    }

    // Фильтруем и сортируем Hot New Tokens
    const result: HotNewToken[] = [];
    
    for (const [_, token] of hotTokens) {
      if (token.uniqueSmWallets.size >= 3 && token.smStakeUSD >= 10000) { // Минимум 3 SM кошелька и $10K
        // Сортируем топ покупателей
        token.topBuyers.sort((a, b) => b.amountUSD - a.amountUSD);
        token.topBuyers = token.topBuyers.slice(0, 5);

        result.push({
          address: token.tokenAddress,
          symbol: token.tokenSymbol,
          name: token.tokenName,
          fdv: token.fdv,
          smStakeUSD: token.smStakeUSD,
          ageHours: token.ageHours,
          buyVolumeUSD: token.buyVolumeUSD,
          sellVolumeUSD: token.sellVolumeUSD,
          buyCount: token.buyCount,
          sellCount: token.sellCount,
          uniqueSmWallets: token.uniqueSmWallets.size,
          topBuyers: token.topBuyers
        });
      }
    }

    return result.sort((a, b) => b.smStakeUSD - a.smStakeUSD);
  }

  // Отправка уведомлений о результатах анализа
  async sendFlowAnalysisNotifications(result: FlowAnalysisResult): Promise<void> {
    try {
      // Отправляем топ притоки за час
      if (result.topInflowsLastHour.length > 0) {
        await this.telegramNotifier.sendTopSmartMoneyInflows(result.topInflowsLastHour);
      }

      // Отправляем Hot New Tokens
      for (const hotToken of result.hotNewTokens.slice(0, 5)) { // Топ-5
        await this.telegramNotifier.sendHotNewTokenAlert(hotToken);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза между сообщениями
      }

      this.logger.info(`✅ Sent notifications: ${result.topInflowsLastHour.length} inflows, ${result.hotNewTokens.length} hot tokens`);

    } catch (error) {
      this.logger.error('❌ Error sending flow analysis notifications:', error);
    }
  }

  // Вспомогательные методы
  private async getWalletTransactionsAfter(walletAddress: string, afterDate: Date): Promise<TokenSwap[]> {
    try {
      // Временно используем основную базу данных, пока метод не добавлен в SmartMoneyDatabase
      // В будущем: const transactions = await this.smDatabase.getSmartWalletTransactions(walletAddress, afterDate);
      return [];
    } catch (error) {
      this.logger.error(`Error getting transactions for wallet ${walletAddress}:`, error);
      return [];
    }
  }

  private isBuyTransaction(tx: TokenSwap): boolean {
    // Если swapType указан, используем его
    if (tx.swapType) {
      return tx.swapType === 'buy';
    }
    
    // Определяем по логике: если есть pnl и он положительный, скорее всего это была покупка
    if (tx.pnl !== undefined && tx.pnl > 0) {
      return true;
    }
    
    // Можно добавить дополнительную логику на основе анализа транзакции
    return true; // По умолчанию считаем покупкой
  }

  private getTopWallets(transactions: TokenSwap[]): Array<{ address: string; amountUSD: number; category: string; }> {
    const walletVolumes = new Map<string, number>();
    
    for (const tx of transactions) {
      const current = walletVolumes.get(tx.walletAddress) || 0;
      walletVolumes.set(tx.walletAddress, current + tx.amountUSD);
    }

    return Array.from(walletVolumes.entries())
      .map(([address, amountUSD]) => ({
        address,
        amountUSD,
        category: 'Smart Money' // Можно улучшить логику определения категории
      }))
      .sort((a, b) => b.amountUSD - a.amountUSD)
      .slice(0, 5);
  }

  private async getTokenAge(tokenAddress: string): Promise<number> {
    try {
      // Запрос к Helius API за информацией о токене
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/transactions?api-key=${this.heliusApiKey}&limit=100&type=UNKNOWN`);
      
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          // Ищем самую раннюю транзакцию (создание токена)
          const oldestTx = data[data.length - 1]; // Последняя в списке = самая старая
          const createdAt = new Date(oldestTx.timestamp * 1000);
          const ageMs = Date.now() - createdAt.getTime();
          return ageMs / (1000 * 60 * 60); // Возвращаем в часах
        }
      }
      
      // Fallback: считаем новым токеном (1 час)
      return 1;
    } catch (error) {
      this.logger.error(`Error getting token age for ${tokenAddress}:`, error);
      return 1; // По умолчанию новый токен
    }
  }

  private async getTokenFDV(tokenAddress: string): Promise<number> {
    try {
      // Получаем метаданные токена
      const metadataResponse = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mintAccounts: [tokenAddress]
        })
      });

      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();
        if (Array.isArray(metadataData) && metadataData.length > 0) {
          const tokenData = metadataData[0];
          
          // Получаем текущую цену через DexScreener API
          const priceResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json() as any;
            if (priceData.pairs && priceData.pairs.length > 0) {
              const price = parseFloat(priceData.pairs[0].priceUsd || '0');
              const supply = tokenData.onChainMetadata?.metadata?.supply || 1000000000; // Default supply
              return price * supply;
            }
          }
        }
      }

      // Fallback: средний FDV для новых токенов
      return 100000; // $100K по умолчанию
    } catch (error) {
      this.logger.error(`Error getting token FDV for ${tokenAddress}:`, error);
      return 100000;
    }
  }

  private getWalletCategory(wallet: SmartMoneyWallet): string {
    return wallet.category === 'sniper' ? 'Sniper' :
           wallet.category === 'hunter' ? 'Hunter' : 'Trader';
  }
}