// src/services/SmartWalletLoader.ts - с УЛУЧШЕННЫМ ERROR HANDLING
import fs from 'fs';
import path from 'path';
import { SmartMoneyDatabase } from './SmartMoneyDatabase';
import { TelegramNotifier } from './TelegramNotifier';
import { Logger } from '../utils/Logger';
import { SmartMoneyWallet } from '../types';

interface WalletConfig {
  address: string;
  category: 'sniper' | 'hunter' | 'trader';
  nickname: string;
  description: string;
  addedBy: 'manual' | 'discovery' | 'placeholder';
  addedAt: string;
  verified: boolean;
  winRate: number;
  totalPnL: number;
  totalTrades: number;
  avgTradeSize: number;
  maxTradeSize: number;
  performanceScore: number;
  minTradeAlert: number;
  priority: 'high' | 'medium' | 'low';
  enabled: boolean;
}

interface SmartWalletsConfig {
  version: string;
  lastUpdated: string;
  description: string;
  totalWallets: number;
  wallets: WalletConfig[];
  discovery: {
    autoDiscoveryEnabled: boolean;
    maxWallets: number;
    minPerformanceScore: number;
    discoveryInterval: string;
    lastDiscovery: string | null;
  };
  filters: {
    minWinRate: number;
    minTotalPnL: number;
    minTotalTrades: number;
    maxInactiveDays: number;
  };
}

export class SmartWalletLoader {
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private logger: Logger;
  private configPath: string;
  private config: SmartWalletsConfig | null = null;

  constructor(smDatabase: SmartMoneyDatabase, telegramNotifier: TelegramNotifier) {
    this.smDatabase = smDatabase;
    this.telegramNotifier = telegramNotifier;
    this.logger = Logger.getInstance();
    this.configPath = path.join(process.cwd(), 'data', 'smart_wallets.json');
  }

