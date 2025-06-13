// src/main.ts - ОПТИМИЗИРОВАННЫЙ ДЛЯ API ЭКОНОМИИ + АГРЕГАЦИЯ ПОЗИЦИЙ + 48h DISCOVERY - С АВТОМАТИЧЕСКОЙ МИГРАЦИЕЙ БД + ИСПРАВЛЕНА FOREIGN KEY ПРОБЛЕМА + TELEGRAM КОМАНДЫ + 🆕 EXTERNAL SEARCH - ИСПРАВЛЕНЫ ОШИБКИ ТАЙМЕРОВ И TYPESCRIPT
import * as dotenv from 'dotenv';
import { SolanaMonitor } from './services/SolanaMonitor';
import { TelegramNotifier } from './services/TelegramNotifier';
import { Database } from './services/Database';
import { SmartMoneyDatabase } from './services/SmartMoneyDatabase';
import { SmartMoneyFlowAnalyzer } from './services/SmartMoneyFlowAnalyzer';
import { SmartWalletDiscovery } from './services/SmartWalletDiscovery';
import { WebhookServer } from './services/WebhookServer';
import { QuickNodeWebhookManager } from './services/QuickNodeWebhookManager';
import { Logger } from './utils/Logger';
import { SmartWalletLoader } from './services/SmartWalletLoader';
import * as path from 'path';
import * as fs from 'fs';
import BetterSQLite3 from 'better-sqlite3';

dotenv.config();

class SmartMoneyBotRunner {
  private solanaMonitor: SolanaMonitor;
  private database: Database;
  private smDatabase: SmartMoneyDatabase;
  private telegramNotifier: TelegramNotifier;
  private flowAnalyzer: SmartMoneyFlowAnalyzer;
  private walletDiscovery: SmartWalletDiscovery;
  private webhookServer: WebhookServer;
  private webhookManager: QuickNodeWebhookManager; 
  private logger: Logger;
  private smartWalletLoader: SmartWalletLoader;
  
  private isRunning: boolean = false;
  private webhookId: string | null = null;
  private intervalIds: NodeJS.Timeout[] = [];
  private timeoutIds: NodeJS.Timeout[] = []; // 🔧 НОВЫЙ МАССИВ ДЛЯ TIMEOUTS

  constructor() {
    this.logger = Logger.getInstance();
    
    this.validateEnvironment();

    this.database = new Database();
    this.smDatabase = new SmartMoneyDatabase();
    
    this.telegramNotifier = new TelegramNotifier(
      process.env.TELEGRAM_BOT_TOKEN!,
      process.env.TELEGRAM_USER_ID!
    );

    this.smartWalletLoader = new SmartWalletLoader(this.smDatabase, this.telegramNotifier);

    // 🎯 SOLANA MONITOR ТЕПЕРЬ С АГРЕГАЦИЕЙ ПОЗИЦИЙ
    this.solanaMonitor = new SolanaMonitor(this.database, this.telegramNotifier);
    
    this.flowAnalyzer = new SmartMoneyFlowAnalyzer(this.smDatabase, this.telegramNotifier, this.database);
    
    this.walletDiscovery = new SmartWalletDiscovery(this.smDatabase, this.database);
    
    // 🎯 WEBHOOK SERVER С ФИЛЬТРАМИ + АГРЕГАЦИЕЙ
    this.webhookServer = new WebhookServer(
      this.database, 
      this.telegramNotifier, 
      this.solanaMonitor,
      this.smDatabase
    );
    
    this.webhookManager = new QuickNodeWebhookManager();

    // 🆕 ДИНАМИЧЕСКОЕ логгирование на основе доступности внешнего поиска
    const externalSearchStatus = this.walletDiscovery.isExternalSearchEnabled?.() ? '+ EXTERNAL SEARCH' : '';
    this.logger.info(`✅ Smart Money Bot services initialized (OPTIMIZED + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS ${externalSearchStatus})`);
  }

