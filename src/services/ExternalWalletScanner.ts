// src/services/ExternalWalletScanner.ts
import { DexScreenerService } from './DexScreenerService';
import { JupiterService } from './JupiterService';
import { ApiCreditManager } from './ApiCreditManager';
import { Database } from './Database';
import { Logger } from '../utils/Logger';
import axios from 'axios';

interface TokenCandidate {
  address: string;
  source: 'dexscreener' | 'jupiter';
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
  age?: number; // days since creation
}

interface WalletCandidate {
  address: string;
  score: number;
  reasons: string[];
  lastActivity: Date;
  estimatedVolume: number;
  tokenCount: number;
  source: 'token_holders' | 'recent_traders' | 'high_volume';
}

export class ExternalWalletScanner {
  private dexScreener: DexScreenerService;
  private jupiter: JupiterService;
  private creditManager: ApiCreditManager;
  private database: Database;
  private logger: Logger;
  private heliusApiKey?: string; // 🔧 СДЕЛАНО ОПЦИОНАЛЬНЫМ
  private hasHelius: boolean = false; // 🆕 ФЛАГ ДОСТУПНОСТИ HELIUS
  
  constructor(database: Database, creditManager: ApiCreditManager) {
    this.dexScreener = new DexScreenerService();
    this.jupiter = new JupiterService();
    this.creditManager = creditManager;
    this.database = database;
    this.logger = Logger.getInstance();
    this.heliusApiKey = process.env.HELIUS_API_KEY;
    
    // 🔧 ИСПРАВЛЕНО: Helius теперь опциональный
    if (this.heliusApiKey) {
      this.hasHelius = true;
      this.logger.info('🌍 External wallet scanner initialized WITH Helius support');
    } else {
      this.hasHelius = false;
      this.logger.warn('⚠️ External wallet scanner initialized WITHOUT Helius (DexScreener + Jupiter only)');
    }
  }

  /**
   * Главный метод для поиска кандидатов кошельков
   * Теперь работает БЕЗ Helius - только внешние API
   */
  async findWalletCandidates(): Promise<string[]> {
    try {
      this.logger.info('🚀 Starting external wallet candidate discovery...');
      
      // Stage 1: Массовый сбор токенов из внешних источников (0 RPC кредитов)
      const tokenCandidates = await this.collectTokenCandidates();
      this.logger.info(`📋 Collected ${tokenCandidates.length} token candidates from external APIs`);
      
      if (tokenCandidates.length === 0) {
        this.logger.warn('⚠️ No token candidates found from external APIs');
        return [];
      }
      
      // 🔧 ИСПРАВЛЕНО: Без Helius просто возвращаем токены для внутреннего анализа
      if (!this.hasHelius) {
        this.logger.info('📊 No Helius - returning token addresses for internal blockchain analysis');
        return tokenCandidates.slice(0, 50).map(t => t.address);
      }

      // Stage 2: Получение кошельков-держателей токенов (только если есть Helius)
      const walletCandidates = await this.getTokenHolders(tokenCandidates);
      this.logger.info(`👥 Found ${walletCandidates.length} wallet candidates from token analysis`);
      
      // Stage 3: Быстрая предварительная фильтрация
      const activeWallets = await this.quickActivityFilter(walletCandidates);
      this.logger.info(`✅ Filtered to ${activeWallets.length} active wallets`);
      
      // Stage 4: Ранжирование и отбор топовых кандидатов
      const topCandidates = this.rankAndSelectTopCandidates(activeWallets, 50);
      this.logger.info(`🎯 Selected top ${topCandidates.length} candidates for deep analysis`);
      
      return topCandidates.map(c => c.address);
      
    } catch (error) {
      this.logger.error('❌ Error in external wallet scanning:', error);
      return [];
    }
  }

