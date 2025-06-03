// src/services/SmartMoneyDatabase.ts - ПОЛНАЯ РЕАЛИЗАЦИЯ
import BetterSqlite3 from 'better-sqlite3';
import { Logger } from '../utils/Logger';
import { SmartMoneyWallet, FamilyWalletCluster, TokenSwap } from '../types';
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
          sharpe_ratio REAL,
          max_drawdown REAL,
          last_active_at DATETIME NOT NULL,
          performance_score REAL NOT NULL,
          volume_score REAL,
          is_active BOOLEAN DEFAULT 1,
          is_family_member BOOLEAN DEFAULT 0,
          family_addresses TEXT,
          coordination_score REAL,
          stealth_level REAL,
          early_entry_rate REAL,
          avg_hold_time REAL,
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

        CREATE INDEX IF NOT EXISTS idx_sm_wallets_category ON smart_money_wallets(category);
        CREATE INDEX IF NOT EXISTS idx_sm_wallets_active ON smart_money_wallets(is_active);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_wallet ON smart_money_transactions(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_timestamp ON smart_money_transactions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_sm_transactions_token ON smart_money_transactions(token_address);
      `);

      this.logger.info('Smart Money Database initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing Smart Money database:', error);
      throw error;
    }
  }

  async saveSmartWallet(wallet: SmartMoneyWallet): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO smart_money_wallets (
        address, category, win_rate, total_pnl, total_trades,
        avg_trade_size, max_trade_size, min_trade_size, sharpe_ratio, max_drawdown,
        last_active_at, performance_score, volume_score, is_active,
        is_family_member, family_addresses, coordination_score, stealth_level,
        early_entry_rate, avg_hold_time, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      wallet.address,
      wallet.category,
      wallet.winRate,
      wallet.totalPnL,
      wallet.totalTrades,
      wallet.avgTradeSize,
      wallet.maxTradeSize,
      wallet.minTradeSize,
      wallet.sharpeRatio || null,
      wallet.maxDrawdown || null,
      wallet.lastActiveAt.toISOString(),
      wallet.performanceScore,
      wallet.volumeScore || null,
      wallet.isActive ? 1 : 0,
      wallet.isFamilyMember ? 1 : 0,
      wallet.familyAddresses ? JSON.stringify(wallet.familyAddresses) : null,
      wallet.coordinationScore || null,
      wallet.stealthLevel || null,
      wallet.earlyEntryRate || null,
      wallet.avgHoldTime || null
    );
  }

  async getSmartWallet(address: string): Promise<SmartMoneyWallet | null> {
    const row = this.db.prepare(
      'SELECT * FROM smart_money_wallets WHERE address = ?'
    ).get(address) as any;

    if (!row) return null;

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
      isFamilyMember: !!row.is_family_member,
      familyAddresses: row.family_addresses ? JSON.parse(row.family_addresses) : undefined,
      coordinationScore: row.coordination_score,
      stealthLevel: row.stealth_level,
      earlyEntryRate: row.early_entry_rate,
      avgHoldTime: row.avg_hold_time,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    };
  }

  async getAllActiveSmartWallets(): Promise<SmartMoneyWallet[]> {
    const rows = this.db.prepare(
      'SELECT * FROM smart_money_wallets WHERE is_active = 1 ORDER BY performance_score DESC'
    ).all() as any[];

    return rows.map(row => ({
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
      isFamilyMember: !!row.is_family_member,
      familyAddresses: row.family_addresses ? JSON.parse(row.family_addresses) : undefined,
      coordinationScore: row.coordination_score,
      stealthLevel: row.stealth_level,
      earlyEntryRate: row.early_entry_rate,
      avgHoldTime: row.avg_hold_time,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    }));
  }

  async getWalletStats(): Promise<{
    total: number;
    active: number;
    byCategory: Record<string, number>;
    familyMembers: number;
  }> {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets').get() as any;
    const activeRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets WHERE is_active = 1').get() as any;
    
    const categoryRows = this.db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM smart_money_wallets 
      WHERE is_active = 1 
      GROUP BY category
    `).all() as any[];

    const familyRow = this.db.prepare('SELECT COUNT(*) as count FROM smart_money_wallets WHERE is_family_member = 1').get() as any;

    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    return {
      total: totalRow.count,
      active: activeRow.count,
      byCategory,
      familyMembers: familyRow.count
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

  async saveFamilyCluster(cluster: FamilyWalletCluster): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO family_wallet_clusters (
        id, wallets, suspicion_score, coordination_score, detection_methods,
        total_pnl, combined_volume, avg_timing_diff, common_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      cluster.id,
      JSON.stringify(cluster.wallets),
      cluster.suspicionScore,
      cluster.coordinationScore,
      JSON.stringify(cluster.detectionMethods),
      cluster.totalPnL,
      cluster.combinedVolume,
      cluster.avgTimingDiff,
      JSON.stringify(cluster.commonTokens)
    );
  }

  async getFamilyClusters(): Promise<FamilyWalletCluster[]> {
    const rows = this.db.prepare(
      'SELECT * FROM family_wallet_clusters ORDER BY created_at DESC'
    ).all() as any[];

    return rows.map(row => ({
      id: row.id,
      wallets: JSON.parse(row.wallets),
      suspicionScore: row.suspicion_score,
      coordinationScore: row.coordination_score,
      detectionMethods: JSON.parse(row.detection_methods),
      totalPnL: row.total_pnl,
      combinedVolume: row.combined_volume,
      avgTimingDiff: row.avg_timing_diff,
      commonTokens: JSON.parse(row.common_tokens),
      createdAt: new Date(row.created_at)
    }));
  }

  async getWalletsByCategory(category: 'sniper' | 'hunter' | 'trader'): Promise<SmartMoneyWallet[]> {
    const rows = this.db.prepare(`
      SELECT * FROM smart_money_wallets 
      WHERE category = ? AND is_active = 1
      ORDER BY performance_score DESC
    `).all(category) as any[];

    return rows.map(row => ({
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
      isFamilyMember: !!row.is_family_member,
      familyAddresses: row.family_addresses ? JSON.parse(row.family_addresses) : undefined,
      coordinationScore: row.coordination_score,
      stealthLevel: row.stealth_level,
      earlyEntryRate: row.early_entry_rate,
      avgHoldTime: row.avg_hold_time,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    }));
  }

  async updateWalletPerformance(address: string, metrics: {
    winRate: number;
    totalPnL: number;
    totalTrades: number;
    lastActiveAt: Date;
  }): Promise<void> {
    this.db.prepare(`
      UPDATE smart_money_wallets 
      SET win_rate = ?, total_pnl = ?, total_trades = ?, last_active_at = ?, updated_at = datetime('now')
      WHERE address = ?
    `).run(
      metrics.winRate,
      metrics.totalPnL,
      metrics.totalTrades,
      metrics.lastActiveAt.toISOString(),
      address
    );
  }

  async close(): Promise<void> {
    this.db.close();
    this.logger.info('Smart Money Database connection closed');
  }
}