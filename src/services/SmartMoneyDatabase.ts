// src/services/SmartMoneyDatabase.ts - БЕЗ Family Detection
import BetterSqlite3 from 'better-sqlite3';
import { Logger } from '../utils/Logger';
import { SmartMoneyWallet, TokenSwap } from '../types';
import path from 'path';
import fs from 'fs';

export class SmartMoneyDatabase {
  private db: BetterSqlite3.Database;
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
    const dbPath = process.env.SM_DATABASE_PATH || './data/smart_money.db';

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
  }

  async init(): Promise<void> {
    try {
      // Сначала создаем базовую таблицу если её нет
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS smart_money_wallets (
          address TEXT PRIMARY KEY,
          category TEXT CHECK (category IN ('sniper', 'hunter', 'trader')) NOT NULL,
          win_rate REAL NOT NULL,
          total_pnl REAL NOT NULL,
          total_trades INTEGER NOT NULL,
          avg_trade_size REAL NOT NULL,
          max_trade_size REAL NOT NULL,
          min_trade_size REAL NOT NULL,
          performance_score REAL NOT NULL,
          sharpe_ratio REAL,
          max_drawdown REAL,
          last_active_at DATETIME NOT NULL,
          is_active BOOLEAN DEFAULT 1,
          is_family_member BOOLEAN DEFAULT 0,
          family_addresses TEXT,
          coordination_score REAL,
          stealth_level REAL,
          early_entry_rate REAL,
          avg_hold_time REAL,
          volume_score REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS smart_money_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT UNIQUE NOT NULL,
          wallet_address TEXT NOT NULL,
          token_address TEXT NOT NULL,
          token_symbol TEXT NOT NULL,
          token_name TEXT NOT NULL,
          amount REAL NOT NULL,
          amount_usd REAL NOT NULL,
          swap_type TEXT CHECK (swap_type IN ('buy', 'sell')) NOT NULL,
          timestamp DATETIME NOT NULL,
          dex TEXT NOT NULL,
          wallet_category TEXT NOT NULL,
          is_family_member BOOLEAN DEFAULT 0,
          family_id TEXT,
          wallet_pnl REAL,
          wallet_win_rate REAL,
          wallet_total_trades INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (wallet_address) REFERENCES smart_money_wallets(address)
        );

        /*
        CREATE TABLE IF NOT EXISTS family_wallet_clusters (
          id TEXT PRIMARY KEY,
          wallets TEXT NOT NULL,
          suspicion_score REAL NOT NULL,
          coordination_score REAL NOT NULL,
          detection_methods TEXT NOT NULL,
          total_pnl REAL NOT NULL,
          combined_volume REAL NOT NULL,
          avg_timing_diff REAL NOT NULL,
          common_tokens TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        */
      `);

      await this.migrateExistingData();

      // Создаем индексы ПОСЛЕ миграции
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sm_wallets_category ON smart_money_wallets(category);
        CREATE INDEX IF NOT EXISTS idx_sm_wallets_active ON smart_money_wallets(is_active);
        CREATE INDEX IF NOT EXISTS idx_sm_wallets_performance ON smart_money_wallets(performance_score);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_wallet ON smart_money_transactions(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_timestamp ON smart_money_transactions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_token ON smart_money_transactions(token_address);
      `);

      // Создаем индексы на новые колонки только если они существуют
      const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
      const columnNames = tableInfo.map((col: any) => col.name);

      if (columnNames.includes('enabled')) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sm_wallets_enabled ON smart_money_wallets(enabled);`);
      }

      if (columnNames.includes('priority')) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sm_wallets_priority ON smart_money_wallets(priority);`);
      }

      this.logger.info('Smart Money Database initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing Smart Money database:', error);
      throw error;
    }
  }

  private async migrateExistingData(): Promise<void> {
    try {
      const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
      const columnNames = tableInfo.map((col: any) => col.name);

      this.logger.info(`Current columns: ${columnNames.join(', ')}`);

      const newColumns = [
        { name: 'nickname', type: 'TEXT' },
        { name: 'description', type: 'TEXT' },
        { name: 'min_trade_alert', type: 'REAL DEFAULT 5000' },
        { name: 'priority', type: 'TEXT DEFAULT "medium"' },
        { name: 'enabled', type: 'BOOLEAN DEFAULT 1' },
        { name: 'verified', type: 'BOOLEAN DEFAULT 0' },
        { name: 'added_by', type: 'TEXT DEFAULT "discovery"' },
        { name: 'added_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
      ];

      for (const column of newColumns) {
        if (!columnNames.includes(column.name)) {
          try {
            this.db.exec(`ALTER TABLE smart_money_wallets ADD COLUMN ${column.name} ${column.type}`);
            this.logger.info(`✅ Added column: ${column.name}`);
          } catch (error) {
            this.logger.warn(`Column ${column.name} might already exist:`, error);
          }
        }
      }

      const updateExisting = this.db.prepare(`
        UPDATE smart_money_wallets 
        SET nickname = COALESCE(nickname, category || ' ' || substr(address, 1, 8)),
            description = COALESCE(description, 'Автоматически добавленный ' || category || ' кошелек'),
            min_trade_alert = COALESCE(min_trade_alert, 
              CASE category 
                WHEN 'trader' THEN 15000 
                WHEN 'hunter' THEN 5000 
                ELSE 3000 
              END),
            priority = COALESCE(priority, 
              CASE WHEN performance_score > 85 THEN 'high' ELSE 'medium' END),
            enabled = COALESCE(enabled, 1),
            verified = COALESCE(verified, 0),
            added_by = COALESCE(added_by, 'discovery'),
            added_at = COALESCE(added_at, created_at, CURRENT_TIMESTAMP),
            is_family_member = 0,
            family_addresses = NULL,
            coordination_score = NULL,
            stealth_level = NULL
        WHERE nickname IS NULL OR enabled IS NULL
      `);

      const changes = updateExisting.run();
      this.logger.info(`✅ Updated ${changes.changes} existing records with default values`);

    } catch (error) {
      this.logger.error('Error in migration:', error);
      throw error;
    }
  }

  async saveSmartWallet(wallet: SmartMoneyWallet, config?: {
    nickname?: string;
    description?: string;
    minTradeAlert?: number;
    priority?: 'high' | 'medium' | 'low';
    addedBy?: 'manual' | 'discovery' | 'placeholder';
    verified?: boolean;
  }): Promise<void> {
    
    this.logger.info('🐛 DEBUGGING saveSmartWallet input:');
    this.logger.info(`🐛 wallet.address: ${typeof wallet.address} = ${wallet.address}`);
    this.logger.info(`🐛 config: ${JSON.stringify(config)}`);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO smart_money_wallets (
        address, category, nickname, description,
        win_rate, total_pnl, total_trades, avg_trade_size, max_trade_size, min_trade_size, performance_score,
        sharpe_ratio, max_drawdown, volume_score, early_entry_rate, avg_hold_time,
        min_trade_alert, priority, enabled,
        is_active, verified, last_active_at,
        is_family_member, family_addresses, coordination_score, stealth_level,
        added_by, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const normalizedAddedBy = config?.addedBy === 'placeholder' ? 'discovery' : (config?.addedBy || 'manual');
    const safeEnabled = config?.verified !== undefined ? (config.verified ? 1 : 0) : 0;

    const params = [
      wallet.address,                    // 1
      wallet.category,                   // 2
      config?.nickname || `${wallet.category.charAt(0).toUpperCase() + wallet.category.slice(1)} ${wallet.address.slice(0, 8)}`, // 3
      config?.description || `Автоматически добавленный ${wallet.category} кошелек`, // 4
      wallet.winRate,                    // 5
      wallet.totalPnL,                   // 6
      wallet.totalTrades,                // 7
      wallet.avgTradeSize,               // 8
      wallet.maxTradeSize,               // 9
      wallet.minTradeSize,               // 10
      wallet.performanceScore,           // 11
      wallet.sharpeRatio || null,        // 12
      wallet.maxDrawdown || null,        // 13
      wallet.volumeScore || null,        // 14
      wallet.earlyEntryRate || null,     // 15
      wallet.avgHoldTime || null,        // 16
      config?.minTradeAlert || (wallet.category === 'trader' ? 15000 : wallet.category === 'hunter' ? 5000 : 3000), // 17
      config?.priority || (wallet.performanceScore > 85 ? 'high' : 'medium'), // 18
      1,                                 // 19 enabled (всегда true)
      wallet.isActive ? 1 : 0,          // 20
      safeEnabled,                       // 21 verified
      wallet.lastActiveAt.toISOString(), // 22
      0,                                 // 23 is_family_member (всегда false)
      null,                              // 24 family_addresses (всегда null) 
      null,                              // 25 coordination_score (всегда null)
      null,                              // 26 stealth_level (всегда null)
      normalizedAddedBy,                 // 27
      new Date().toISOString()           // 28
    ];

    this.logger.info('🐛 DEBUGGING SQL parameters:');
    params.forEach((param, index) => {
      this.logger.info(`🐛 Param ${index + 1}: ${typeof param} = ${param}`);
    });

    try {
      stmt.run(...params);
      this.logger.info('✅ Wallet saved successfully!');
    } catch (error) {
      this.logger.error('🐛 SQL Error in saveSmartWallet:', error);
      this.logger.error('🐛 Failed parameters:', params);
      throw error;
    }
  }

  async getSmartWallet(address: string): Promise<SmartMoneyWallet | null> {
    const row = this.db.prepare(
      'SELECT * FROM smart_money_wallets WHERE address = ?'
    ).get(address) as any;

    if (!row) return null;

    return this.mapRowToWallet(row);
  }

  async getAllActiveSmartWallets(): Promise<SmartMoneyWallet[]> {
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const hasEnabledColumn = tableInfo.some((col: any) => col.name === 'enabled');

    let query = 'SELECT * FROM smart_money_wallets WHERE is_active = 1';
    if (hasEnabledColumn) {
      query += ' AND enabled = 1';
    }
    query += ' ORDER BY performance_score DESC';

    const rows = this.db.prepare(query).all() as any[];
    return rows.map(row => this.mapRowToWallet(row));
  }

  async getWalletsBySettings(filters: {
    category?: 'sniper' | 'hunter' | 'trader';
    priority?: 'high' | 'medium' | 'low';
    minPerformanceScore?: number;
    enabled?: boolean;
  }): Promise<SmartMoneyWallet[]> {
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const columnNames = tableInfo.map((col: any) => col.name);
    const hasEnabledColumn = columnNames.includes('enabled');
    const hasPriorityColumn = columnNames.includes('priority');

    let query = 'SELECT * FROM smart_money_wallets WHERE is_active = 1';
    const params: any[] = [];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.priority && hasPriorityColumn) {
      query += ' AND priority = ?';
      params.push(filters.priority);
    }

    if (filters.minPerformanceScore) {
      query += ' AND performance_score >= ?';
      params.push(filters.minPerformanceScore);
    }

    if (filters.enabled !== undefined && hasEnabledColumn) {
      query += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    query += ' ORDER BY performance_score DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapRowToWallet(row));
  }

  async getWalletStats(): Promise<{
    total: number;
    active: number;
    enabled: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
    familyMembers: number;
  }> {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets').get() as any;
    const activeRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets WHERE is_active = 1').get() as any;
    
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const columnNames = tableInfo.map((col: any) => col.name);
    const hasEnabledColumn = columnNames.includes('enabled');
    const hasPriorityColumn = columnNames.includes('priority');

    let enabledRow = { count: activeRow.count };
    if (hasEnabledColumn) {
      enabledRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets WHERE enabled = 1').get() as any;
    }
    
    let categoryQuery = 'SELECT category, COUNT(*) as count FROM smart_money_wallets WHERE is_active = 1';
    if (hasEnabledColumn) {
      categoryQuery += ' AND enabled = 1';
    }
    categoryQuery += ' GROUP BY category';
    const categoryRows = this.db.prepare(categoryQuery).all() as any[];

    let priorityRows: any[] = [];
    if (hasPriorityColumn) {
      let priorityQuery = 'SELECT priority, COUNT(*) as count FROM smart_money_wallets WHERE is_active = 1';
      if (hasEnabledColumn) {
        priorityQuery += ' AND enabled = 1';
      }
      priorityQuery += ' GROUP BY priority';
      priorityRows = this.db.prepare(priorityQuery).all() as any[];
    }

    // Family members всегда 0
    const familyRow = { count: 0 };

    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    const byPriority: Record<string, number> = {};
    for (const row of priorityRows) {
      byPriority[row.priority] = row.count;
    }

    return {
      total: totalRow.count,
      active: activeRow.count,
      enabled: enabledRow.count,
      byCategory,
      byPriority,
      familyMembers: 0 // Всегда 0
    };
  }

  async updateWalletSettings(address: string, settings: {
    minTradeAlert?: number;
    priority?: 'high' | 'medium' | 'low';
    enabled?: boolean;
  }): Promise<void> {
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const columnNames = tableInfo.map((col: any) => col.name);

    const updates: string[] = [];
    const params: any[] = [];

    if (settings.minTradeAlert !== undefined && columnNames.includes('min_trade_alert')) {
      updates.push('min_trade_alert = ?');
      params.push(settings.minTradeAlert);
    }

    if (settings.priority !== undefined && columnNames.includes('priority')) {
      updates.push('priority = ?');
      params.push(settings.priority);
    }

    if (settings.enabled !== undefined && columnNames.includes('enabled')) {
      updates.push('enabled = ?');
      params.push(settings.enabled ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime(\'now\')');
      params.push(address);

      const query = `UPDATE smart_money_wallets SET ${updates.join(', ')} WHERE address = ?`;
      this.db.prepare(query).run(...params);
    }
  }

  async getWalletSettings(address: string): Promise<{
    minTradeAlert: number;
    priority: 'high' | 'medium' | 'low';
    enabled: boolean;
    nickname?: string;
    description?: string;
  } | null> {
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const columnNames = tableInfo.map((col: any) => col.name);

    const selectColumns = ['address'];
    if (columnNames.includes('min_trade_alert')) selectColumns.push('min_trade_alert');
    if (columnNames.includes('priority')) selectColumns.push('priority');
    if (columnNames.includes('enabled')) selectColumns.push('enabled');
    if (columnNames.includes('nickname')) selectColumns.push('nickname');
    if (columnNames.includes('description')) selectColumns.push('description');

    const query = `SELECT ${selectColumns.join(', ')} FROM smart_money_wallets WHERE address = ?`;
    const row = this.db.prepare(query).get(address) as any;

    if (!row) return null;

    return {
      minTradeAlert: row.min_trade_alert || 5000,
      priority: row.priority || 'medium',
      enabled: row.enabled !== undefined ? !!row.enabled : true,
      nickname: row.nickname,
      description: row.description
    };
  }

  async deactivateWallet(address: string, reason: string): Promise<void> {
    this.db.prepare(`
      UPDATE smart_money_wallets 
      SET is_active = 0, updated_at = datetime('now')
      WHERE address = ?
    `).run(address);

    this.logger.info(`Deactivated wallet ${address}: ${reason}`);
  }

  async getSmartWalletTransactions(walletAddress: string, afterDate: Date): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM smart_money_transactions 
      WHERE wallet_address = ? AND timestamp > ?
      ORDER BY timestamp DESC
    `).all(walletAddress, afterDate.toISOString()) as any[];

    return rows.map(row => ({
      transactionId: row.transaction_id,
      walletAddress: row.wallet_address,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      tokenName: row.token_name,
      amount: row.amount,
      amountUSD: row.amount_usd,
      timestamp: new Date(row.timestamp),
      dex: row.dex,
      isNewWallet: false,
      isReactivatedWallet: false,
      walletAge: 0,
      daysSinceLastActivity: 0,
      swapType: row.swap_type as 'buy' | 'sell'
    }));
  }

  // Методы для family clusters - ОТКЛЮЧЕНЫ
  /*
  async saveFamilyCluster(cluster: any): Promise<void> {
    // Заглушка - ничего не делаем
    this.logger.debug('Family cluster save disabled');
  }

  async getFamilyClusters(): Promise<any[]> {
    // Возвращаем пустой массив
    return [];
  }
  */

  async getWalletsByCategory(category: 'sniper' | 'hunter' | 'trader'): Promise<SmartMoneyWallet[]> {
    const tableInfo = this.db.prepare("PRAGMA table_info(smart_money_wallets)").all() as any[];
    const hasEnabledColumn = tableInfo.some((col: any) => col.name === 'enabled');

    let query = 'SELECT * FROM smart_money_wallets WHERE category = ? AND is_active = 1';
    if (hasEnabledColumn) {
      query += ' AND enabled = 1';
    }
    query += ' ORDER BY performance_score DESC';

    const rows = this.db.prepare(query).all(category) as any[];
    return rows.map(row => this.mapRowToWallet(row));
  }

  async updateWalletPerformance(address: string, metrics: {
    winRate: number;
    totalPnL: number;
    totalTrades: number;
    lastActiveAt: Date;
    performanceScore?: number;
  }): Promise<void> {
    this.db.prepare(`
      UPDATE smart_money_wallets 
      SET win_rate = ?, total_pnl = ?, total_trades = ?, last_active_at = ?, 
          performance_score = COALESCE(?, performance_score), updated_at = datetime('now')
      WHERE address = ?
    `).run(
      metrics.winRate,
      metrics.totalPnL,
      metrics.totalTrades,
      metrics.lastActiveAt.toISOString(),
      metrics.performanceScore || null,
      address
    );
  }

  private mapRowToWallet(row: any): SmartMoneyWallet {
    return {
      address: row.address,
      category: row.category,
      winRate: row.win_rate,
      totalPnL: row.total_pnl,
      totalTrades: row.total_trades,
      avgTradeSize: row.avg_trade_size,
      maxTradeSize: row.max_trade_size,
      minTradeSize: row.min_trade_size,
      sharpeRatio: row.sharpe_ratio,
      maxDrawdown: row.max_drawdown,
      lastActiveAt: new Date(row.last_active_at),
      performanceScore: row.performance_score,
      volumeScore: row.volume_score,
      isActive: !!row.is_active,
      isFamilyMember: false, // Всегда false
      familyAddresses: undefined, // Всегда undefined
      coordinationScore: null, // Всегда null
      stealthLevel: null, // Всегда null
      earlyEntryRate: row.early_entry_rate,
      avgHoldTime: row.avg_hold_time,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    };
  }

  async close(): Promise<void> {
    this.db.close();
    this.logger.info('Smart Money Database connection closed');
  }
}