  // 🔧 НОВЫЙ МЕТОД: АВТОМАТИЧЕСКАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ
  private async performDatabaseMigration(): Promise<void> {
    try {
      this.logger.info('🔧 Checking database schema and performing migrations...');

      // Определяем путь к основной базе данных
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        this.logger.info('📁 Created data directory');
      }

      const mainDbPath = path.join(dataDir, 'token_tracker.db');
      
      // Проверяем существование файла БД
      const dbExists = fs.existsSync(mainDbPath);
      if (!dbExists) {
        this.logger.info('📊 Database file does not exist, will be created with latest schema');
        return; // Новая БД будет создана с правильной схемой
      }

      this.logger.info('🔍 Existing database found, checking schema...');

      // Открываем БД для миграции
      const migrationDb = new BetterSQLite3(mainDbPath);
      
      try {
        // Проверяем существование колонки is_aggregated
        const tableInfo = migrationDb.prepare("PRAGMA table_info(token_swaps)").all();
        const hasAggregatedColumn = tableInfo.some((col: any) => col.name === 'is_aggregated');
        
        if (!hasAggregatedColumn) {
          this.logger.info('🔧 Adding missing column: is_aggregated');
          migrationDb.exec('ALTER TABLE token_swaps ADD COLUMN is_aggregated INTEGER DEFAULT 0');
        }

        // Проверяем другие возможные недостающие колонки
        const hasProcessedColumn = tableInfo.some((col: any) => col.name === 'processed_for_aggregation');
        if (!hasProcessedColumn) {
          this.logger.info('🔧 Adding missing column: processed_for_aggregation');
          migrationDb.exec('ALTER TABLE token_swaps ADD COLUMN processed_for_aggregation INTEGER DEFAULT 0');
        }

        const hasAggregationIdColumn = tableInfo.some((col: any) => col.name === 'aggregation_id');
        if (!hasAggregationIdColumn) {
          this.logger.info('🔧 Adding missing column: aggregation_id');
          migrationDb.exec('ALTER TABLE token_swaps ADD COLUMN aggregation_id TEXT');
        }

        const hasSuspicionScoreColumn = tableInfo.some((col: any) => col.name === 'suspicion_score');
        if (!hasSuspicionScoreColumn) {
          this.logger.info('🔧 Adding missing column: suspicion_score');
          migrationDb.exec('ALTER TABLE token_swaps ADD COLUMN suspicion_score INTEGER DEFAULT 0');
        }

        // Проверяем и создаем недостающие индексы
        try {
          const indexExists = migrationDb.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='index' AND name='idx_token_swaps_aggregated'
          `).get();

          if (!indexExists) {
            this.logger.info('🔧 Creating missing index: idx_token_swaps_aggregated');
            migrationDb.exec('CREATE INDEX idx_token_swaps_aggregated ON token_swaps(is_aggregated)');
          }
        } catch (indexError) {
          this.logger.debug('Index creation info:', indexError);
        }

        // Проверяем таблицу position_aggregations
        try {
          migrationDb.prepare("SELECT COUNT(*) FROM position_aggregations").get();
        } catch (tableError) {
          this.logger.info('🔧 Creating missing table: position_aggregations');
          migrationDb.exec(`
            CREATE TABLE position_aggregations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              aggregation_id TEXT UNIQUE,
              token_address TEXT,
              wallet_addresses TEXT,
              total_amount_usd REAL,
              purchase_count INTEGER,
              avg_amount_usd REAL,
              time_window_start DATETIME,
              time_window_end DATETIME,
              suspicion_score INTEGER,
              detection_timestamp DATETIME,
              is_processed INTEGER DEFAULT 0,
              alert_sent INTEGER DEFAULT 0,
              notes TEXT
            )
          `);

          migrationDb.exec('CREATE INDEX idx_position_aggregations_token ON position_aggregations(token_address)');
          migrationDb.exec('CREATE INDEX idx_position_aggregations_suspicion ON position_aggregations(suspicion_score)');
          migrationDb.exec('CREATE INDEX idx_position_aggregations_processed ON position_aggregations(is_processed)');
        }

        this.logger.info('✅ Database schema migration completed successfully');

      } catch (migrationError) {
        this.logger.error('❌ Migration error:', migrationError);
        throw migrationError;
      } finally {
        migrationDb.close();
      }

    } catch (error) {
      this.logger.error('❌ Critical database migration error:', error);
      throw error;
    }
  }

  private validateEnvironment(): void {
    const requiredVars = [
      'QUICKNODE_HTTP_URL',
      'QUICKNODE_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_USER_ID',
      // 🔧 ДОБАВЛЕНЫ ALCHEMY ПЕРЕМЕННЫЕ
      'ALCHEMY_HTTP_URL',
      'ALCHEMY_API_KEY'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    this.logger.info('✅ Environment variables validated');
  }

  private detectRenderURL(): string {
    if (process.env.RENDER_EXTERNAL_URL) {
      this.logger.info(`🔗 Using RENDER_EXTERNAL_URL: ${process.env.RENDER_EXTERNAL_URL}`);
      return process.env.RENDER_EXTERNAL_URL;
    }

    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      const renderUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
      this.logger.info(`🔗 Detected from RENDER_EXTERNAL_HOSTNAME: ${renderUrl}`);
      return renderUrl;
    }

    if (process.env.RENDER_SERVICE_NAME) {
      const renderUrl = `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
      this.logger.info(`🔗 Constructed from RENDER_SERVICE_NAME: ${renderUrl}`);
      return renderUrl;
    }

    if (process.env.PORT && process.env.PORT !== '3000') {
      const gitRemote = process.env.GIT_REMOTE_URL || '';
      if (gitRemote.includes('github.com')) {
        const repoMatch = gitRemote.match(/github\.com[/:](.*?)\/(.+?)(?:\.git)?$/);
        if (repoMatch) {
          const repoName = repoMatch[2].replace('.git', '');
          const renderUrl = `https://${repoName}.onrender.com`;
          this.logger.info(`🔗 Guessed from git repo: ${renderUrl}`);
          return renderUrl;
        }
      }
    }

    const renderVars = [
      'RENDER_EXTERNAL_URL',
      'RENDER_SERVICE_URL', 
      'RENDER_APP_URL',
      'RENDER_EXTERNAL_HOSTNAME'
    ];

    for (const varName of renderVars) {
      if (process.env[varName]) {
        const url = process.env[varName].startsWith('http') 
          ? process.env[varName] 
          : `https://${process.env[varName]}`;
        this.logger.info(`🔗 Found in ${varName}: ${url}`);
        return url;
      }
    }

    const fallbackUrl = 'https://smart-money-tracker.onrender.com';
    this.logger.warn(`⚠️ Could not detect Render URL, using fallback: ${fallbackUrl}`);
    this.logger.info('💡 Available env vars:', Object.keys(process.env).filter(k => k.includes('RENDER')));
    
    return fallbackUrl;
  }

  // ✅ ИСПРАВЛЕННЫЙ МЕТОД: Автоматическое исправление синхронизации кошельков
  private async autoFixWalletSync(): Promise<void> {
    try {
      this.logger.info('🔧 Auto-fixing wallet sync...');

      // ✅ Диагностика перед исправлением
      try {
        const diagnostics = await this.smDatabase.getDiagnosticInfo();
        this.logger.info('📊 Current DB state:', diagnostics);
      } catch (diagError) {
        this.logger.warn('⚠️ Could not get diagnostics, continuing...', diagError);
      }

      // Проверяем количество кошельков в БД
      const dbCount = await this.smDatabase.getWalletCount();
      this.logger.info(`📊 Found ${dbCount} wallets in database`);

      // Если кошельков меньше 8 (ожидаем 10), значит что-то не так
      if (dbCount < 8) {
        this.logger.warn('⚠️ Detected insufficient wallets, forcing reload...');
        
        // ✅ Полная очистка и перезагрузка через SmartWalletLoader с исправленной Foreign Key проблемой
        const success = await this.smartWalletLoader.forceReplaceAllWallets();
        if (success) {
          this.logger.info('✅ Wallets force replaced successfully');
        } else {
          this.logger.error('❌ Failed to force replace wallets');
        }
      } else {
        this.logger.info('✅ Sufficient wallets found, no replacement needed');
      }

      // Дополнительная проверка: если конфиг файл содержит старые данные
      await this.forceCreateConfigFile();

    } catch (error) {
      this.logger.error('❌ Error in auto wallet sync fix:', error);
      // Не бросаем ошибку дальше, чтобы бот продолжил работу
    }
  }