  /**
   * Stage 1: Собирает токены из DexScreener и Jupiter (0 кредитов)
   */
  private async collectTokenCandidates(): Promise<TokenCandidate[]> {
    const candidates: TokenCandidate[] = [];
    
    try {
      // Получаем кандидатов из DexScreener
      const dexTokens = await this.dexScreener.getWalletCandidatesFromTokens();
      dexTokens.forEach(token => {
        candidates.push({
          address: token,
          source: 'dexscreener'
        });
      });
      
      this.logger.info(`📊 DexScreener provided ${dexTokens.length} token candidates`);
      
      // Получаем кандидатов из Jupiter
      const jupiterTokens = await this.jupiter.getWalletCandidatesFromActivity();
      jupiterTokens.forEach(token => {
        candidates.push({
          address: token,
          source: 'jupiter'
        });
      });
      
      this.logger.info(`🪐 Jupiter provided ${jupiterTokens.length} token candidates`);
      
      // Удаляем дубликаты, отдавая приоритет DexScreener
      const uniqueCandidates = new Map<string, TokenCandidate>();
      candidates.forEach(candidate => {
        const existing = uniqueCandidates.get(candidate.address);
        if (!existing || candidate.source === 'dexscreener') {
          uniqueCandidates.set(candidate.address, candidate);
        }
      });
      
      return Array.from(uniqueCandidates.values()).slice(0, 100); // Ограничиваем до 100
      
    } catch (error) {
      this.logger.error('Error collecting token candidates:', error);
      return candidates;
    }
  }

  /**
   * Stage 2: Получает держателей токенов через Helius API (только если доступен)
   */
  private async getTokenHolders(tokenCandidates: TokenCandidate[]): Promise<WalletCandidate[]> {
    if (!this.hasHelius) {
      this.logger.info('📊 Skipping token holders analysis - no Helius API');
      return [];
    }

    const walletCandidates = new Map<string, WalletCandidate>();
    
    for (const token of tokenCandidates.slice(0, 50)) { // Ограничиваем для экономии
      try {
        // Проверяем бюджет перед запросом
        if (!this.creditManager.canAffordOperation('token_balance', 1)) {
          this.logger.warn('💸 Insufficient credits for token holder analysis');
          break;
        }
        
        const holders = await this.getTopTokenHolders(token.address);
        this.creditManager.logUsage('token_balance', 1, holders.length > 0);
        
        holders.forEach(holder => {
          const existing = walletCandidates.get(holder.address);
          if (existing) {
            existing.tokenCount++;
            existing.estimatedVolume += holder.balance * 1000; // Примерная оценка
            existing.reasons.push(`holds ${token.address.slice(0, 8)}`);
          } else {
            walletCandidates.set(holder.address, {
              address: holder.address,
              score: holder.balance,
              reasons: [`holds ${token.address.slice(0, 8)}`],
              lastActivity: new Date(),
              estimatedVolume: holder.balance * 1000,
              tokenCount: 1,
              source: 'token_holders'
            });
          }
        });
        
        // Пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        this.logger.debug(`Error getting holders for ${token.address}:`, error);
        this.creditManager.logUsage('token_balance', 1, false);
      }
    }
    
    return Array.from(walletCandidates.values());
  }

  /**
   * Stage 3: Быстрая фильтрация активности (только если есть Helius)
   */
  private async quickActivityFilter(candidates: WalletCandidate[]): Promise<WalletCandidate[]> {
    if (!this.hasHelius || candidates.length === 0) {
      this.logger.info('📊 Skipping activity filtering - no Helius API or no candidates');
      return candidates;
    }

    const activeWallets: WalletCandidate[] = [];
    
    for (const candidate of candidates) {
      try {
        // Проверяем бюджет
        if (!this.creditManager.canAffordOperation('quick_activity_check', 1)) {
          this.logger.warn('💸 Insufficient credits for activity filtering');
          break;
        }
        
        const isActive = await this.checkWalletActivity(candidate.address);
        this.creditManager.logUsage('quick_activity_check', 1, isActive !== null);
        
        if (isActive) {
          candidate.lastActivity = isActive.lastActivity;
          candidate.estimatedVolume = isActive.recentVolume;
          activeWallets.push(candidate);
        }
        
        // Пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        this.logger.debug(`Error checking activity for ${candidate.address}:`, error);
        this.creditManager.logUsage('quick_activity_check', 1, false);
      }
    }
    
    return activeWallets;
  }

