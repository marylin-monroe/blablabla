import BetterSqlite3 from 'better-sqlite3';
import { TokenSwap, WalletInfo } from '../types';
import { Logger } from '../utils/Logger';
import path from 'path';
import fs from 'fs';

export class Database {
  private db: BetterSqlite3.Database;
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
    const dbPath = process.env.DATABASE_PATH || './data/tracker.db';

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
  }

  async init(): Promise<void> {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT UNIQUE NOT NULL,
          wallet_address TEXT NOT NULL,
          token_address TEXT NOT NULL,
          token_symbol TEXT NOT NULL,
          token_name TEXT NOT NULL,
          amount REAL NOT NULL,
          amount_usd REAL NOT NULL,
          timestamp DATETIME NOT NULL,
          dex TEXT NOT NULL,
          is_new_wallet BOOLEAN NOT NULL,
          is_reactivated_wallet BOOLEAN NOT NULL,
          wallet_age INTEGER NOT NULL,
          days_since_last_activity INTEGER NOT NULL,
          price REAL,
          pnl REAL,
          multiplier REAL,
          winrate REAL,
          time_to_target TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS wallets (
          address TEXT PRIMARY KEY,
          created_at DATETIME NOT NULL,
          last_activity_at DATETIME NOT NULL,
          is_new BOOLEAN NOT NULL,
          is_reactivated BOOLEAN NOT NULL,
          related_wallets TEXT,
          suspicion_score REAL DEFAULT 0,
          insider_flags TEXT,
          total_trades INTEGER DEFAULT 0,
          win_rate REAL DEFAULT 0,
          avg_buy_size REAL DEFAULT 0,
          max_buy_size REAL DEFAULT 0,
          min_buy_size REAL DEFAULT 0,
          panic_sells INTEGER DEFAULT 0,
          fomo_buys INTEGER DEFAULT 0,
          fake_losses INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_token ON transactions(token_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
      `);

      this.logger.info('Database initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing database:', error);
      throw error;
    }
  }

  async isTransactionProcessed(transactionId: string): Promise<boolean> {
    const row = this.db.prepare(
      'SELECT 1 FROM transactions WHERE transaction_id = ?'
    ).get(transactionId);
    return !!row;
  }

  async saveTransaction(swap: TokenSwap): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (
        transaction_id, wallet_address, token_address, token_symbol, token_name,
        amount, amount_usd, timestamp, dex, is_new_wallet, is_reactivated_wallet,
        wallet_age, days_since_last_activity, price, pnl, multiplier, winrate, time_to_target
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      swap.transactionId,
      swap.walletAddress,
      swap.tokenAddress,
      swap.tokenSymbol,
      swap.tokenName,
      swap.amount,
      swap.amountUSD,
      swap.timestamp.toISOString(),
      swap.dex,
      swap.isNewWallet ? 1 : 0,
      swap.isReactivatedWallet ? 1 : 0,
      swap.walletAge,
      swap.daysSinceLastActivity,
      swap.price || null,
      swap.pnl || null,
      swap.multiplier || null,
      swap.winrate || null,
      swap.timeToTarget || null
    );
  }

  async getWalletInfo(address: string): Promise<WalletInfo | null> {
    const row = this.db.prepare(
      'SELECT * FROM wallets WHERE address = ?'
    ).get(address) as any;

    if (!row) return null;

    return {
      address: row.address,
      createdAt: new Date(row.created_at),
      lastActivityAt: new Date(row.last_activity_at),
      isNew: !!row.is_new,
      isReactivated: !!row.is_reactivated,
      relatedWallets: row.related_wallets ? JSON.parse(row.related_wallets) : [],
      suspicionScore: row.suspicion_score || 0,
      insiderFlags: row.insider_flags ? JSON.parse(row.insider_flags) : [],
      tradingHistory: {
        totalTrades: row.total_trades || 0,
        winRate: row.win_rate || 0,
        avgBuySize: row.avg_buy_size || 0,
        maxBuySize: row.max_buy_size || 0,
        minBuySize: row.min_buy_size || 0,
        sizeProgression: [],
        timeProgression: [],
        panicSells: row.panic_sells || 0,
        fomoeBuys: row.fomo_buys || 0,
        fakeLosses: row.fake_losses || 0,
      }
    };
  }

  async saveWalletInfo(walletInfo: WalletInfo): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO wallets (
        address, created_at, last_activity_at, is_new, is_reactivated, 
        related_wallets, suspicion_score, insider_flags, total_trades,
        win_rate, avg_buy_size, max_buy_size, min_buy_size,
        panic_sells, fomo_buys, fake_losses
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const history = walletInfo.tradingHistory;

    stmt.run(
      walletInfo.address,
      walletInfo.createdAt.toISOString(),
      walletInfo.lastActivityAt.toISOString(),
      walletInfo.isNew ? 1 : 0,
      walletInfo.isReactivated ? 1 : 0,
      walletInfo.relatedWallets ? JSON.stringify(walletInfo.relatedWallets) : null,
      walletInfo.suspicionScore || 0,
      walletInfo.insiderFlags ? JSON.stringify(walletInfo.insiderFlags) : null,
      history?.totalTrades || 0,
      history?.winRate || 0,
      history?.avgBuySize || 0,
      history?.maxBuySize || 0,
      history?.minBuySize || 0,
      history?.panicSells || 0,
      history?.fomoeBuys || 0,
      history?.fakeLosses || 0
    );
  }

  // ДОБАВЛЕННЫЙ МЕТОД для получения транзакций конкретного кошелька
  async getWalletTransactions(address: string, limit: number = 100): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE wallet_address = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(address, limit) as any[];

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
      isNewWallet: !!row.is_new_wallet,
      isReactivatedWallet: !!row.is_reactivated_wallet,
      walletAge: row.wallet_age,
      daysSinceLastActivity: row.days_since_last_activity,
      price: row.price,
      pnl: row.pnl,
      multiplier: row.multiplier,
      winrate: row.winrate,
      timeToTarget: row.time_to_target,
    }));
  }

  async getRecentTransactions(hours: number = 24): Promise<TokenSwap[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE timestamp > ? 
      ORDER BY timestamp DESC
    `).all(cutoffTime) as any[];

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
      isNewWallet: !!row.is_new_wallet,
      isReactivatedWallet: !!row.is_reactivated_wallet,
      walletAge: row.wallet_age,
      daysSinceLastActivity: row.days_since_last_activity,
      price: row.price,
      pnl: row.pnl,
      multiplier: row.multiplier,
      winrate: row.winrate,
      timeToTarget: row.time_to_target,
    }));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}