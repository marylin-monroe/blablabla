// src/services/ApiCreditManager.ts
import { Logger } from '../utils/Logger';

interface ProviderStats {
  dailyUsage: number;
  hourlyUsage: number;
  totalUsage: number;
  lastReset: Date;
  isAvailable: boolean;
  errorCount: number;
}

interface CreditUsage {
  provider: 'quicknode' | 'alchemy';
  operation: string;
  credits: number;
  timestamp: Date;
  success: boolean;
}

export class ApiCreditManager {
  private logger: Logger;
  private currentProvider: 'quicknode' | 'alchemy';
  private providers: Map<string, ProviderStats>;
  private usageHistory: CreditUsage[] = [];
  
  // Credit limits
  private readonly DAILY_LIMIT = 666000; // 20M / 30 days
  private readonly HOURLY_LIMIT = 27000; // Daily / 24 hours
  private readonly MONTHLY_LIMIT = 20000000; // 20M total
  
  // Operation costs (примерные расходы в кредитах)
  private readonly OPERATION_COSTS = {
    'balance_check': 1,
    'transaction_list': 50,
    'transaction_detail': 1,
    'wallet_analysis': 250, // Full analysis
    'quick_activity_check': 2,
    'token_balance': 1,
    'nft_balance': 2,
    'performance_calculation': 150,
  };

  constructor() {
    this.logger = Logger.getInstance();
    this.currentProvider = this.selectInitialProvider();
    this.providers = new Map();
    
    // Initialize provider stats
    this.initializeProviders();
    
    // Setup daily reset
    this.setupDailyReset();
    
    this.logger.info(`💳 API Credit Manager initialized with provider: ${this.currentProvider}`);
  }

  /**
   * Выбирает оптимального провайдера на основе текущего использования
   */
  selectProvider(): 'quicknode' | 'alchemy' {
    const quicknodeStats = this.providers.get('quicknode')!;
    const alchemyStats = this.providers.get('alchemy')!;
    
    // Проверяем доступность провайдеров
    if (!quicknodeStats.isAvailable && alchemyStats.isAvailable) {
      this.currentProvider = 'alchemy';
    } else if (quicknodeStats.isAvailable && !alchemyStats.isAvailable) {
      this.currentProvider = 'quicknode';
    } else if (quicknodeStats.isAvailable && alchemyStats.isAvailable) {
      // Выбираем провайдера с меньшим hourly usage
      this.currentProvider = quicknodeStats.hourlyUsage <= alchemyStats.hourlyUsage 
        ? 'quicknode' 
        : 'alchemy';
    } else {
      // Если оба недоступны, берем quicknode по умолчанию
      this.currentProvider = 'quicknode';
      this.logger.warn('⚠️ Both providers unavailable, using quicknode as fallback');
    }
    
    return this.currentProvider;
  }

  /**
   * Проверяет, можем ли мы позволить себе операцию
   */
  canAffordOperation(operation: string, count: number = 1): boolean {
    const cost = this.getOperationCost(operation) * count;
    const currentStats = this.providers.get(this.currentProvider)!;
    
    // Проверяем лимиты
    const wouldExceedHourly = currentStats.hourlyUsage + cost > this.HOURLY_LIMIT;
    const wouldExceedDaily = currentStats.dailyUsage + cost > this.DAILY_LIMIT;
    
    if (wouldExceedHourly || wouldExceedDaily) {
      this.logger.warn(`💸 Cannot afford ${operation} x${count} (${cost} credits)`);
      this.logger.warn(`Current usage: ${currentStats.hourlyUsage}/${this.HOURLY_LIMIT} hourly, ${currentStats.dailyUsage}/${this.DAILY_LIMIT} daily`);
      return false;
    }
    
    return true;
  }

  /**
   * Записывает использование кредитов
   */
  logUsage(operation: string, count: number = 1, success: boolean = true): void {
    const credits = this.getOperationCost(operation) * count;
    const currentStats = this.providers.get(this.currentProvider)!;
    
    // Обновляем статистику
    currentStats.dailyUsage += credits;
    currentStats.hourlyUsage += credits;
    currentStats.totalUsage += credits;
    
    if (!success) {
      currentStats.errorCount++;
    }
    
    // Записываем в историю
    this.usageHistory.push({
      provider: this.currentProvider,
      operation,
      credits,
      timestamp: new Date(),
      success
    });
    
    // Очищаем старую историю (оставляем только последние 1000 записей)
    if (this.usageHistory.length > 1000) {
      this.usageHistory = this.usageHistory.slice(-1000);
    }
    
    this.logger.debug(`💳 Logged ${credits} credits for ${operation} on ${this.currentProvider} (success: ${success})`);
  }

  /**
   * Получает стоимость операции в кредитах
   */
  getOperationCost(operation: string): number {
    return this.OPERATION_COSTS[operation as keyof typeof this.OPERATION_COSTS] || 1;
  }

  /**
   * Получает текущую статистику использования
   */
  getUsageStats(): {
    currentProvider: string;
    providers: Record<string, ProviderStats>;
    totalCreditsToday: number;
    remainingCreditsToday: number;
    hourlyRate: number;
    projectedDailyUsage: number;
  } {
    const quicknodeStats = this.providers.get('quicknode')!;
    const alchemyStats = this.providers.get('alchemy')!;
    const totalCreditsToday = quicknodeStats.dailyUsage + alchemyStats.dailyUsage;
    
    return {
      currentProvider: this.currentProvider,
      providers: {
        quicknode: { ...quicknodeStats },
        alchemy: { ...alchemyStats }
      },
      totalCreditsToday,
      remainingCreditsToday: this.DAILY_LIMIT - totalCreditsToday,
      hourlyRate: quicknodeStats.hourlyUsage + alchemyStats.hourlyUsage,
      projectedDailyUsage: (quicknodeStats.hourlyUsage + alchemyStats.hourlyUsage) * 24
    };
  }

