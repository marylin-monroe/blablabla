// src/services/Database.ts - ПОЛНАЯ ВЕРСИЯ со всеми методами + АГРЕГАЦИЯ + НОВЫЕ ПОЛЯ
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
          swap_type TEXT CHECK (swap_type IN ('buy', 'sell')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          -- 🆕 НОВЫЕ ПОЛЯ ДЛЯ POSITION AGGREGATION
          is_aggregated BOOLEAN DEFAULT 0,
          aggregation_id INTEGER,
          suspicion_score INTEGER DEFAULT 0,
          aggregation_group TEXT
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

        -- Таблица для Token Name Alerts
        CREATE TABLE IF NOT EXISTS token_name_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern TEXT NOT NULL,
          first_seen DATETIME NOT NULL,
          token_count INTEGER DEFAULT 1,
          max_holders_token TEXT,
          max_holders_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 🎯 НОВАЯ ТАБЛИЦА ДЛЯ АГРЕГАЦИИ ПОЗИЦИЙ
        CREATE TABLE IF NOT EXISTS position_aggregations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet_address TEXT NOT NULL,
          token_address TEXT NOT NULL,
          token_symbol TEXT NOT NULL,
          token_name TEXT NOT NULL,
          total_usd REAL NOT NULL,
          purchase_count INTEGER NOT NULL,
          avg_purchase_size REAL NOT NULL,
          time_window_minutes REAL NOT NULL,
          suspicion_score INTEGER NOT NULL,
          size_tolerance REAL NOT NULL,
          first_buy_time DATETIME NOT NULL,
          last_buy_time DATETIME NOT NULL,
          purchase_details TEXT NOT NULL, -- JSON массив покупок
          detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          -- 🆕 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ ДЛЯ АНАЛИЗА
          max_purchase_size REAL DEFAULT 0,
          min_purchase_size REAL DEFAULT 0,
          size_std_deviation REAL DEFAULT 0,
          size_coefficient REAL DEFAULT 0,
          similar_size_count INTEGER DEFAULT 0,
          wallet_age_days INTEGER DEFAULT 0,
          is_processed BOOLEAN DEFAULT 0,
          alert_sent BOOLEAN DEFAULT 0,
          risk_level TEXT DEFAULT 'MEDIUM',
          UNIQUE(wallet_address, token_address, first_buy_time)
        );

        -- 🆕 НОВАЯ ТАБЛИЦА ДЛЯ ДЕТЕКЦИИ ИНСАЙДЕРОВ
        CREATE TABLE IF NOT EXISTS insider_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet_address TEXT NOT NULL,
          detection_method TEXT NOT NULL,
          confidence_score INTEGER NOT NULL,
          evidence_data TEXT NOT NULL, -- JSON с доказательствами
          alert_type TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          processed BOOLEAN DEFAULT 0,
          reported BOOLEAN DEFAULT 0
        );

        -- 🆕 НОВАЯ ТАБЛИЦА ДЛЯ PROVIDER СТАТИСТИКИ
        CREATE TABLE IF NOT EXISTS provider_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_name TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          request_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          avg_response_time REAL DEFAULT 0,
          last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'healthy',
          priority INTEGER DEFAULT 3,
          daily_requests INTEGER DEFAULT 0,
          daily_errors INTEGER DEFAULT 0,
          daily_reset DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_token ON transactions(token_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_token_patterns_pattern ON token_name_patterns(pattern);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_wallet ON position_aggregations(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_token ON position_aggregations(token_address);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_score ON position_aggregations(suspicion_score);
        -- 🆕 НОВЫЕ ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
        CREATE INDEX IF NOT EXISTS idx_transactions_aggregated ON transactions(is_aggregated);
        CREATE INDEX IF NOT EXISTS idx_transactions_aggregation_id ON transactions(aggregation_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_suspicion ON transactions(suspicion_score);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_processed ON position_aggregations(is_processed);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_alert ON position_aggregations(alert_sent);
        CREATE INDEX IF NOT EXISTS idx_position_aggregations_risk ON position_aggregations(risk_level);
        CREATE INDEX IF NOT EXISTS idx_insider_alerts_processed ON insider_alerts(processed);
        CREATE INDEX IF NOT EXISTS idx_insider_alerts_wallet ON insider_alerts(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_provider_stats_name ON provider_stats(provider_name);
      `);

      this.logger.info('Database initialized successfully (with position aggregation support + new features)');
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
      INSERT OR REPLACE INTO transactions (
        transaction_id, wallet_address, token_address, token_symbol, token_name,
        amount, amount_usd, timestamp, dex, is_new_wallet, is_reactivated_wallet,
        wallet_age, days_since_last_activity, price, pnl, multiplier, winrate, time_to_target, swap_type,
        is_aggregated, aggregation_id, suspicion_score, aggregation_group
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      swap.timeToTarget || null,
      swap.swapType || null,
      // 🆕 НОВЫЕ ПОЛЯ
      0, // is_aggregated (по умолчанию false)
      null, // aggregation_id
      0, // suspicion_score
      null // aggregation_group
    );
  }

  // 🆕 НОВЫЙ МЕТОД: СОХРАНЕНИЕ ТРАНЗАКЦИИ С АГРЕГАЦИЕЙ
  async saveTransactionWithAggregation(swap: TokenSwap, aggregationData?: {
    isAggregated: boolean;
    aggregationId?: number;
    suspicionScore?: number;
    aggregationGroup?: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO transactions (
        transaction_id, wallet_address, token_address, token_symbol, token_name,
        amount, amount_usd, timestamp, dex, is_new_wallet, is_reactivated_wallet,
        wallet_age, days_since_last_activity, price, pnl, multiplier, winrate, time_to_target, swap_type,
        is_aggregated, aggregation_id, suspicion_score, aggregation_group
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      swap.timeToTarget || null,
      swap.swapType || null,
      // 🆕 АГРЕГАЦИОННЫЕ ПОЛЯ
      aggregationData?.isAggregated ? 1 : 0,
      aggregationData?.aggregationId || null,
      aggregationData?.suspicionScore || 0,
      aggregationData?.aggregationGroup || null
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

  async getWalletTransactions(address: string, limit: number = 100): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE wallet_address = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(address, limit) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  async getRecentTransactions(hours: number = 24): Promise<TokenSwap[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE timestamp > ? 
      ORDER BY timestamp DESC
    `).all(cutoffTime) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  async getWalletTransactionsAfter(address: string, afterDate: Date): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE wallet_address = ? AND timestamp > ?
      ORDER BY timestamp DESC
    `).all(address, afterDate.toISOString()) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  // 🎯 НОВЫЙ МЕТОД: получение транзакций по токену (для агрегации)
  async getTransactionsByTokenAddress(tokenAddress: string, limit: number = 100): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE token_address = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(tokenAddress, limit) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  // 🎯 НОВЫЕ МЕТОДЫ ДЛЯ АГРЕГАЦИИ ПОЗИЦИЙ

  // Сохранение агрегированной позиции
  async savePositionAggregation(aggregation: {
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
      transactionId: string;
      amountUSD: number;
      timestamp: Date;
    }>;
    // 🆕 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ
    maxPurchaseSize?: number;
    minPurchaseSize?: number;
    sizeStdDeviation?: number;
    sizeCoefficient?: number;
    similarSizeCount?: number;
    walletAgeDays?: number;
    riskLevel?: string;
  }): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO position_aggregations (
        wallet_address, token_address, token_symbol, token_name,
        total_usd, purchase_count, avg_purchase_size, time_window_minutes,
        suspicion_score, size_tolerance, first_buy_time, last_buy_time,
        purchase_details,
        max_purchase_size, min_purchase_size, size_std_deviation, size_coefficient,
        similar_size_count, wallet_age_days, risk_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      aggregation.walletAddress,
      aggregation.tokenAddress,
      aggregation.tokenSymbol,
      aggregation.tokenName,
      aggregation.totalUSD,
      aggregation.purchaseCount,
      aggregation.avgPurchaseSize,
      aggregation.timeWindowMinutes,
      aggregation.suspicionScore,
      aggregation.sizeTolerance,
      aggregation.firstBuyTime.toISOString(),
      aggregation.lastBuyTime.toISOString(),
      JSON.stringify(aggregation.purchases),
      aggregation.maxPurchaseSize || 0,
      aggregation.minPurchaseSize || 0,
      aggregation.sizeStdDeviation || 0,
      aggregation.sizeCoefficient || 0,
      aggregation.similarSizeCount || 0,
      aggregation.walletAgeDays || 0,
      aggregation.riskLevel || 'MEDIUM'
    );

    const aggregationId = result.lastInsertRowid as number;

    // 🆕 ОБНОВЛЯЕМ СВЯЗАННЫЕ ТРАНЗАКЦИИ
    await this.updateTransactionsWithAggregation(
      aggregation.purchases.map(p => p.transactionId),
      aggregationId,
      aggregation.suspicionScore
    );

    this.logger.info(`💾 Saved position aggregation: ${aggregation.tokenSymbol} - $${aggregation.totalUSD} (score: ${aggregation.suspicionScore}, ID: ${aggregationId})`);
    return aggregationId;
  }

  // 🆕 ОБНОВЛЕНИЕ ТРАНЗАКЦИЙ С АГРЕГАЦИОННЫМИ ДАННЫМИ
  private async updateTransactionsWithAggregation(transactionIds: string[], aggregationId: number, suspicionScore: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE transactions 
      SET is_aggregated = 1, aggregation_id = ?, suspicion_score = ?
      WHERE transaction_id = ?
    `);

    for (const txId of transactionIds) {
      stmt.run(aggregationId, suspicionScore, txId);
    }
  }

  // Получение агрегированных позиций по score
  async getPositionAggregationsByScore(minScore: number = 75, limit: number = 50): Promise<Array<{
    id: number;
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
    detectedAt: Date;
    purchases: Array<{
      transactionId: string;
      amountUSD: number;
      timestamp: Date;
    }>;
    // 🆕 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ
    maxPurchaseSize: number;
    minPurchaseSize: number;
    sizeStdDeviation: number;
    sizeCoefficient: number;
    similarSizeCount: number;
    walletAgeDays: number;
    riskLevel: string;
    isProcessed: boolean;
    alertSent: boolean;
  }>> {
    const rows = this.db.prepare(`
      SELECT * FROM position_aggregations 
      WHERE suspicion_score >= ? 
      ORDER BY suspicion_score DESC, total_usd DESC
      LIMIT ?
    `).all(minScore, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      tokenName: row.token_name,
      totalUSD: row.total_usd,
      purchaseCount: row.purchase_count,
      avgPurchaseSize: row.avg_purchase_size,
      timeWindowMinutes: row.time_window_minutes,
      suspicionScore: row.suspicion_score,
      sizeTolerance: row.size_tolerance,
      firstBuyTime: new Date(row.first_buy_time),
      lastBuyTime: new Date(row.last_buy_time),
      detectedAt: new Date(row.detected_at),
      purchases: JSON.parse(row.purchase_details),
      maxPurchaseSize: row.max_purchase_size,
      minPurchaseSize: row.min_purchase_size,
      sizeStdDeviation: row.size_std_deviation,
      sizeCoefficient: row.size_coefficient,
      similarSizeCount: row.similar_size_count,
      walletAgeDays: row.wallet_age_days,
      riskLevel: row.risk_level,
      isProcessed: !!row.is_processed,
      alertSent: !!row.alert_sent
    }));
  }

  // Получение агрегированных позиций по кошельку
  async getPositionAggregationsByWallet(walletAddress: string): Promise<Array<{
    id: number;
    tokenAddress: string;
    tokenSymbol: string;
    totalUSD: number;
    purchaseCount: number;
    suspicionScore: number;
    detectedAt: Date;
  }>> {
    const rows = this.db.prepare(`
      SELECT id, token_address, token_symbol, total_usd, purchase_count, suspicion_score, detected_at
      FROM position_aggregations 
      WHERE wallet_address = ? 
      ORDER BY detected_at DESC
    `).all(walletAddress) as any[];

    return rows.map(row => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      totalUSD: row.total_usd,
      purchaseCount: row.purchase_count,
      suspicionScore: row.suspicion_score,
      detectedAt: new Date(row.detected_at)
    }));
  }

  // 🆕 ПОЛУЧЕНИЕ НЕОБРАБОТАННЫХ АГРЕГАЦИЙ
  async getUnprocessedPositionAggregations(limit: number = 50): Promise<Array<{
    id: number;
    walletAddress: string;
    tokenAddress: string;
    tokenSymbol: string;
    suspicionScore: number;
    totalUSD: number;
    purchaseCount: number;
  }>> {
    const rows = this.db.prepare(`
      SELECT id, wallet_address, token_address, token_symbol, suspicion_score, 
             total_usd, purchase_count
      FROM position_aggregations 
      WHERE is_processed = 0 AND suspicion_score >= 70
      ORDER BY suspicion_score DESC, detected_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      suspicionScore: row.suspicion_score,
      totalUSD: row.total_usd,
      purchaseCount: row.purchase_count
    }));
  }

  // 🆕 ПОМЕТКА АГРЕГАЦИИ КАК ОБРАБОТАННОЙ
  async markPositionAggregationAsProcessed(aggregationId: number, alertSent: boolean = false): Promise<void> {
    this.db.prepare(`
      UPDATE position_aggregations 
      SET is_processed = 1, alert_sent = ?
      WHERE id = ?
    `).run(alertSent ? 1 : 0, aggregationId);
  }

  // Статистика агрегированных позиций
  async getPositionAggregationStats(): Promise<{
    totalPositions: number;
    highSuspicionPositions: number; // score >= 75
    totalValueUSD: number;
    avgSuspicionScore: number;
    topWalletsByPositions: Array<{
      walletAddress: string;
      positionCount: number;
      totalValueUSD: number;
    }>;
    // 🆕 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА
    unprocessedPositions: number;
    alertsSent: number;
    riskDistribution: {
      high: number;
      medium: number;
      low: number;
    };
  }> {
    const totalPositions = this.db.prepare('SELECT COUNT(*) as count FROM position_aggregations').get() as any;
    
    const highSuspicion = this.db.prepare(
      'SELECT COUNT(*) as count FROM position_aggregations WHERE suspicion_score >= 75'
    ).get() as any;
    
    const totalValue = this.db.prepare('SELECT SUM(total_usd) as sum FROM position_aggregations').get() as any;
    
    const avgScore = this.db.prepare('SELECT AVG(suspicion_score) as avg FROM position_aggregations').get() as any;
    
    const topWallets = this.db.prepare(`
      SELECT wallet_address, COUNT(*) as position_count, SUM(total_usd) as total_value
      FROM position_aggregations 
      GROUP BY wallet_address 
      ORDER BY position_count DESC, total_value DESC 
      LIMIT 10
    `).all() as any[];

    // 🆕 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА
    const unprocessed = this.db.prepare(
      'SELECT COUNT(*) as count FROM position_aggregations WHERE is_processed = 0'
    ).get() as any;

    const alertsSent = this.db.prepare(
      'SELECT COUNT(*) as count FROM position_aggregations WHERE alert_sent = 1'
    ).get() as any;

    const riskHigh = this.db.prepare(
      "SELECT COUNT(*) as count FROM position_aggregations WHERE risk_level = 'HIGH'"
    ).get() as any;

    const riskMedium = this.db.prepare(
      "SELECT COUNT(*) as count FROM position_aggregations WHERE risk_level = 'MEDIUM'"
    ).get() as any;

    const riskLow = this.db.prepare(
      "SELECT COUNT(*) as count FROM position_aggregations WHERE risk_level = 'LOW'"
    ).get() as any;

    return {
      totalPositions: totalPositions.count,
      highSuspicionPositions: highSuspicion.count,
      totalValueUSD: totalValue.sum || 0,
      avgSuspicionScore: avgScore.avg || 0,
      topWalletsByPositions: topWallets.map(row => ({
        walletAddress: row.wallet_address,
        positionCount: row.position_count,
        totalValueUSD: row.total_value
      })),
      unprocessedPositions: unprocessed.count,
      alertsSent: alertsSent.count,
      riskDistribution: {
        high: riskHigh.count,
        medium: riskMedium.count,
        low: riskLow.count
      }
    };
  }

  // 🆕 НОВЫЕ МЕТОДЫ ДЛЯ INSIDER ALERTS

  async saveInsiderAlert(alert: {
    walletAddress: string;
    detectionMethod: string;
    confidenceScore: number;
    evidenceData: any;
    alertType: string;
  }): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO insider_alerts (
        wallet_address, detection_method, confidence_score, 
        evidence_data, alert_type
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      alert.walletAddress,
      alert.detectionMethod,
      alert.confidenceScore,
      JSON.stringify(alert.evidenceData),
      alert.alertType
    );

    return result.lastInsertRowid as number;
  }

  async getUnprocessedInsiderAlerts(limit: number = 20): Promise<Array<{
    id: number;
    walletAddress: string;
    detectionMethod: string;
    confidenceScore: number;
    evidenceData: any;
    alertType: string;
    createdAt: Date;
  }>> {
    const rows = this.db.prepare(`
      SELECT * FROM insider_alerts 
      WHERE processed = 0 
      ORDER BY confidence_score DESC, created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      detectionMethod: row.detection_method,
      confidenceScore: row.confidence_score,
      evidenceData: JSON.parse(row.evidence_data),
      alertType: row.alert_type,
      createdAt: new Date(row.created_at)
    }));
  }

  async markInsiderAlertAsProcessed(alertId: number, reported: boolean = false): Promise<void> {
    this.db.prepare(`
      UPDATE insider_alerts 
      SET processed = 1, reported = ?
      WHERE id = ?
    `).run(reported ? 1 : 0, alertId);
  }

  // 🆕 НОВЫЕ МЕТОДЫ ДЛЯ PROVIDER СТАТИСТИКИ

  async updateProviderStats(providerName: string, stats: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    status: string;
    priority: number;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO provider_stats (
        provider_name, provider_type, request_count, error_count,
        avg_response_time, status, priority, last_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      providerName,
      providerName.toLowerCase().includes('alchemy') ? 'alchemy' : 'quicknode',
      stats.requestCount,
      stats.errorCount,
      stats.avgResponseTime,
      stats.status,
      stats.priority
    );
  }

  async getProviderStats(): Promise<Array<{
    providerName: string;
    providerType: string;
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    status: string;
    priority: number;
    lastUsed: Date;
  }>> {
    const rows = this.db.prepare(`
      SELECT * FROM provider_stats 
      ORDER BY priority DESC, last_used DESC
    `).all() as any[];

    return rows.map(row => ({
      providerName: row.provider_name,
      providerType: row.provider_type,
      requestCount: row.request_count,
      errorCount: row.error_count,
      avgResponseTime: row.avg_response_time,
      status: row.status,
      priority: row.priority,
      lastUsed: new Date(row.last_used)
    }));
  }

  // Методы для Token Name Alerts
  async checkTokenNamePattern(tokenName: string, tokenAddress: string, holders: number): Promise<{
    shouldAlert: boolean;
    tokenAddress?: string;
    holders?: number;
    similarCount?: number;
  }> {
    // Нормализуем имя токена (убираем числа, специальные символы)
    const normalizedName = this.normalizeTokenName(tokenName);
    
    // Проверяем, есть ли уже такой паттерн
    const existingPattern = this.db.prepare(`
      SELECT * FROM token_name_patterns 
      WHERE pattern = ? 
      AND created_at > datetime('now', '-24 hours')
    `).get(normalizedName) as any;

    if (existingPattern) {
      // Обновляем счетчик и проверяем максимальное количество держателей
      if (holders > existingPattern.max_holders_count) {
        this.db.prepare(`
          UPDATE token_name_patterns 
          SET token_count = token_count + 1,
              max_holders_token = ?,
              max_holders_count = ?
          WHERE id = ?
        `).run(tokenAddress, holders, existingPattern.id);
      } else {
        this.db.prepare(`
          UPDATE token_name_patterns 
          SET token_count = token_count + 1
          WHERE id = ?
        `).run(existingPattern.id);
      }

      // Возвращаем true если это уже 5+ токенов и у лучшего 70+ держателей
      const shouldAlert = existingPattern.token_count + 1 >= 5 && 
                         Math.max(holders, existingPattern.max_holders_count) >= 70;
      
      if (shouldAlert) {
        return {
          shouldAlert: true,
          tokenAddress: holders > existingPattern.max_holders_count ? tokenAddress : existingPattern.max_holders_token,
          holders: Math.max(holders, existingPattern.max_holders_count),
          similarCount: existingPattern.token_count + 1
        };
      }
      
      return { shouldAlert: false };
    } else {
      // Создаем новый паттерн
      this.db.prepare(`
        INSERT INTO token_name_patterns 
        (pattern, first_seen, token_count, max_holders_token, max_holders_count)
        VALUES (?, datetime('now'), 1, ?, ?)
      `).run(normalizedName, tokenAddress, holders);

      return { shouldAlert: false };
    }
  }

  async getTopTokenNameAlert(pattern: string): Promise<{
    tokenAddress: string;
    holders: number;
    similarCount: number;
  } | null> {
    const row = this.db.prepare(`
      SELECT max_holders_token, max_holders_count, token_count
      FROM token_name_patterns 
      WHERE pattern = ?
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(pattern) as any;

    if (!row) return null;

    return {
      tokenAddress: row.max_holders_token,
      holders: row.max_holders_count,
      similarCount: row.token_count
    };
  }

  // Статистические методы
  async getDatabaseStats(): Promise<{
    totalTransactions: number;
    totalWallets: number;
    last24hTransactions: number;
    avgTransactionSize: number;
    positionAggregations: number;
    highSuspicionPositions: number;
    // 🆕 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА
    aggregatedTransactions: number;
    insiderAlerts: number;
    unprocessedAlerts: number;
    providerStats: Array<{
      name: string;
      requests: number;
      errors: number;
      successRate: number;
    }>;
  }> {
    const totalTransactions = this.db.prepare('SELECT COUNT(*) as count FROM transactions').get() as any;
    const totalWallets = this.db.prepare('SELECT COUNT(*) as count FROM wallets').get() as any;
    
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const last24hTransactions = this.db.prepare(
      'SELECT COUNT(*) as count FROM transactions WHERE timestamp > ?'
    ).get(last24h) as any;
    
    const avgSize = this.db.prepare('SELECT AVG(amount_usd) as avg FROM transactions').get() as any;
    
    const positionAggregations = this.db.prepare('SELECT COUNT(*) as count FROM position_aggregations').get() as any;
    const highSuspicionPositions = this.db.prepare(
      'SELECT COUNT(*) as count FROM position_aggregations WHERE suspicion_score >= 75'
    ).get() as any;

    // 🆕 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА
    const aggregatedTransactions = this.db.prepare(
      'SELECT COUNT(*) as count FROM transactions WHERE is_aggregated = 1'
    ).get() as any;

    const insiderAlerts = this.db.prepare('SELECT COUNT(*) as count FROM insider_alerts').get() as any;
    const unprocessedAlerts = this.db.prepare(
      'SELECT COUNT(*) as count FROM insider_alerts WHERE processed = 0'
    ).get() as any;

    const providerRows = this.db.prepare(`
      SELECT provider_name, request_count, error_count 
      FROM provider_stats
    `).all() as any[];

    const providerStats = providerRows.map(row => ({
      name: row.provider_name,
      requests: row.request_count,
      errors: row.error_count,
      successRate: row.request_count > 0 ? 
        ((row.request_count - row.error_count) / row.request_count * 100) : 100
    }));

    return {
      totalTransactions: totalTransactions.count,
      totalWallets: totalWallets.count,
      last24hTransactions: last24hTransactions.count,
      avgTransactionSize: avgSize.avg || 0,
      positionAggregations: positionAggregations.count,
      highSuspicionPositions: highSuspicionPositions.count,
      aggregatedTransactions: aggregatedTransactions.count,
      insiderAlerts: insiderAlerts.count,
      unprocessedAlerts: unprocessedAlerts.count,
      providerStats
    };
  }

  async close(): Promise<void> {
    this.db.close();
    this.logger.info('Database connection closed');
  }

  // Вспомогательные методы
  private mapRowToTokenSwap(row: any): TokenSwap {
    return {
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
      swapType: row.swap_type as 'buy' | 'sell'
    };
  }

  private normalizeTokenName(name: string): string {
    // Удаляем числа, специальные символы, приводим к нижнему регистру
    return name
      .toLowerCase()
      .replace(/[0-9]/g, '')
      .replace(/[^a-z]/g, '')
      .trim();
  }

  // Методы для совместимости с другими сервисами
  async getWalletsWithHighSuspicionScore(threshold: number = 70): Promise<WalletInfo[]> {
    const rows = this.db.prepare(`
      SELECT * FROM wallets 
      WHERE suspicion_score >= ? 
      ORDER BY suspicion_score DESC
    `).all(threshold) as any[];

    return rows.map(row => ({
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
    }));
  }

  // 🆕 НОВЫЕ УТИЛИТАРНЫЕ МЕТОДЫ

  async getAggregatedTransactionsByGroup(aggregationGroup: string): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE aggregation_group = ? 
      ORDER BY timestamp ASC
    `).all(aggregationGroup) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  async getTransactionsByAggregationId(aggregationId: number): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE aggregation_id = ? 
      ORDER BY timestamp ASC
    `).all(aggregationId) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }

  async getHighSuspicionTransactions(minScore: number = 75): Promise<TokenSwap[]> {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE suspicion_score >= ? 
      ORDER BY suspicion_score DESC, timestamp DESC
      LIMIT 100
    `).all(minScore) as any[];

    return rows.map(row => this.mapRowToTokenSwap(row));
  }
}