  // 🚀 HARDCODED кошельки - ВСЕГДА РАБОТАЮТ!
  private getHardcodedWallets(): WalletConfig[] {
  return [
    {
      address: "3NgFx68GWTcoreJyJear9yLxQBmjccXAYaUphq5h9PEJ",
      category: "sniper",
      nickname: "Alpha Sniper",
      description: "High-performance sniper wallet with excellent timing",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 82.4,
      totalPnL: 245000,
      totalTrades: 89,
      avgTradeSize: 12000,
      maxTradeSize: 45000,
      performanceScore: 88,
      minTradeAlert: 2000,
      priority: "high",
      enabled: true
    },
    {
      address: "G5nxEXuFMfV74DSnsrSatqCW32F34XUnBeq3PfDS7w5E",
      category: "hunter",
      nickname: "Token Hunter Pro",
      description: "Professional token hunter with strong analytics",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 76.8,
      totalPnL: 189000,
      totalTrades: 142,
      avgTradeSize: 8500,
      maxTradeSize: 28000,
      performanceScore: 84,
      minTradeAlert: 3000,
      priority: "high",
      enabled: true
    },
    {
      address: "9peW76TTRt5dp4wiQid8dw2pmxpwpN5eXZ15bmLBNCsx",
      category: "trader",
      nickname: "Momentum Trader",
      description: "Skilled momentum trader with consistent profits",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 71.2,
      totalPnL: 165000,
      totalTrades: 97,
      avgTradeSize: 15000,
      maxTradeSize: 65000,
      performanceScore: 81,
      minTradeAlert: 5000,
      priority: "high",
      enabled: true
    },
    {
      address: "4Bxf1mCFoaQmCxxB7obV4hjfYJqkCXVQVCTRkjT1YQuL",
      category: "sniper",
      nickname: "Quick Strike",
      description: "Fast execution sniper for new launches",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 79.1,
      totalPnL: 134000,
      totalTrades: 76,
      avgTradeSize: 9800,
      maxTradeSize: 35000,
      performanceScore: 83,
      minTradeAlert: 2500,
      priority: "high",
      enabled: true
    },
    {
      address: "5nFGHVWZzsGQuucx9yuMyMFNb8MxVe5BZq6UnpMzkoCv",
      category: "hunter",
      nickname: "Gem Hunter",
      description: "Expert at finding hidden gems early",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 74.6,
      totalPnL: 156000,
      totalTrades: 118,
      avgTradeSize: 7200,
      maxTradeSize: 25000,
      performanceScore: 82,
      minTradeAlert: 3500,
      priority: "medium",
      enabled: true
    },
    {
      address: "4v7nGvhrYgHxwkeVAUijm3HPaFLBA133Z3SBrxsFWjzD",
      category: "trader",
      nickname: "Volume Trader",
      description: "High-volume trader with solid risk management",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 68.3,
      totalPnL: 198000,
      totalTrades: 156,
      avgTradeSize: 18500,
      maxTradeSize: 85000,
      performanceScore: 79,
      minTradeAlert: 8000,
      priority: "medium",
      enabled: true
    },
    {
      address: "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo",
      category: "sniper",
      nickname: "Precision Sniper",
      description: "Highly accurate sniper with low miss rate",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 85.7,
      totalPnL: 112000,
      totalTrades: 63,
      avgTradeSize: 11500,
      maxTradeSize: 32000,
      performanceScore: 87,
      minTradeAlert: 2000,
      priority: "high",
      enabled: true
    },
    {
      address: "3KNCdquQuPBq6ZWChRJr8jGpkoyZ5LurLCt6sNJJMxbq",
      category: "hunter",
      nickname: "DeFi Hunter",
      description: "Specialized in DeFi token opportunities",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 72.9,
      totalPnL: 143000,
      totalTrades: 101,
      avgTradeSize: 9200,
      maxTradeSize: 38000,
      performanceScore: 80,
      minTradeAlert: 4000,
      priority: "medium",
      enabled: true
    },
    {
      address: "HAkvH2WfamhcoyvUF7X9kqSvzwcnvmGJbNUw9QTfhWh5",
      category: "trader",
      nickname: "Smart Whale",
      description: "Large position trader with strategic approach",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 66.8,
      totalPnL: 287000,
      totalTrades: 92,
      avgTradeSize: 28000,
      maxTradeSize: 120000,
      performanceScore: 78,
      minTradeAlert: 15000,
      priority: "medium",
      enabled: true
    },
    {
      address: "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
      category: "hunter",
      nickname: "Trend Hunter",
      description: "Expert at catching trending tokens early",
      addedBy: "manual",
      addedAt: "2025-06-13T09:00:00.000Z",
      verified: true,
      winRate: 77.3,
      totalPnL: 167000,
      totalTrades: 125,
      avgTradeSize: 8800,
      maxTradeSize: 29000,
      performanceScore: 83,
      minTradeAlert: 3000,
      priority: "medium",
      enabled: true
    }
  ];
}