  // 🚀 ПРИНУДИТЕЛЬНОЕ создание конфиг файла с актуальными кошельками
  private async forceCreateConfigFile(): Promise<void> {
    try {
      const configPath = path.join(process.cwd(), 'data', 'smart_wallets.json');
      const configExists = fs.existsSync(configPath);

      if (configExists) {
        try {
          const configData = fs.readFileSync(configPath, 'utf8');
          const config = JSON.parse(configData);
          if (config.wallets && config.wallets.length >= 8) {
            this.logger.info('📁 Config file already has sufficient wallets');
            return; // Конфиг уже нормальный
          }
        } catch (error) {
          this.logger.warn('⚠️ Config file corrupted, recreating...', error);
        }
      }

      this.logger.info('📁 Creating/updating config file with current wallets...');

      // Ваши актуальные 10 кошельков
      const currentWallets = {
        "version": "2.0",
        "lastUpdated": "2025-06-13",
        "description": "Quality Smart Money wallets (10 verified) - AUTO UPDATED",
        "totalWallets": 10,
        "wallets": [
          {
            "address": "3NgFx68GWTcoreJyJear9yLxQBmjccXAYaUphq5h9PEJ",
            "category": "sniper",
            "nickname": "Alpha Sniper",
            "description": "High-performance sniper wallet with excellent timing",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 82.4,
            "totalPnL": 245000,
            "totalTrades": 89,
            "avgTradeSize": 12000,
            "maxTradeSize": 45000,
            "performanceScore": 88,
            "minTradeAlert": 2000,
            "priority": "high",
            "enabled": true
          },
          {
            "address": "G5nxEXuFMfV74DSnsrSatqCW32F34XUnBeq3PfDS7w5E",
            "category": "hunter",
            "nickname": "Token Hunter Pro",
            "description": "Professional token hunter with strong analytics",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 76.8,
            "totalPnL": 189000,
            "totalTrades": 142,
            "avgTradeSize": 8500,
            "maxTradeSize": 28000,
            "performanceScore": 84,
            "minTradeAlert": 3000,
            "priority": "high",
            "enabled": true
          },
          {
            "address": "9peW76TTRt5dp4wiQid8dw2pmxpwpN5eXZ15bmLBNCsx",
            "category": "trader",
            "nickname": "Momentum Trader",
            "description": "Skilled momentum trader with consistent profits",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 71.2,
            "totalPnL": 165000,
            "totalTrades": 97,
            "avgTradeSize": 15000,
            "maxTradeSize": 65000,
            "performanceScore": 81,
            "minTradeAlert": 5000,
            "priority": "high",
            "enabled": true
          },
          {
            "address": "4Bxf1mCFoaQmCxxB7obV4hjfYJqkCXVQVCTRkjT1YQuL",
            "category": "sniper",
            "nickname": "Quick Strike",
            "description": "Fast execution sniper for new launches",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 79.1,
            "totalPnL": 134000,
            "totalTrades": 76,
            "avgTradeSize": 9800,
            "maxTradeSize": 35000,
            "performanceScore": 83,
            "minTradeAlert": 2500,
            "priority": "high",
            "enabled": true
          },
          {
            "address": "5nFGHVWZzsGQuucx9yuMyMFNb8MxVe5BZq6UnpMzkoCv",
            "category": "hunter",
            "nickname": "Gem Hunter",
            "description": "Expert at finding hidden gems early",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 74.6,
            "totalPnL": 156000,
            "totalTrades": 118,
            "avgTradeSize": 7200,
            "maxTradeSize": 25000,
            "performanceScore": 82,
            "minTradeAlert": 3500,
            "priority": "medium",
            "enabled": true
          },
          {
            "address": "4v7nGvhrYgHxwkeVAUijm3HPaFLBA133Z3SBrxsFWjzD",
            "category": "trader",
            "nickname": "Volume Trader",
            "description": "High-volume trader with solid risk management",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 68.3,
            "totalPnL": 198000,
            "totalTrades": 156,
            "avgTradeSize": 18500,
            "maxTradeSize": 85000,
            "performanceScore": 79,
            "minTradeAlert": 8000,
            "priority": "medium",
            "enabled": true
          },
          {
            "address": "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo",
            "category": "sniper",
            "nickname": "Precision Sniper",
            "description": "Highly accurate sniper with low miss rate",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 85.7,
            "totalPnL": 112000,
            "totalTrades": 63,
            "avgTradeSize": 11500,
            "maxTradeSize": 32000,
            "performanceScore": 87,
            "minTradeAlert": 2000,
            "priority": "high",
            "enabled": true
          },
          {
            "address": "3KNCdquQuPBq6ZWChRJr8jGpkoyZ5LurLCt6sNJJMxbq",
            "category": "hunter",
            "nickname": "DeFi Hunter",
            "description": "Specialized in DeFi token opportunities",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 72.9,
            "totalPnL": 143000,
            "totalTrades": 101,
            "avgTradeSize": 9200,
            "maxTradeSize": 38000,
            "performanceScore": 80,
            "minTradeAlert": 4000,
            "priority": "medium",
            "enabled": true
          },
          {
            "address": "HAkvH2WfamhcoyvUF7X9kqSvzwcnvmGJbNUw9QTfhWh5",
            "category": "trader",
            "nickname": "Smart Whale",
            "description": "Large position trader with strategic approach",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 66.8,
            "totalPnL": 287000,
            "totalTrades": 92,
            "avgTradeSize": 28000,
            "maxTradeSize": 120000,
            "performanceScore": 78,
            "minTradeAlert": 15000,
            "priority": "medium",
            "enabled": true
          },
          {
            "address": "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
            "category": "hunter",
            "nickname": "Trend Hunter",
            "description": "Expert at catching trending tokens early",
            "addedBy": "manual",
            "addedAt": "2025-06-13T09:00:00.000Z",
            "verified": true,
            "winRate": 77.3,
            "totalPnL": 167000,
            "totalTrades": 125,
            "avgTradeSize": 8800,
            "maxTradeSize": 29000,
            "performanceScore": 83,
            "minTradeAlert": 3000,
            "priority": "medium",
            "enabled": true
          }
        ],
        "discovery": {
          "autoDiscoveryEnabled": true,
          "maxWallets": 150,
          "minPerformanceScore": 75,
          "discoveryInterval": "48h",
          "lastDiscovery": null
        },
        "filters": {
          "minWinRate": 65,
          "minTotalPnL": 50000,
          "minTotalTrades": 30,
          "maxInactiveDays": 30
        }
      };

      // Создаем директорию если не существует
      const dataDir = path.dirname(configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Создаем backup если файл существует
      if (configExists) {
        try {
          const backupPath = configPath.replace('.json', `_backup_${Date.now()}.json`);
          fs.copyFileSync(configPath, backupPath);
          this.logger.info(`💾 Config backup saved: ${backupPath}`);
        } catch (backupError) {
          this.logger.warn('⚠️ Failed to create backup, continuing...', backupError);
        }
      }

      // Записываем новый конфиг
      fs.writeFileSync(configPath, JSON.stringify(currentWallets, null, 2), 'utf8');
      this.logger.info('✅ Config file created/updated with current wallets');

    } catch (error) {
      this.logger.error('❌ Error creating config file:', error);
      // Не бросаем ошибку дальше, чтобы не сломать запуск
    }
  }

  // 🆕 МЕТОДЫ ДЛЯ ОБРАБОТКИ TELEGRAM КОМАНД
  private setupTelegramCommands(): void {
    this.telegramNotifier.setupCommandHandlers({
      '/stats': this.handleStatsCommand.bind(this),
      '/wallets': this.handleWalletsCommand.bind(this),
      '/settings': this.handleSettingsCommand.bind(this),
      '/top': this.handleTopCommand.bind(this),
      '/positions': this.handlePositionsCommand.bind(this),
      '/discover': this.handleDiscoverCommand.bind(this),
      '/help': this.handleHelpCommand.bind(this)
    });

    this.logger.info('🤖 Telegram commands setup completed');
  }

  private async handleStatsCommand(): Promise<void> {
    try {
      this.logger.info('📊 Processing /stats command');
      
      const [walletStats, dbStats, pollingStats, loaderStats] = await Promise.all([
        this.smDatabase.getWalletStats(),
        this.database.getDatabaseStats(),
        this.webhookManager.getPollingStats(),
        this.smartWalletLoader.getStats()
      ]);

      const aggregationStats = this.solanaMonitor.getAggregationStats();
      const notificationStats = this.telegramNotifier.getNotificationStats();

      // 🆕 ИСПРАВЛЕНО: Безопасное получение discoveryStats с проверкой на null
      let discoveryStats = null;
      try {
        if (this.walletDiscovery.getDiscoveryStats) {
          discoveryStats = this.walletDiscovery.getDiscoveryStats();
        }
      } catch (error) {
        this.logger.debug('Discovery stats not available:', error);
      }

      // 🔧 ИСПРАВЛЕНО: Формируем объект только с валидными полями
      const statsData: any = {
        walletStats,
        dbStats,
        pollingStats,
        aggregationStats,
        loaderStats,
        notificationStats,
        webhookMode: this.webhookId === 'polling-mode' ? 'polling' : 'webhook',
        uptime: process.uptime()
      };

      // Добавляем discoveryStats только если они доступны
      if (discoveryStats) {
        statsData.discoveryStats = discoveryStats;
      }

      await this.telegramNotifier.sendStatsResponse(statsData);

    } catch (error) {
      this.logger.error('Error processing /stats command:', error);
      await this.telegramNotifier.sendCommandError('stats', error);
    }
  }

  private async handleWalletsCommand(): Promise<void> {
    try {
      this.logger.info('👥 Processing /wallets command');
      
      const activeWallets = await this.smDatabase.getAllActiveSmartWallets();
      const walletStats = await this.smDatabase.getWalletStats();

      await this.telegramNotifier.sendWalletsResponse({
        wallets: activeWallets.slice(0, 20), // Показываем только топ 20
        stats: walletStats,
        totalCount: activeWallets.length
      });

    } catch (error) {
      this.logger.error('Error processing /wallets command:', error);
      await this.telegramNotifier.sendCommandError('wallets', error);
    }
  }

  private async handleSettingsCommand(): Promise<void> {
    try {
      this.logger.info('⚙️ Processing /settings command');
      
      const settings = {
        monitoringMode: this.webhookId === 'polling-mode' ? 'Polling (5 min)' : 'Real-time Webhooks',
        pollingWallets: this.webhookManager.getPollingStats().monitoredWallets,
        discoveryInterval: '48 hours',
        positionAggregation: 'Enabled',
        minTradeAmount: '$8,000+',
        flowAnalysisInterval: '4 hours',
        walletDiscoveryEnabled: true,
        familyDetection: 'Disabled',
        apiOptimization: 'Enabled (-95% requests)',
        cacheSettings: {
          tokenCache: '24h TTL',
          priceCache: '5min TTL'
        }
      };

      await this.telegramNotifier.sendSettingsResponse(settings);

    } catch (error) {
      this.logger.error('Error processing /settings command:', error);
      await this.telegramNotifier.sendCommandError('settings', error);
    }
  }

  private async handleTopCommand(): Promise<void> {
    try {
      this.logger.info('📈 Processing /top command');
      
      // Используем flowAnalyzer для получения данных о токенах
      const flowResult = await this.flowAnalyzer.analyzeSmartMoneyFlows();
      
      // Объединяем inflows и outflows для получения общей активности
      const allFlows = [...flowResult.inflows, ...flowResult.outflows];
      
      // Преобразуем в формат TopTokenData
      const topTokens = allFlows.slice(0, 15).map(flow => ({
        tokenAddress: flow.tokenAddress,
        tokenSymbol: flow.tokenSymbol,
        tokenName: flow.tokenSymbol, // используем symbol как name
        volume24h: (flow.totalInflowUSD || 0) + (flow.totalOutflowUSD || 0),
        swapCount: flow.uniqueWallets || 0, // используем количество кошельков вместо swapCount
        uniqueWallets: flow.uniqueWallets || 0,
        priceChange24h: 0 // данные о изменении цены пока недоступны
      }));
      
      await this.telegramNotifier.sendTopTokensResponse(topTokens);

    } catch (error) {
      this.logger.error('Error processing /top command:', error);
      
      // Если анализ не удался, отправляем пустой массив
      await this.telegramNotifier.sendTopTokensResponse([]);
    }
  }

  private async handlePositionsCommand(): Promise<void> {
    try {
      this.logger.info('🎯 Processing /positions command');
      
      const positionStats = await this.database.getPositionAggregationStats();
      const aggregationStats = this.solanaMonitor.getAggregationStats();
      
      await this.telegramNotifier.sendPositionsResponse({
        ...positionStats,
        activeMonitoring: aggregationStats.activePositions,
        detectedToday: aggregationStats.stats?.totalPositionsDetected || 0,
        alertsSentToday: aggregationStats.stats?.alertsSent || 0
      });

    } catch (error) {
      this.logger.error('Error processing /positions command:', error);
      await this.telegramNotifier.sendCommandError('positions', error);
    }
  }

  private async handleDiscoverCommand(): Promise<void> {
    try {
      this.logger.info('🔍 Processing /discover command');
      
      // 🆕 ДИНАМИЧЕСКОЕ сообщение на основе типа поиска
      let searchType = 'wallet discovery';
      try {
        if (this.walletDiscovery.isExternalSearchEnabled?.()) {
          searchType = 'EXTERNAL wallet discovery via DexScreener + Jupiter';
        } else {
          searchType = 'INTERNAL wallet discovery (database analysis)';
        }
      } catch (error) {
        // Если метод недоступен, используем стандартное сообщение
      }
      
      await this.telegramNotifier.sendCycleLog(`🔍 <b>Starting forced ${searchType}...</b>\n\nThis may take 2-3 minutes.`);

      const discoveryResults = await this.walletDiscovery.discoverSmartWallets();
      
      let newWallets = 0;
      let updatedWallets = 0;
      
      const maxNewWallets = 5; // Ограничиваем для принудительного поиска
      let processedCount = 0;
      
      for (const result of discoveryResults) {
        if (processedCount >= maxNewWallets) break;
        
        if (result.isSmartMoney && result.category) {
          const existingWallet = await this.smDatabase.getSmartWallet(result.address);
          
          const success = await this.smartWalletLoader.addWalletToConfig(
            result.address,
            result.category,
            `Manual ${result.category} ${result.address.slice(0, 8)}`,
            `Manually discovered ${result.category} wallet`,
            {
              winRate: result.metrics.winRate,
              totalPnL: result.metrics.totalPnL,
              totalTrades: result.metrics.totalTrades,
              avgTradeSize: result.metrics.avgTradeSize,
              maxTradeSize: result.metrics.maxTradeSize,
              performanceScore: this.calculatePerformanceScore(result.metrics)
            },
            'discovery'
          );
          
          if (success) {
            if (!existingWallet) {
              newWallets++;
              processedCount++;
            } else {
              updatedWallets++;
            }
          }
        }
      }

      await this.telegramNotifier.sendDiscoveryResponse({
        totalAnalyzed: discoveryResults.length,
        newWallets,
        updatedWallets,
        smartMoneyFound: discoveryResults.filter(r => r.isSmartMoney).length
      });

    } catch (error) {
      this.logger.error('Error processing /discover command:', error);
      await this.telegramNotifier.sendCommandError('discover', error);
    }
  }

  private async handleHelpCommand(): Promise<void> {
    try {
      this.logger.info('❓ Processing /help command');
      
      await this.telegramNotifier.sendHelpResponse();

    } catch (error) {
      this.logger.error('Error processing /help command:', error);
      await this.telegramNotifier.sendCommandError('help', error);
    }
  }

  async start(): Promise<void> {
    try {
      // 🆕 ДИНАМИЧЕСКОЕ стартовое сообщение
      let startupMessage = '🚀 Starting Smart Money Bot System + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS';
      try {
        if (this.walletDiscovery.isExternalSearchEnabled?.()) {
          startupMessage += ' + EXTERNAL DISCOVERY (DexScreener + Jupiter)';
        }
      } catch (error) {
        // Если метод недоступен, используем стандартное сообщение
      }
      
      this.logger.info(startupMessage + '...');

      // 🔧 КРИТИЧЕСКИ ВАЖНО: ВЫПОЛНЯЕМ МИГРАЦИЮ ПЕРЕД ИНИЦИАЛИЗАЦИЕЙ БД
      await this.performDatabaseMigration();
      this.logger.info('✅ Database migration completed');

      await this.database.init();
      await this.smDatabase.init();
      this.logger.info('✅ Databases initialized (with position aggregation support)');

      // ✅ ИСПРАВЛЕННОЕ: Автоматическая проверка и замена кошельков при старте
      await this.autoFixWalletSync();

      const loadedWallets = await this.smartWalletLoader.loadWalletsFromConfig();
      this.logger.info(`📁 Loaded ${loadedWallets} Smart Money wallets from config`);

      const syncResult = await this.smartWalletLoader.syncDatabaseWithConfig();
      this.logger.info(`🔄 Database sync: ${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.disabled} disabled`);

      this.isRunning = true;

      // 🆕 НАСТРОЙКА TELEGRAM КОМАНД
      this.setupTelegramCommands();

      await this.webhookServer.start();
      this.logger.info('✅ Webhook server started (WITH POSITION AGGREGATION)');

      this.webhookManager.setDependencies(this.smDatabase, this.telegramNotifier);

      await this.setupQuickNodeWebhook();

      await this.sendStartupNotification();

      this.startPeriodicAnalysisOptimized();

      this.startWalletDiscoveryEvery48Hours(); // 🔥 ИЗМЕНЕНО!

      // 🎯 НОВЫЙ: Периодическая отправка статистики агрегации
      this.startPositionAggregationReports();

      // 🆕 УЛУЧШЕННОЕ логгирование с информацией о типе поиска
      let discoveryType = 'INTERNAL (database analysis)';
      try {
        if (this.walletDiscovery.isExternalSearchEnabled?.()) {
          discoveryType = 'EXTERNAL (DexScreener + Jupiter)';
        }
      } catch (error) {
        // Если метод недоступен, используем internal
      }

      this.logger.info('✅ OPTIMIZED Smart Money Bot started successfully + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS!');
      this.logger.info('📊 Real-time DEX monitoring active (OPTIMIZED)');
      this.logger.info('🔍 Smart Money flow analysis running (4h intervals)');
      this.logger.info('🎯 Advanced insider detection enabled (LIMITED)');
      this.logger.info('⚠️ Family wallet detection disabled');
      this.logger.info('🎯 Position splitting detection ENABLED');
      this.logger.info(`🚀 Wallet discovery: EVERY 48 HOURS (${discoveryType})`);
      this.logger.info('🤖 Telegram commands: ENABLED (/help for list)');

      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      this.logger.error('💥 Failed to start Smart Money Bot:', error);
      process.exit(1);
    }
  }

  async addWalletManually(
    address: string,
    category: 'sniper' | 'hunter' | 'trader',
    nickname: string,
    description: string,
    settings?: any
  ): Promise<boolean> {
    try {
      const defaultMetrics = {
        winRate: 70,
        totalPnL: 50000,
        totalTrades: 50,
        avgTradeSize: category === 'trader' ? 15000 : category === 'hunter' ? 8000 : 5000,
        maxTradeSize: category === 'trader' ? 50000 : category === 'hunter' ? 25000 : 15000,
        performanceScore: 75
      };

      const defaultSettings = {
        minTradeAlert: category === 'trader' ? 15000 : category === 'hunter' ? 5000 : 3000,
        priority: 'medium',
        enabled: true
      };

      const finalSettings = { ...defaultSettings, ...settings };

      const success = await this.smartWalletLoader.addWalletToConfig(
        address,
        category,
        nickname,
        description,
        defaultMetrics,
        'manual'
      );
      
      if (success && settings) {
        await this.smartWalletLoader.updateWalletSettings(address, settings);
      }
      
      if (success) {
        this.logger.info(`✅ Manually added wallet: ${nickname} (${category})`);
        
        await this.telegramNotifier.sendCycleLog(
          `➕ <b>Wallet Added Manually</b>\n\n` +
          `🏷️ <b>Nickname:</b> <code>${nickname}</code>\n` +
          `📍 <b>Address:</b> <code>${address}</code>\n` +
          `🎯 <b>Category:</b> <code>${category}</code>\n` +
          `📝 <b>Description:</b> ${description}\n` +
          `⚙️ <b>Min Alert:</b> <code>$${finalSettings.minTradeAlert}</code>\n` +
          `🔥 <b>Priority:</b> <code>${finalSettings.priority}</code>\n` +
          `✅ <b>Enabled:</b> <code>${finalSettings.enabled ? 'Yes' : 'No'}</code>\n\n` +
          `✅ <b>Started monitoring!</b>`
        );
      }
      return success;
    } catch (error) {
      this.logger.error('Error adding wallet manually:', error);
      return false;
    }
  }

  async updateWalletSettings(address: string, settings: any): Promise<boolean> {
    try {
      const success = await this.smartWalletLoader.updateWalletSettings(address, settings);
      
      if (success) {
        this.logger.info(`⚙️ Updated settings for wallet: ${address}`);
        
        const settingsText = Object.entries(settings)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        
        await this.telegramNotifier.sendCycleLog(
          `⚙️ <b>Wallet Settings Updated</b>\n\n` +
          `📍 <b>Address:</b> <code>${address.slice(0, 8)}...${address.slice(-4)}</code>\n` +
          `🔧 <b>Changes:</b> <code>${settingsText}</code>\n\n` +
          `✅ <b>Settings applied!</b>`
        );
      }
      
      return success;
    } catch (error) {
      this.logger.error('Error updating wallet settings:', error);
      return false;
    }
  }

  async getWalletsByFilters(filters: any): Promise<any[]> {
    try {
      const wallets = await this.smDatabase.getWalletsBySettings(filters);
      return wallets;
    } catch (error) {
      this.logger.error('Error getting wallets by filters:', error);
      return [];
    }
  }

  async exportConfiguration(): Promise<void> {
    try {
      await this.smartWalletLoader.exportConfigFromDatabase();
      this.logger.info('📤 Configuration exported successfully');
      
      await this.telegramNotifier.sendCycleLog(
        `📤 <b>Configuration Exported</b>\n\n` +
        `✅ Wallet configuration exported from database to JSON file\n` +
        `📝 File: <code>data/smart_wallets.json</code>\n` +
        `🔄 Backup created automatically`
      );
    } catch (error) {
      this.logger.error('Error exporting configuration:', error);
    }
  }

  // 🎯 НОВЫЙ МЕТОД: Получение статистики агрегации позиций
  async getPositionAggregationStats(): Promise<void> {
    try {
      const stats = await this.database.getPositionAggregationStats();
      const aggregationStats = this.solanaMonitor.getAggregationStats();
      
      await this.telegramNotifier.sendCycleLog(
        `🎯 <b>Position Aggregation Statistics</b>\n\n` +
        `📊 <b>Total Detected Positions:</b> <code>${stats.totalPositions}</code>\n` +
        `🚨 <b>High Suspicion (75+):</b> <code>${stats.highSuspicionPositions}</code>\n` +
        `💰 <b>Total Value:</b> <code>$${this.formatNumber(stats.totalValueUSD)}</code>\n` +
        `📈 <b>Avg Suspicion Score:</b> <code>${stats.avgSuspicionScore.toFixed(1)}</code>\n\n` +
        `🔄 <b>Active Monitoring:</b> <code>${aggregationStats.activePositions}</code> positions\n\n` +
        `🏆 <b>Top Wallets by Positions:</b>\n` +
        stats.topWalletsByPositions.slice(0, 5).map((wallet, i) => 
          `<code>${i + 1}.</code> <code>${wallet.walletAddress.slice(0, 8)}...${wallet.walletAddress.slice(-4)}</code> - <code>${wallet.positionCount}</code> positions, <code>$${this.formatNumber(wallet.totalValueUSD)}</code>`
        ).join('\n')
      );
      
      this.logger.info(`📊 Position aggregation stats sent: ${stats.totalPositions} total positions`);
    } catch (error) {
      this.logger.error('Error getting position aggregation stats:', error);
    }
  }

  private async setupQuickNodeWebhook(): Promise<void> {
    try {
      let webhookURL: string;
      
      if (process.env.NODE_ENV === 'production' || process.env.PORT) {
        webhookURL = `${this.detectRenderURL()}/webhook`;
      } else {
        webhookURL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
      }

      this.logger.info(`🔗 Setting up OPTIMIZED QuickNode monitoring with webhook: ${webhookURL}`);

      this.webhookId = await this.webhookManager.createDEXMonitoringStream(webhookURL);
      
      if (this.webhookId === 'polling-mode') {
        this.logger.info('🔄 QuickNode Streams unavailable - using OPTIMIZED polling mode');
        this.logger.info('📡 Polling Smart Money wallets every 5 MINUTES (OPTIMIZED)');
        
        const pollingStats = this.webhookManager.getPollingStats();
        this.logger.info(`🎯 Monitoring ${pollingStats.monitoredWallets}/20 TOP Smart Money wallets (OPTIMIZED)`);
      } else {
        this.logger.info('🎯 Smart Money DEX monitoring webhook created successfully');
        this.logger.info(`📡 Webhook URL: ${webhookURL}`);
        this.logger.info(`🆔 Stream ID: ${this.webhookId}`);
      }
      
    } catch (error) {
      this.logger.error('❌ Failed to setup QuickNode webhook:', error);
      
      this.logger.info('💡 Force starting OPTIMIZED polling mode as final fallback...');
      this.webhookId = 'polling-mode';
    }
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const stats = await this.smDatabase.getWalletStats();
      const pollingStats = this.webhookManager.getPollingStats();
      const loaderStats = this.smartWalletLoader.getStats();
      const dbStats = await this.database.getDatabaseStats();
      
      const monitoringMode = this.webhookId === 'polling-mode' ? 
        `🔄 <b>OPTIMIZED Polling Mode</b> (${pollingStats.monitoredWallets}/20 wallets, 5min intervals)` : 
        '📡 <b>Real-time Webhooks</b>';

      // 🆕 ДИНАМИЧЕСКАЯ информация о типе поиска
      let discoveryInfo = '🔍 Wallet discovery: <b>Every 48 HOURS</b>';
      try {
        if (this.walletDiscovery.isExternalSearchEnabled?.()) {
          discoveryInfo = '🌍 External discovery: <b>Every 48 HOURS (DexScreener + Jupiter)</b>';
        } else {
          discoveryInfo = '🔍 Internal discovery: <b>Every 48 HOURS (database analysis)</b>';
        }
      } catch (error) {
        // Если метод недоступен, используем стандартную информацию
      }

      await this.telegramNotifier.sendCycleLog(
        `🟢 <b>OPTIMIZED Smart Money Bot Online + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS!</b>\n\n` +
        `📊 Monitoring <code>${stats.active}</code> active wallets (<code>${stats.enabled}</code> enabled)\n` +
        `🔫 Snipers: <code>${stats.byCategory.sniper || 0}</code>\n` +
        `💡 Hunters: <code>${stats.byCategory.hunter || 0}</code>\n` +
        `🐳 Traders: <code>${stats.byCategory.trader || 0}</code>\n\n` +
        `<b>Priority Distribution:</b>\n` +
        `🔴 High: <code>${stats.byPriority.high || 0}</code>\n` +
        `🟡 Medium: <code>${stats.byPriority.medium || 0}</code>\n` +
        `🟢 Low: <code>${stats.byPriority.low || 0}</code>\n\n` +
        `👥 Family Members: <code>${stats.familyMembers}</code>\n\n` +
        `🎯 Monitoring: ${monitoringMode}\n` +
        `📈 Flow analysis: <b>Every 4 hours (OPTIMIZED)</b>\n` +
        `🔥 Hot token detection: <b>Every 4 hours</b>\n` +
        `${discoveryInfo}\n` +
        `⚠️ Family detection: <b>Disabled</b>\n` +
        `🎯 Position splitting: <b>ENABLED for insider detection</b>\n\n` +
        `🚀 <b>API OPTIMIZATION ACTIVE:</b>\n` +
        `• Polling: 5min intervals (-95% requests)\n` +
        `• Token cache: 24h TTL\n` +
        `• Price cache: 5min TTL\n` +
        `• Min trade: $8K+ (strict filters)\n` +
        `• Max wallets: 20 (top performance only)\n\n` +
        `🎯 <b>POSITION AGGREGATION:</b>\n` +
        `• Detected positions: <code>${dbStats.positionAggregations}</code>\n` +
        `• High suspicion: <code>${dbStats.highSuspicionPositions}</code>\n` +
        `• Min amount: $10K+ total\n` +
        `• Min purchases: 3+ similar sizes\n` +
        `• Time window: 90 minutes\n\n` +
        `🤖 <b>TELEGRAM COMMANDS ENABLED:</b>\n` +
        `• /stats - Bot & wallet statistics\n` +
        `• /wallets - Active Smart Money wallets\n` +
        `• /settings - Current monitoring settings\n` +
        `• /top - Top tokens by volume (24h)\n` +
        `• /positions - Position aggregation status\n` +
        `• /discover - Force wallet discovery\n` +
        `• /help - Commands help\n\n` +
        `📝 Config updated: <code>${loaderStats?.lastUpdated}</code>`
      );
    } catch (error) {
      this.logger.error('Failed to send startup notification:', error);
    }
  }