  /**
   * Оценивает стоимость анализа кошелька
   */
  estimateWalletAnalysisCost(): number {
    return this.getOperationCost('wallet_analysis');
  }

  /**
   * Оценивает максимальное количество кошельков, которые можно проанализировать
   */
  getMaxWalletsForAnalysis(): number {
    const currentStats = this.providers.get(this.currentProvider)!;
    const remainingHourlyCredits = this.HOURLY_LIMIT - currentStats.hourlyUsage;
    const costPerWallet = this.estimateWalletAnalysisCost();
    
    return Math.floor(remainingHourlyCredits / costPerWallet);
  }

  /**
   * Помечает провайдера как недоступного
   */
  markProviderUnavailable(provider: 'quicknode' | 'alchemy', reason: string): void {
    const stats = this.providers.get(provider)!;
    stats.isAvailable = false;
    stats.errorCount++;
    
    this.logger.warn(`❌ Provider ${provider} marked unavailable: ${reason}`);
    
    // Переключаемся на другого провайдера
    if (provider === this.currentProvider) {
      this.selectProvider();
      this.logger.info(`🔄 Switched to provider: ${this.currentProvider}`);
    }
  }

  /**
   * Помечает провайдера как доступного
   */
  markProviderAvailable(provider: 'quicknode' | 'alchemy'): void {
    const stats = this.providers.get(provider)!;
    stats.isAvailable = true;
    
    this.logger.info(`✅ Provider ${provider} marked available`);
  }

  /**
   * Получает детальный отчет об использовании
   */
  getDetailedReport(): string {
    const stats = this.getUsageStats();
    const recentUsage = this.usageHistory.slice(-10);
    
    let report = '📊 API Credit Usage Report\n\n';
    report += `Current Provider: ${stats.currentProvider}\n`;
    report += `Total Credits Today: ${stats.totalCreditsToday.toLocaleString()}\n`;
    report += `Remaining Today: ${stats.remainingCreditsToday.toLocaleString()}\n`;
    report += `Hourly Rate: ${stats.hourlyRate.toLocaleString()}\n`;
    report += `Projected Daily: ${stats.projectedDailyUsage.toLocaleString()}\n\n`;
    
    report += 'Provider Details:\n';
    for (const [name, providerStats] of Object.entries(stats.providers)) {
      report += `  ${name.toUpperCase()}:\n`;
      report += `    Daily: ${providerStats.dailyUsage.toLocaleString()}\n`;
      report += `    Hourly: ${providerStats.hourlyUsage.toLocaleString()}\n`;
      report += `    Available: ${providerStats.isAvailable ? '✅' : '❌'}\n`;
      report += `    Errors: ${providerStats.errorCount}\n\n`;
    }
    
    if (recentUsage.length > 0) {
      report += 'Recent Operations:\n';
      recentUsage.forEach(usage => {
        const time = usage.timestamp.toLocaleTimeString();
        const status = usage.success ? '✅' : '❌';
        report += `  ${time} ${status} ${usage.operation} (${usage.credits} credits) - ${usage.provider}\n`;
      });
    }
    
    return report;
  }

  /**
   * Сбрасывает почасовую статистику
   */
  resetHourlyStats(): void {
    for (const stats of this.providers.values()) {
      stats.hourlyUsage = 0;
    }
    this.logger.info('🔄 Hourly stats reset');
  }

  /**
   * Сбрасывает дневную статистику
   */
  resetDailyStats(): void {
    for (const stats of this.providers.values()) {
      stats.dailyUsage = 0;
      stats.hourlyUsage = 0;
      stats.errorCount = 0;
      stats.lastReset = new Date();
    }
    this.logger.info('🔄 Daily stats reset');
  }

  private initializeProviders(): void {
    this.providers.set('quicknode', {
      dailyUsage: 0,
      hourlyUsage: 0,
      totalUsage: 0,
      lastReset: new Date(),
      isAvailable: true,
      errorCount: 0
    });
    
    this.providers.set('alchemy', {
      dailyUsage: 0,
      hourlyUsage: 0,
      totalUsage: 0,
      lastReset: new Date(),
      isAvailable: true,
      errorCount: 0
    });
  }

  private selectInitialProvider(): 'quicknode' | 'alchemy' {
    // Выбираем провайдера на основе текущего часа для равномерного распределения
    const hour = new Date().getHours();
    return hour % 2 === 0 ? 'quicknode' : 'alchemy';
  }

  private setupDailyReset(): void {
    // Сброс дневной статистики каждый день в полночь UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.resetDailyStats();
      
      // Настраиваем ежедневный сброс
      setInterval(() => {
        this.resetDailyStats();
      }, 24 * 60 * 60 * 1000);
      
    }, msUntilMidnight);
    
    // Сброс почасовой статистики каждый час
    const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - (now.getSeconds() * 1000);
    
    setTimeout(() => {
      this.resetHourlyStats();
      
      // Настраиваем ежечасный сброс
      setInterval(() => {
        this.resetHourlyStats();
      }, 60 * 60 * 1000);
      
    }, msUntilNextHour);
  }
}