  /**
   * Stage 4: Ранжирование и отбор топовых кандидатов
   */
  private rankAndSelectTopCandidates(candidates: WalletCandidate[], limit: number): WalletCandidate[] {
    // Рассчитываем комплексный скор для каждого кандидата
    candidates.forEach(candidate => {
      const daysSinceActivity = (Date.now() - candidate.lastActivity.getTime()) / (1000 * 60 * 60 * 24);
      const activityScore = Math.max(0, 10 - daysSinceActivity); // 0-10 баллов за свежесть
      const volumeScore = Math.min(10, candidate.estimatedVolume / 10000); // 0-10 баллов за объем
      const diversityScore = Math.min(10, candidate.tokenCount); // 0-10 баллов за разнообразие
      
      candidate.score = activityScore * 0.4 + volumeScore * 0.4 + diversityScore * 0.2;
    });
    
    // Сортируем по скору и берем топ
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Получает топовых держателей токена через Helius (только если доступен)
   */
  private async getTopTokenHolders(tokenAddress: string): Promise<Array<{ address: string; balance: number }>> {
    if (!this.hasHelius || !this.heliusApiKey) {
      return [];
    }

    try {
      const response = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`,
        {
          jsonrpc: '2.0',
          id: 'get-token-accounts',
          method: 'getTokenLargestAccounts',
          params: [tokenAddress]
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );

      if (response.data?.result?.value) {
        const accounts = response.data.result.value
          .filter((account: any) => account.uiAmount > 0)
          .slice(0, 20) // Топ 20 держателей
          .map((account: any) => ({
            address: account.address,
            balance: account.uiAmount || 0
          }));
        
        return accounts;
      }

      return [];
    } catch (error) {
      this.logger.debug(`Error getting token holders for ${tokenAddress}:`, error);
      return [];
    }
  }

  /**
   * Быстрая проверка активности кошелька (только если есть Helius)
   */
  private async checkWalletActivity(walletAddress: string): Promise<{ lastActivity: Date; recentVolume: number } | null> {
    if (!this.hasHelius || !this.heliusApiKey) {
      return null;
    }

    try {
      const response = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`,
        {
          jsonrpc: '2.0',
          id: 'get-signatures',
          method: 'getSignaturesForAddress',
          params: [
            walletAddress,
            {
              limit: 10 // Только последние 10 транзакций для быстрой проверки
            }
          ]
        },
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );

      if (response.data?.result && Array.isArray(response.data.result)) {
        const signatures = response.data.result;
        
        if (signatures.length === 0) {
          return null; // Нет активности
        }
        
        const lastSignature = signatures[0];
        const lastActivity = new Date(lastSignature.blockTime * 1000);
        
        // Проверяем, была ли активность в последние 7 дней
        const daysSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivity > 7) {
          return null; // Слишком старая активность
        }
        
        // Оцениваем недавний объем на основе количества транзакций
        const recentVolume = signatures.length * 5000; // Примерная оценка
        
        return {
          lastActivity,
          recentVolume
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(`Error checking activity for ${walletAddress}:`, error);
      return null;
    }
  }

  /**
   * Получает статистику работы сканера
   */
  getStats(): {
    hasHelius: boolean;
    dexScreenerStats: any;
    jupiterStats: any;
    creditStats: any;
  } {
    return {
      hasHelius: this.hasHelius,
      dexScreenerStats: this.dexScreener.getUsageStats(),
      jupiterStats: this.jupiter.getUsageStats(),
      creditStats: this.creditManager.getUsageStats()
    };
  }

  /**
   * Проверяет, готов ли сканер к работе
   */
  isReady(): boolean {
    // Теперь готов всегда, Helius опциональный
    return !!(this.creditManager);
  }

  /**
   * 🆕 НОВЫЙ МЕТОД: Получает возможности сканера
   */
  getCapabilities(): {
    externalTokens: boolean;
    walletHolders: boolean;
    activityFilter: boolean;
    fullPipeline: boolean;
  } {
    return {
      externalTokens: true, // DexScreener + Jupiter всегда доступны
      walletHolders: this.hasHelius,
      activityFilter: this.hasHelius,
      fullPipeline: this.hasHelius
    };
  }
}