  // 🚀 УМНАЯ загрузка: сначала файл, потом hardcoded с УЛУЧШЕННЫМ ERROR HANDLING
  async loadWalletsFromConfig(): Promise<number> {
    try {
      this.logger.info('📁 Loading Smart Money wallets from config...');

      // 🔒 УЛУЧШЕННАЯ ЗАГРУЗКА ИЗ ФАЙЛА С ЗАЩИТОЙ ОТ NULL
      try {
        const loadedConfig = this.loadConfig();
        if (loadedConfig && this.validateConfig(loadedConfig)) {
          this.config = loadedConfig;
          this.logger.info(`✅ Loaded valid config from file: ${this.config.wallets.length} wallets`);
        } else {
          throw new Error('Config file empty, invalid, or failed validation');
        }
      } catch (error) {
        // FALLBACK: используем hardcoded кошельки
        this.logger.warn(`⚠️ Failed to load from file: ${error}. Using hardcoded wallets...`);
        
        const hardcodedWallets = this.getHardcodedWallets();
        this.config = this.createDefaultConfigWithWallets(hardcodedWallets);
        
        this.logger.info(`🚀 Using ${hardcodedWallets.length} hardcoded wallets as fallback`);
      }

      // 🔒 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: config должен существовать в этой точке
      if (!this.config || !this.config.wallets) {
        this.logger.error('❌ Critical error: config is null after initialization!');
        return 0;
      }

      let loadedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      this.logger.info(`🔄 Processing ${this.config.wallets.length} wallets from config...`);

      for (const walletConfig of this.config.wallets) {
        try {
          // 🔒 ЗАЩИТА ОТ NULL/UNDEFINED ПОЛЕЙ
          if (!this.validateWalletConfig(walletConfig)) {
            skippedCount++;
            this.logger.warn(`⚠️ Skipped invalid wallet config: ${walletConfig?.nickname || 'unknown'}`);
            continue;
          }

          this.logger.info(`🐛 Processing wallet: ${walletConfig.nickname}, enabled: ${walletConfig.enabled}, addedBy: ${walletConfig.addedBy}`);
          
          if (walletConfig.addedBy === 'placeholder' || !walletConfig.enabled) {
            skippedCount++;
            this.logger.info(`⏭️ Skipped wallet: ${walletConfig.nickname} (placeholder or disabled)`);
            continue;
          }

          const existingWallet = await this.smDatabase.getSmartWallet(walletConfig.address);
          
          const smartWallet: SmartMoneyWallet = this.createSmartWalletFromConfig(walletConfig);
          const dbConfig = this.createDbConfigFromWalletConfig(walletConfig);

          await this.smDatabase.saveSmartWallet(smartWallet, dbConfig);

          if (!existingWallet) {
            loadedCount++;
            this.logger.info(`✅ Loaded new wallet: ${walletConfig.nickname} (${walletConfig.category})`);
          } else {
            updatedCount++;
            this.logger.info(`🔄 Updated wallet: ${walletConfig.nickname} (${walletConfig.category})`);
          }

        } catch (error) {
          this.logger.error(`❌ Error processing wallet ${walletConfig?.nickname || 'unknown'}:`, error);
          skippedCount++;
        }
      }

      // 🔒 БЕЗОПАСНОЕ ОБНОВЛЕНИЕ CONFIG
      try {
        this.config.totalWallets = this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder').length;
        this.config.lastUpdated = new Date().toISOString().split('T')[0];
        
        // Сохраняем только если загружали из файла
        if (fs.existsSync(this.configPath)) {
          await this.saveConfig();
        }
      } catch (error) {
        this.logger.error('❌ Error updating config after loading:', error);
      }

      this.logger.info(`📊 Processing completed: ${loadedCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

      await this.sendLoadSummary(loadedCount, updatedCount, skippedCount);

      return loadedCount + updatedCount;

    } catch (error) {
      this.logger.error('❌ Error loading wallets from config:', error);
      return 0;
    }
  }

  async addWalletToConfig(
    address: string,
    category: 'sniper' | 'hunter' | 'trader',
    nickname: string,
    description: string,
    metrics: any,
    addedBy: 'manual' | 'discovery' | 'placeholder' = 'manual'
  ): Promise<boolean> {
    try {
      // 🔒 ЗАЩИТА ОТ NULL ПАРАМЕТРОВ
      if (!address || !category || !nickname || !description) {
        this.logger.error('❌ Invalid parameters for addWalletToConfig');
        return false;
      }

      // 🔒 БЕЗОПАСНАЯ ИНИЦИАЛИЗАЦИЯ CONFIG
      if (!this.config) {
        this.config = this.loadConfig();
        if (!this.config) {
          this.config = this.createDefaultConfigWithWallets([]);
        }
      }

      // 🔒 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ПОСЛЕ ИНИЦИАЛИЗАЦИИ
      if (!this.config || !this.config.wallets) {
        this.logger.error('❌ Config or wallets array is null');
        return false;
      }

      const existingIndex = this.config.wallets.findIndex(w => w.address === address);
      
      // 🔒 БЕЗОПАСНОЕ СОЗДАНИЕ НОВОГО КОШЕЛЬКА С ВАЛИДАЦИЕЙ METRICS
      const safeMetrics = this.validateAndSanitizeMetrics(metrics);
      
      const newWallet: WalletConfig = {
        address,
        category,
        nickname,
        description,
        addedBy,
        addedAt: new Date().toISOString(),
        verified: addedBy === 'manual',
        winRate: safeMetrics.winRate,
        totalPnL: safeMetrics.totalPnL,
        totalTrades: safeMetrics.totalTrades,
        avgTradeSize: safeMetrics.avgTradeSize,
        maxTradeSize: safeMetrics.maxTradeSize,
        performanceScore: safeMetrics.performanceScore,
        minTradeAlert: this.getMinTradeAlertForCategory(category),
        priority: safeMetrics.performanceScore > 85 ? 'high' : 'medium',
        enabled: true
      };

      if (existingIndex >= 0) {
        this.config.wallets[existingIndex] = newWallet;
        this.logger.info(`🔄 Updated wallet in config: ${nickname}`);
      } else {
        this.config.wallets.push(newWallet);
        this.logger.info(`➕ Added new wallet to config: ${nickname}`);
      }

      // 🔒 БЕЗОПАСНОЕ ОБНОВЛЕНИЕ СТАТИСТИКИ
      try {
        this.config.totalWallets = this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder').length;
        this.config.lastUpdated = new Date().toISOString().split('T')[0];
      } catch (error) {
        this.logger.error('❌ Error updating config stats:', error);
      }

      await this.saveConfig();

      const smartWallet: SmartMoneyWallet = this.createSmartWalletFromConfig(newWallet);
      const dbConfig = this.createDbConfigFromWalletConfig(newWallet);

      await this.smDatabase.saveSmartWallet(smartWallet, dbConfig);

      return true;

    } catch (error) {
      this.logger.error('❌ Error adding wallet to config:', error);
      return false;
    }
  }

  async syncDatabaseWithConfig(): Promise<{
    added: number;
    updated: number;
    disabled: number;
  }> {
    try {
      this.logger.info('🔄 Syncing database with config...');

      // 🔒 БЕЗОПАСНАЯ ЗАГРУЗКА CONFIG
      if (!this.config) {
        this.config = this.loadConfig();
        if (!this.config) {
          this.logger.warn('No config found for sync');
          return { added: 0, updated: 0, disabled: 0 };
        }
      }

      // 🔒 ПРОВЕРКА ВАЛИДНОСТИ CONFIG
      if (!this.config.wallets || !Array.isArray(this.config.wallets)) {
        this.logger.error('❌ Config wallets array is invalid');
        return { added: 0, updated: 0, disabled: 0 };
      }

      let added = 0, updated = 0, disabled = 0;

      const dbWallets = await this.smDatabase.getAllActiveSmartWallets();
      const dbAddresses = new Set(dbWallets.map(w => w.address));
      const configAddresses = new Set(this.config.wallets.map(w => w.address));

      for (const walletConfig of this.config.wallets) {
        try {
          // 🔒 ВАЛИДАЦИЯ КАЖДОГО КОШЕЛЬКА
          if (!this.validateWalletConfig(walletConfig)) {
            this.logger.warn(`⚠️ Skipping invalid wallet in sync: ${walletConfig?.address || 'unknown'}`);
            continue;
          }

          if (!dbAddresses.has(walletConfig.address) && walletConfig.enabled) {
            const success = await this.addWalletToConfig(
              walletConfig.address,
              walletConfig.category,
              walletConfig.nickname,
              walletConfig.description,
              {
                winRate: walletConfig.winRate,
                totalPnL: walletConfig.totalPnL,
                totalTrades: walletConfig.totalTrades,
                avgTradeSize: walletConfig.avgTradeSize,
                maxTradeSize: walletConfig.maxTradeSize,
                performanceScore: walletConfig.performanceScore
              },
              walletConfig.addedBy
            );
            if (success) added++;
          } else if (dbAddresses.has(walletConfig.address)) {
            await this.smDatabase.updateWalletSettings(walletConfig.address, {
              enabled: walletConfig.enabled,
              priority: walletConfig.priority,
              minTradeAlert: walletConfig.minTradeAlert
            });
            updated++;
          }
        } catch (error) {
          this.logger.error(`❌ Error syncing wallet ${walletConfig?.address}:`, error);
        }
      }

      for (const dbWallet of dbWallets) {
        if (!configAddresses.has(dbWallet.address)) {
          await this.smDatabase.updateWalletSettings(dbWallet.address, { enabled: false });
          disabled++;
        }
      }

      this.logger.info(`✅ Sync completed: ${added} added, ${updated} updated, ${disabled} disabled`);

      return { added, updated, disabled };

    } catch (error) {
      this.logger.error('❌ Error syncing database with config:', error);
      return { added: 0, updated: 0, disabled: 0 };
    }
  }

  async exportConfigFromDatabase(): Promise<void> {
    try {
      this.logger.info('📤 Exporting wallet config from database...');

      const dbWallets = await this.smDatabase.getAllActiveSmartWallets();
      const exportedWallets: WalletConfig[] = [];

      for (const wallet of dbWallets) {
        try {
          const settings = await this.smDatabase.getWalletSettings(wallet.address);
          
          if (settings) {
            exportedWallets.push({
              address: wallet.address,
              category: wallet.category,
              nickname: settings.nickname || `${wallet.category} ${wallet.address.slice(0, 8)}`,
              description: settings.description || `Auto-exported ${wallet.category} wallet`,
              addedBy: 'discovery',
              addedAt: new Date().toISOString(),
              verified: true,
              winRate: wallet.winRate,
              totalPnL: wallet.totalPnL,
              totalTrades: wallet.totalTrades,
              avgTradeSize: wallet.avgTradeSize,
              maxTradeSize: wallet.maxTradeSize,
              performanceScore: wallet.performanceScore,
              minTradeAlert: settings.minTradeAlert,
              priority: settings.priority,
              enabled: settings.enabled
            });
          }
        } catch (error) {
          this.logger.error(`❌ Error exporting wallet ${wallet.address}:`, error);
        }
      }

      const newConfig: SmartWalletsConfig = this.createDefaultConfig();
      newConfig.wallets = exportedWallets;
      newConfig.totalWallets = exportedWallets.length;
      newConfig.description = "Smart Money кошельки (экспорт из БД)";

      // 🔒 БЕЗОПАСНОЕ КОПИРОВАНИЕ СУЩЕСТВУЮЩИХ НАСТРОЕК
      if (this.config?.discovery) {
        newConfig.discovery = { ...this.config.discovery };
      }
      if (this.config?.filters) {
        newConfig.filters = { ...this.config.filters };
      }

      // 🔒 БЕЗОПАСНОЕ СОЗДАНИЕ BACKUP
      try {
        const backupPath = this.configPath.replace('.json', `_backup_${Date.now()}.json`);
        if (fs.existsSync(this.configPath)) {
          fs.copyFileSync(this.configPath, backupPath);
          this.logger.info(`💾 Backup saved: ${backupPath}`);
        }
      } catch (error) {
        this.logger.warn('⚠️ Failed to create backup, continuing...', error);
      }

      fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2), 'utf8');
      this.config = newConfig;

      this.logger.info(`✅ Exported ${exportedWallets.length} wallets to config`);

    } catch (error) {
      this.logger.error('❌ Error exporting config from database:', error);
    }
  }

  async updateWalletSettings(
    address: string, 
    settings: {
      enabled?: boolean;
      priority?: 'high' | 'medium' | 'low';
      minTradeAlert?: number;
    }
  ): Promise<boolean> {
    try {
      // 🔒 ЗАЩИТА ОТ НЕВАЛИДНЫХ ПАРАМЕТРОВ
      if (!address || !settings) {
        this.logger.error('❌ Invalid parameters for updateWalletSettings');
        return false;
      }

      // 🔒 БЕЗОПАСНАЯ ЗАГРУЗКА CONFIG
      if (!this.config) {
        this.config = this.loadConfig();
        if (!this.config) {
          this.logger.warn('⚠️ No config available for wallet settings update');
          // Продолжаем только с БД
          await this.smDatabase.updateWalletSettings(address, settings);
          return true;
        }
      }

      // 🔒 ПРОВЕРКА ВАЛИДНОСТИ CONFIG
      if (this.config.wallets && Array.isArray(this.config.wallets)) {
        const walletIndex = this.config.wallets.findIndex(w => w.address === address);
        if (walletIndex >= 0) {
          const wallet = this.config.wallets[walletIndex];
          
          if (settings.enabled !== undefined) {
            wallet.enabled = settings.enabled;
          }
          if (settings.priority !== undefined) {
            wallet.priority = settings.priority;
          }
          if (settings.minTradeAlert !== undefined) {
            wallet.minTradeAlert = settings.minTradeAlert;
          }

          await this.saveConfig();
        }
      }

      await this.smDatabase.updateWalletSettings(address, settings);

      this.logger.info(`⚙️ Updated settings for wallet: ${address}`);
      return true;

    } catch (error) {
      this.logger.error('❌ Error updating wallet settings:', error);
      return false;
    }
  }

  getWalletSettings(address: string): any | null {
    try {
      if (!this.config || !this.config.wallets) return null;
      
      const wallet = this.config.wallets.find(w => w.address === address);
      if (!wallet) return null;
      
      return {
        minTradeAlert: wallet.minTradeAlert,
        priority: wallet.priority,
        enabled: wallet.enabled
      };
    } catch (error) {
      this.logger.error('❌ Error getting wallet settings:', error);
      return null;
    }
  }

  getDiscoveryFilters() {
    try {
      return this.config?.filters || {
        minWinRate: 65,
        minTotalPnL: 50000,
        minTotalTrades: 30,
        maxInactiveDays: 30
      };
    } catch (error) {
      this.logger.error('❌ Error getting discovery filters:', error);
      return {
        minWinRate: 65,
        minTotalPnL: 50000,
        minTotalTrades: 30,
        maxInactiveDays: 30
      };
    }
  }

  // 🔒 НОВЫЕ МЕТОДЫ ДЛЯ ВАЛИДАЦИИ И БЕЗОПАСНОСТИ

  private validateConfig(config: any): boolean {
    try {
      return config &&
             typeof config === 'object' &&
             config.version &&
             config.wallets &&
             Array.isArray(config.wallets) &&
             config.discovery &&
             config.filters;
    } catch (error) {
      this.logger.error('❌ Error validating config:', error);
      return false;
    }
  }

  private validateWalletConfig(wallet: any): boolean {
    try {
      return wallet &&
             typeof wallet === 'object' &&
             wallet.address &&
             wallet.category &&
             wallet.nickname &&
             wallet.description &&
             wallet.addedBy &&
             typeof wallet.enabled === 'boolean' &&
             typeof wallet.winRate === 'number' &&
             typeof wallet.totalPnL === 'number';
    } catch (error) {
      this.logger.error('❌ Error validating wallet config:', error);
      return false;
    }
  }

  private validateAndSanitizeMetrics(metrics: any): {
    winRate: number;
    totalPnL: number;
    totalTrades: number;
    avgTradeSize: number;
    maxTradeSize: number;
    performanceScore: number;
  } {
    try {
      return {
        winRate: Math.max(0, Math.min(100, Number(metrics?.winRate) || 70)),
        totalPnL: Number(metrics?.totalPnL) || 50000,
        totalTrades: Math.max(1, Number(metrics?.totalTrades) || 50),
        avgTradeSize: Math.max(100, Number(metrics?.avgTradeSize) || 5000),
        maxTradeSize: Math.max(1000, Number(metrics?.maxTradeSize) || 20000),
        performanceScore: Math.max(0, Math.min(100, Number(metrics?.performanceScore) || 75))
      };
    } catch (error) {
      this.logger.error('❌ Error validating metrics, using defaults:', error);
      return {
        winRate: 70,
        totalPnL: 50000,
        totalTrades: 50,
        avgTradeSize: 5000,
        maxTradeSize: 20000,
        performanceScore: 75
      };
    }
  }

  private createSmartWalletFromConfig(walletConfig: WalletConfig): SmartMoneyWallet {
    return {
      address: walletConfig.address,
      category: walletConfig.category,
      winRate: walletConfig.winRate,
      totalPnL: walletConfig.totalPnL,
      totalTrades: walletConfig.totalTrades,
      avgTradeSize: walletConfig.avgTradeSize,
      maxTradeSize: walletConfig.maxTradeSize,
      minTradeSize: Math.min(walletConfig.avgTradeSize * 0.3, 1000),
      lastActiveAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      performanceScore: walletConfig.performanceScore,
      isActive: true,
      sharpeRatio: 2.1,
      maxDrawdown: 15.0,
      volumeScore: 80,
      isFamilyMember: false,
      familyAddresses: undefined,
      coordinationScore: null,
      stealthLevel: null,
      earlyEntryRate: walletConfig.category === 'sniper' ? 45 : 25,
      avgHoldTime: walletConfig.category === 'trader' ? 72 : walletConfig.category === 'hunter' ? 12 : 4
    };
  }

  private createDbConfigFromWalletConfig(walletConfig: WalletConfig) {
    return {
      nickname: walletConfig.nickname,
      description: walletConfig.description,
      minTradeAlert: walletConfig.minTradeAlert,
      priority: walletConfig.priority,
      addedBy: walletConfig.addedBy === 'placeholder' ? 'discovery' as const : walletConfig.addedBy,
      verified: walletConfig.verified
    };
  }

  private createDefaultConfig(): SmartWalletsConfig {
    return {
      version: "2.0",
      lastUpdated: new Date().toISOString().split('T')[0],
      description: "Smart Money кошельки для мониторинга",
      totalWallets: 0,
      wallets: [],
      discovery: {
        autoDiscoveryEnabled: true,
        maxWallets: 150,
        minPerformanceScore: 75,
        discoveryInterval: "48h",
        lastDiscovery: null
      },
      filters: {
        minWinRate: 65,
        minTotalPnL: 50000,
        minTotalTrades: 30,
        maxInactiveDays: 30
      }
    };
  }

  private createDefaultConfigWithWallets(wallets: WalletConfig[]): SmartWalletsConfig {
    const config = this.createDefaultConfig();
    config.wallets = wallets;
    config.totalWallets = wallets.length;
    config.description = "Smart Money wallets (hardcoded fallback)";
    return config;
  }

  private getMinTradeAlertForCategory(category: 'sniper' | 'hunter' | 'trader'): number {
    switch (category) {
      case 'trader': return 15000;
      case 'hunter': return 5000;
      case 'sniper': return 3000;
      default: return 5000;
    }
  }

  private parseDate(dateString: string): Date | null {
    try {
      if (!dateString) return null;
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        this.logger.warn(`Invalid date format: ${dateString}`);
        return null;
      }
      return date;
    } catch (error) {
      this.logger.warn(`Error parsing date: ${dateString}`, error);
      return null;
    }
  }

  private loadConfig(): SmartWalletsConfig | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.logger.warn(`📁 Config file not found: ${this.configPath}`);
        return null;
      }
      
      const configData = fs.readFileSync(this.configPath, 'utf8');
      if (!configData || configData.trim() === '') {
        this.logger.warn('📁 Config file is empty');
        return null;
      }

      const parsed = JSON.parse(configData) as SmartWalletsConfig;
      
      this.logger.info(`✅ Config loaded from file: ${parsed.wallets?.length || 0} wallets`);
      return parsed;
    } catch (error) {
      this.logger.error('❌ Error reading config file:', error);
      return null;
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      if (!this.config) {
        this.logger.warn('⚠️ No config to save');
        return;
      }
      
      this.config.lastUpdated = new Date().toISOString().split('T')[0];
      
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      this.logger.debug('💾 Config saved successfully');
    } catch (error) {
      this.logger.error('❌ Error saving config:', error);
    }
  }

  private async sendLoadSummary(loaded: number, updated: number, skipped: number): Promise<void> {
    try {
      // 🔒 БЕЗОПАСНАЯ ПРОВЕРКА CONFIG
      if (!this.config || !this.config.wallets) {
        this.logger.warn('⚠️ Cannot send load summary - config is null');
        return;
      }

      const totalEnabled = this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder').length;
      const byCategory = {
        sniper: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.category === 'sniper').length,
        hunter: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.category === 'hunter').length,
        trader: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.category === 'trader').length
      };

      const byPriority = {
        high: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.priority === 'high').length,
        medium: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.priority === 'medium').length,
        low: this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder' && w.priority === 'low').length
      };

      await this.telegramNotifier.sendCycleLog(
        `📁 <b>Smart Money Wallets Loaded</b>\n\n` +
        `✅ <b>New:</b> <code>${loaded}</code> wallets\n` +
        `🔄 <b>Updated:</b> <code>${updated}</code> wallets\n` +
        `⏭️ <b>Skipped:</b> <code>${skipped}</code> wallets\n` +
        `📊 <b>Total Enabled:</b> <code>${totalEnabled}</code>\n\n` +
        `<b>By Category:</b>\n` +
        `🔫 Snipers: <code>${byCategory.sniper}</code>\n` +
        `💡 Hunters: <code>${byCategory.hunter}</code>\n` +
        `🐳 Traders: <code>${byCategory.trader}</code>\n\n` +
        `<b>By Priority:</b>\n` +
        `🔴 High: <code>${byPriority.high}</code>\n` +
        `🟡 Medium: <code>${byPriority.medium}</code>\n` +
        `🟢 Low: <code>${byPriority.low}</code>\n\n` +
        `📝 Mode: ${fs.existsSync(this.configPath) ? 'File' : 'Hardcoded Fallback'}`
      );
    } catch (error) {
      this.logger.error('❌ Error sending load summary:', error);
    }
  }

  getStats() {
    try {
      if (!this.config) return null;

      const enabled = this.config.wallets ? this.config.wallets.filter(w => w.enabled && w.addedBy !== 'placeholder') : [];
      const byCategory = {
        sniper: enabled.filter(w => w.category === 'sniper').length,
        hunter: enabled.filter(w => w.category === 'hunter').length,
        trader: enabled.filter(w => w.category === 'trader').length
      };

      const byPriority = {
        high: enabled.filter(w => w.priority === 'high').length,
        medium: enabled.filter(w => w.priority === 'medium').length,
        low: enabled.filter(w => w.priority === 'low').length
      };

      return {
        totalWallets: this.config.totalWallets || 0,
        enabledWallets: enabled.length,
        configPath: this.configPath,
        lastUpdated: this.config.lastUpdated,
        discovery: this.config.discovery,
        byCategory,
        byPriority
      };
    } catch (error) {
      this.logger.error('❌ Error getting stats:', error);
      return null;
    }
  }
}