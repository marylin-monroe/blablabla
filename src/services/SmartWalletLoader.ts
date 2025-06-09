// src/services/SmartWalletLoader.ts
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
  metrics: {
    winRate: number;
    totalPnL: number;
    totalTrades: number;
    avgTradeSize: number;
    maxTradeSize: number;
    performanceScore: number;
  };
  settings: {
    minTradeAlert: number;
    priority: 'high' | 'medium' | 'low';
    enabled: boolean; // Добавлено недостающее свойство
  };
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

  // Загрузка кошельков из конфиг файла при старте бота
  async loadWalletsFromConfig(): Promise<number> {
    try {
      this.logger.info('📁 Loading Smart Money wallets from config...');

      // Создаем папку data если её нет
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Проверяем существует ли конфиг файл
      if (!fs.existsSync(this.configPath)) {
        this.logger.info('📝 Config file not found, creating default...');
        await this.createDefaultConfig();
      }

      // Читаем конфиг
      this.config = this.loadConfig();
      if (!this.config) {
        throw new Error('Failed to load config');
      }

      // Загружаем кошельки в базу данных
      let loadedCount = 0;
      let skippedCount = 0;

      for (const walletConfig of this.config.wallets) {
        // Пропускаем placeholder'ы и отключенные кошельки
        if (walletConfig.addedBy === 'placeholder' || !walletConfig.settings.enabled) {
          skippedCount++;
          continue;
        }

        // Проверяем есть ли уже в базе
        const existingWallet = await this.smDatabase.getSmartWallet(walletConfig.address);
        
        if (!existingWallet) {
          // Создаем SmartMoneyWallet объект
          const smartWallet: SmartMoneyWallet = {
            address: walletConfig.address,
            category: walletConfig.category,
            winRate: walletConfig.metrics.winRate,
            totalPnL: walletConfig.metrics.totalPnL,
            totalTrades: walletConfig.metrics.totalTrades,
            avgTradeSize: walletConfig.metrics.avgTradeSize,
            maxTradeSize: walletConfig.metrics.maxTradeSize,
            minTradeSize: Math.min(walletConfig.metrics.avgTradeSize * 0.5, 1000),
            lastActiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Вчера
            performanceScore: walletConfig.metrics.performanceScore,
            isActive: true,
            sharpeRatio: 2.1,
            maxDrawdown: 15.0,
            volumeScore: 80,
            isFamilyMember: false,
            familyAddresses: [],
            coordinationScore: 0,
            stealthLevel: 60,
            earlyEntryRate: 40,
            avgHoldTime: 24
          };

          await this.smDatabase.saveSmartWallet(smartWallet);
          loadedCount++;

          this.logger.info(`✅ Loaded wallet: ${walletConfig.nickname} (${walletConfig.category})`);
        } else {
          this.logger.info(`⏭️ Wallet already exists: ${walletConfig.nickname}`);
        }
      }

      // Обновляем статистику в конфиге
      this.config.totalWallets = this.config.wallets.filter(w => w.settings.enabled && w.addedBy !== 'placeholder').length;
      this.config.lastUpdated = new Date().toISOString().split('T')[0];
      await this.saveConfig();

      this.logger.info(`📊 Loaded ${loadedCount} wallets, skipped ${skippedCount}`);

      // Отправляем уведомление в Telegram
      await this.sendLoadSummary(loadedCount, skippedCount);

      return loadedCount;

    } catch (error) {
      this.logger.error('❌ Error loading wallets from config:', error);
      return 0;
    }
  }

  // Добавление нового кошелька в конфиг (ручное или автоматическое)
  async addWalletToConfig(
    address: string,
    category: 'sniper' | 'hunter' | 'trader',
    nickname: string,
    description: string,
    metrics: any,
    addedBy: 'manual' | 'discovery' = 'manual'
  ): Promise<boolean> {
    try {
      if (!this.config) {
        this.config = this.loadConfig();
      }

      // Проверяем нет ли уже такого кошелька
      const existingIndex = this.config!.wallets.findIndex(w => w.address === address);
      
      const newWallet: WalletConfig = {
        address,
        category,
        nickname,
        description,
        addedBy,
        addedAt: new Date().toISOString().split('T')[0],
        verified: addedBy === 'manual',
        metrics: {
          winRate: metrics.winRate || 0,
          totalPnL: metrics.totalPnL || 0,
          totalTrades: metrics.totalTrades || 0,
          avgTradeSize: metrics.avgTradeSize || 0,
          maxTradeSize: metrics.maxTradeSize || 0,
          performanceScore: metrics.performanceScore || 0
        },
        settings: {
          minTradeAlert: category === 'trader' ? 15000 : category === 'hunter' ? 5000 : 3000,
          priority: metrics.performanceScore > 85 ? 'high' : 'medium',
          enabled: true
        }
      };

      if (existingIndex >= 0) {
        // Обновляем существующий
        this.config!.wallets[existingIndex] = newWallet;
        this.logger.info(`🔄 Updated wallet in config: ${nickname}`);
      } else {
        // Добавляем новый
        this.config!.wallets.push(newWallet);
        this.logger.info(`➕ Added new wallet to config: ${nickname}`);
      }

      // Обновляем метаданные
      this.config!.totalWallets = this.config!.wallets.filter(w => w.settings.enabled && w.addedBy !== 'placeholder').length;
      this.config!.lastUpdated = new Date().toISOString().split('T')[0];

      // Сохраняем конфиг
      await this.saveConfig();

      // Добавляем в базу данных
      const smartWallet: SmartMoneyWallet = {
        address,
        category,
        winRate: metrics.winRate || 0,
        totalPnL: metrics.totalPnL || 0,
        totalTrades: metrics.totalTrades || 0,
        avgTradeSize: metrics.avgTradeSize || 0,
        maxTradeSize: metrics.maxTradeSize || 0,
        minTradeSize: Math.min(metrics.avgTradeSize * 0.5 || 1000, 1000),
        lastActiveAt: new Date(),
        performanceScore: metrics.performanceScore || 0,
        isActive: true,
        sharpeRatio: 2.1,
        maxDrawdown: 15.0,
        volumeScore: 80,
        isFamilyMember: false,
        familyAddresses: [],
        coordinationScore: 0,
        stealthLevel: 60,
        earlyEntryRate: 40,
        avgHoldTime: 24
      };

      await this.smDatabase.saveSmartWallet(smartWallet);

      return true;

    } catch (error) {
      this.logger.error('❌ Error adding wallet to config:', error);
      return false;
    }
  }

  // Получение настроек для конкретного кошелька
  getWalletSettings(address: string): WalletConfig['settings'] | null {
    if (!this.config) return null;
    
    const wallet = this.config.wallets.find(w => w.address === address);
    return wallet?.settings || null;
  }

  // Получение фильтров для discovery
  getDiscoveryFilters() {
    return this.config?.filters || {
      minWinRate: 65,
      minTotalPnL: 50000,
      minTotalTrades: 30,
      maxInactiveDays: 30
    };
  }

  // Создание дефолтного конфига
  private async createDefaultConfig(): Promise<void> {
    const defaultConfig: SmartWalletsConfig = {
      version: "1.0",
      lastUpdated: new Date().toISOString().split('T')[0],
      description: "Smart Money кошельки для мониторинга",
      totalWallets: 0,
      wallets: [],
      discovery: {
        autoDiscoveryEnabled: true,
        maxWallets: 150,
        minPerformanceScore: 75,
        discoveryInterval: "14d",
        lastDiscovery: null
      },
      filters: {
        minWinRate: 65,
        minTotalPnL: 50000,
        minTotalTrades: 30,
        maxInactiveDays: 30
      }
    };

    fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    this.logger.info(`📝 Created default config at: ${this.configPath}`);
  }

  // Чтение конфига из файла
  private loadConfig(): SmartWalletsConfig | null {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData) as SmartWalletsConfig;
    } catch (error) {
      this.logger.error('❌ Error reading config file:', error);
      return null;
    }
  }

  // Сохранение конфига в файл
  private async saveConfig(): Promise<void> {
    try {
      if (!this.config) return;
      
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      this.logger.debug('💾 Config saved successfully');
    } catch (error) {
      this.logger.error('❌ Error saving config:', error);
    }
  }

  // Отправка сводки загрузки в Telegram
  private async sendLoadSummary(loaded: number, skipped: number): Promise<void> {
    try {
      const totalEnabled = this.config?.wallets.filter(w => w.settings.enabled && w.addedBy !== 'placeholder').length || 0;
      const byCategory = {
        sniper: this.config?.wallets.filter(w => w.settings.enabled && w.category === 'sniper').length || 0,
        hunter: this.config?.wallets.filter(w => w.settings.enabled && w.category === 'hunter').length || 0,
        trader: this.config?.wallets.filter(w => w.settings.enabled && w.category === 'trader').length || 0
      };

      await this.telegramNotifier.sendCycleLog(
        `📁 <b>Smart Money Wallets Loaded</b>\n\n` +
        `✅ <b>Loaded:</b> <code>${loaded}</code> wallets\n` +
        `⏭️ <b>Skipped:</b> <code>${skipped}</code> wallets\n` +
        `📊 <b>Total Active:</b> <code>${totalEnabled}</code>\n\n` +
        `🔫 <b>Snipers:</b> <code>${byCategory.sniper}</code>\n` +
        `💡 <b>Hunters:</b> <code>${byCategory.hunter}</code>\n` +
        `🐳 <b>Traders:</b> <code>${byCategory.trader}</code>\n\n` +
        `📝 Config: <code>data/smart_wallets.json</code>`
      );
    } catch (error) {
      this.logger.error('Error sending load summary:', error);
    }
  }

  // Получение статистики
  getStats() {
    if (!this.config) return null;

    return {
      totalWallets: this.config.totalWallets,
      enabledWallets: this.config.wallets.filter(w => w.settings.enabled).length,
      configPath: this.configPath,
      lastUpdated: this.config.lastUpdated,
      discovery: this.config.discovery
    };
  }
}