  // 🔥 ОПТИМИЗИРОВАННЫЙ PERIODIC ANALYSIS: 1 час → 4 ЧАСА!
  private startPeriodicAnalysisOptimized(): void {
    const runFlowAnalysis = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('🔍 Starting 4-hourly OPTIMIZED Smart Money flow analysis...');
        
        const flowResult = await this.flowAnalyzer.analyzeSmartMoneyFlows();
        
        await this.flowAnalyzer.sendFlowAnalysisNotifications(flowResult);
        
        if (flowResult.inflows.length > 0) {
          const hourlyInflows = flowResult.inflows.filter(f => f.period === '1h');
          const dailyInflows = flowResult.inflows.filter(f => f.period === '24h');
          
          if (hourlyInflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('inflow', '1h', hourlyInflows);
          }
          
          if (dailyInflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('inflow', '24h', dailyInflows);
          }
        }
        
        if (flowResult.outflows.length > 0) {
          const hourlyOutflows = flowResult.outflows.filter(f => f.period === '1h');
          const dailyOutflows = flowResult.outflows.filter(f => f.period === '24h');
          
          if (hourlyOutflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('outflow', '1h', hourlyOutflows);
          }
          
          if (dailyOutflows.length > 0) {
            await this.telegramNotifier.sendInflowOutflowSummary('outflow', '24h', dailyOutflows);
          }
        }
        
        if (flowResult.hotNewTokens.length > 0) {
          await this.telegramNotifier.sendHotNewTokensByWallets(flowResult.hotNewTokens);
          await this.telegramNotifier.sendHotNewTokensByAge(flowResult.hotNewTokens);
          await this.telegramNotifier.sendHotNewTokensByFDV(flowResult.hotNewTokens);
        }
        
        this.logger.info('✅ 4-hourly OPTIMIZED Smart Money flow analysis completed');
      } catch (error) {
        this.logger.error('❌ Error in 4-hourly flow analysis:', error);
      }
    };

    // Первый запуск
    runFlowAnalysis();
    
    // 🔥 КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: 1 час → 4 ЧАСА = -75% API запросов!
    const flowInterval = setInterval(runFlowAnalysis, 4 * 60 * 60 * 1000); // 4 ЧАСА!
    this.intervalIds.push(flowInterval);

    this.logger.info('🔄 OPTIMIZED Periodic Smart Money flow analysis started (4-hour intervals)');
  }

  // 🔥 ИСПРАВЛЕННЫЙ МЕТОД: DISCOVERY КАЖДЫЕ 48 ЧАСОВ - ПРАВИЛЬНОЕ УПРАВЛЕНИЕ ТАЙМЕРАМИ
  private startWalletDiscoveryEvery48Hours(): void {
    const runWalletDiscovery = async () => {
      if (!this.isRunning) {
        this.logger.warn('⚠️ Bot not running, skipping wallet discovery');
        return;
      }
      
      try {
        // 🆕 ДИНАМИЧЕСКОЕ логгирование на основе типа поиска
        let discoveryType = 'FREQUENT wallet discovery process (EVERY 48 HOURS with RELAXED criteria)';
        try {
          if (this.walletDiscovery.isExternalSearchEnabled?.()) {
            discoveryType = 'FREQUENT external wallet discovery (EVERY 48 HOURS via DexScreener + Jupiter)';
          }
        } catch (error) {
          // Если метод недоступен, используем стандартное сообщение
        }
        
        this.logger.info(`🔍 Starting ${discoveryType}...`);
        
        const discoveryResults = await this.walletDiscovery.discoverSmartWallets();
        
        let newWallets = 0;
        let updatedWallets = 0;
        
        // 🔥 УВЕЛИЧИВАЕМ лимит новых кошельков с 5 до 10 (т.к. каждые 48 часов)
        let processedCount = 0;
        const maxNewWallets = 10; // Было 5
        
        for (const result of discoveryResults) {
          if (processedCount >= maxNewWallets) {
            this.logger.info(`🚫 Reached limit of ${maxNewWallets} new wallets per discovery cycle`);
            break;
          }
          
          if (result.isSmartMoney && result.category) {
            const existingWallet = await this.smDatabase.getSmartWallet(result.address);
            
            const success = await this.smartWalletLoader.addWalletToConfig(
              result.address,
              result.category,
              `Auto ${result.category} ${result.address.slice(0, 8)}`,
              `Automatically discovered ${result.category} wallet (48h DISCOVERY)`,
              {
                winRate: result.metrics.winRate,
                totalPnL: result.metrics.totalPnL,
                totalTrades: result.metrics.totalTrades,
                avgTradeSize: result.metrics.avgTradeSize,
                maxTradeSize: result.metrics.maxTradeSize,
                performanceScore: this.calculatePerformanceScore(result.metrics)
              },
              'discovery'
            );
            
            if (success) {
              if (!existingWallet) {
                newWallets++;
                processedCount++;
              } else {
                updatedWallets++;
              }
            }
          }
        }
        
        const deactivated = await this.deactivateIneffectiveWalletsOptimized();
        
        if (this.webhookId === 'polling-mode') {
          this.webhookManager.setDependencies(this.smDatabase, this.telegramNotifier);
        }
        
        const stats = await this.smDatabase.getWalletStats();
        await this.telegramNotifier.sendWalletDatabaseStats({
          ...stats,
          newlyAdded: newWallets,
          deactivated
        });
        
        this.logger.info(`✅ 48-HOUR Wallet discovery completed: ${newWallets} new, ${updatedWallets} updated, ${deactivated} deactivated`);
        
      } catch (error) {
        this.logger.error('❌ Error in 48-hour wallet discovery:', error);
      }
    };

    // 🔧 ИСПРАВЛЕНО: ПРАВИЛЬНОЕ УПРАВЛЕНИЕ ТАЙМЕРАМИ
    this.logger.info('⏰ Wallet discovery will start in 1 hour, then every 48 HOURS...');
    
    // Первый запуск через 1 час
    const discoveryTimeout = setTimeout(async () => {
      this.logger.info('⏰ 1 hour passed, starting first 48-hour discovery cycle...');
      await runWalletDiscovery();
      
      // 🔥 КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: 14 дней → 48 ЧАСОВ!
      // ✅ ИСПРАВЛЕНО: Интервал создается и сразу добавляется в массив
      const discoveryInterval = setInterval(async () => {
        this.logger.info('⏰ 48 hours passed, running periodic wallet discovery...');
        await runWalletDiscovery();
      }, 48 * 60 * 60 * 1000); // 48 ЧАСОВ вместо 14 дней!
      
      // ✅ ИСПРАВЛЕНО: Интервал добавляется в массив сразу после создания
      this.intervalIds.push(discoveryInterval);
      
    }, 60 * 60 * 1000); // 1 час
    
    // ✅ ИСПРАВЛЕНО: Timeout добавляется в отдельный массив для корректной очистки
    this.timeoutIds.push(discoveryTimeout);

    this.logger.info('🔄 FREQUENT Periodic wallet discovery scheduled (48 HOURS instead of 14 days, up to 10 new wallets with RELAXED criteria)');
  }

  // 🎯 НОВЫЙ МЕТОД: Периодические отчеты по агрегации позиций
  private startPositionAggregationReports(): void {
    const sendAggregationReport = async () => {
      if (!this.isRunning) return;
      
      try {
        this.logger.info('📊 Sending position aggregation report...');
        await this.getPositionAggregationStats();
      } catch (error) {
        this.logger.error('❌ Error sending position aggregation report:', error);
      }
    };

    // Отправляем отчет каждые 12 часов
    const reportInterval = setInterval(sendAggregationReport, 12 * 60 * 60 * 1000); // 12 часов
    this.intervalIds.push(reportInterval);

    this.logger.info('📊 Position aggregation reports scheduled (every 12 hours)');
  }

  // 🔥 ОПТИМИЗИРОВАННОЕ ДЕАКТИВИРОВАНИЕ
  private async deactivateIneffectiveWalletsOptimized(): Promise<number> {
    const activeWallets = await this.smDatabase.getAllActiveSmartWallets();
    let deactivatedCount = 0;
    
    // 🔥 СТРОЖЕ: 30 дней вместо 60
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    for (const wallet of activeWallets) {
      let shouldDeactivate = false;
      let reason = '';
      
      // 🔥 СТРОЖЕ: win rate < 60% (было 55%)
      if (wallet.winRate < 60) {
        shouldDeactivate = true;
        reason = `Win rate dropped to ${wallet.winRate.toFixed(1)}%`;
      } else if (wallet.lastActiveAt < thirtyDaysAgo) {
        shouldDeactivate = true;
        const daysInactive = Math.floor((Date.now() - wallet.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24));
        reason = `Inactive for ${daysInactive} days`;
      } else if (wallet.totalPnL < -5000) { // Строже: -5K вместо -10K
        shouldDeactivate = true;
        reason = `Total PnL became negative: ${wallet.totalPnL.toFixed(0)}`;
      } else if (wallet.avgTradeSize < 2000) { // Строже: 2K вместо 1K
        shouldDeactivate = true;
        reason = `Average trade size too small: ${wallet.avgTradeSize.toFixed(0)}`;
      }
      
      if (shouldDeactivate) {
        await this.smDatabase.deactivateWallet(wallet.address, reason);
        await this.smartWalletLoader.updateWalletSettings(wallet.address, { enabled: false });
        deactivatedCount++;
      }
    }
    
    return deactivatedCount;
  }

  private calculatePerformanceScore(metrics: any): number {
    let score = 0;
    
    score += Math.min(metrics.winRate * 0.5, 30);
    score += Math.min(Math.log10(Math.max(metrics.totalPnL, 1)) * 5, 25);
    score += Math.min(metrics.totalTrades * 0.3, 15);
    score += Math.min(Math.log10(Math.max(metrics.avgTradeSize, 1)) * 3, 15);
    score += Math.min(metrics.sharpeRatio * 7.5, 15);
    
    return Math.min(score, 100);
  }

  // 🎯 НОВЫЙ МЕТОД: Форматирование чисел
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    } else {
      return num.toFixed(0);
    }
  }

  private async shutdown(): Promise<void> {
    this.logger.info('🔴 Shutting down OPTIMIZED Smart Money Bot + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS...');
    
    this.isRunning = false;
    
    // 🔧 ИСПРАВЛЕНО: ОЧИЩАЕМ ВСЕ INTERVALS И TIMEOUTS
    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId);
    }
    
    for (const timeoutId of this.timeoutIds) {
      clearTimeout(timeoutId);
    }
    
    if (this.webhookServer) {
      await this.webhookServer.stop();
    }
    
    if (this.webhookId && this.webhookId !== 'polling-mode') {
      try {
        await this.webhookManager.deleteStream(this.webhookId);
        this.logger.info('✅ QuickNode webhook deleted');
      } catch (error) {
        this.logger.error('❌ Error deleting webhook:', error);
      }
    } else if (this.webhookId === 'polling-mode') {
      this.webhookManager.stopPollingMode();
      this.logger.info('✅ OPTIMIZED Polling mode stopped');
    }
    
    if (this.database) {
      await this.database.close();
    }
    
    if (this.smDatabase) {
      await this.smDatabase.close();
    }
    
    try {
      await this.telegramNotifier.sendCycleLog('🔴 <b>OPTIMIZED Smart Money Bot stopped + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS</b>');
    } catch (error) {
      this.logger.error('Failed to send shutdown notification:', error);
    }
    
    this.logger.info('✅ OPTIMIZED Smart Money Bot shutdown completed + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS');
    process.exit(0);
  }
}

const main = async () => {
  try {
    const bot = new SmartMoneyBotRunner();
    await bot.start();
  } catch (error) {
    console.error('💥 Fatal error starting OPTIMIZED Smart Money Bot + POSITION AGGREGATION + 48h DISCOVERY + TELEGRAM COMMANDS:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

main();