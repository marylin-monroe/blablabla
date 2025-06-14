// src/types/WhaleTypes.ts
export interface LargeTransaction {
  signature: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amountUSD: number;
  timestamp: Date;
  dex: string;
  swapType: 'buy' | 'sell';
  blockTime: number;
  slot: number;
}

export interface HighVolumeSwap {
  signature: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amountUSD: number;
  timestamp: Date;
  swapType: 'buy' | 'sell';
  priceImpact: number;
  slippage: number;
}

export interface WhaleAlert {
  id: string;
  signature: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amountUSD: number;
  timestamp: Date;
  source: 'dexscreener' | 'jupiter';
  dex: string;
  swapType: 'buy' | 'sell';
  validationScore: number;
  riskFlags: string[];
  category: 'whale' | 'mega_whale'; // whale = $2M+, mega_whale = $10M+
  notificationSent: boolean;
  processed: boolean;
  createdAt: Date;
}

export interface WhaleFilterConfig {
  minAmountUSD: number;
  maxTransactionAge: number; // в минутах
  excludeTokenCreators: boolean;
  excludeTopHolders: boolean;
  maxTopHolderPercentage: number;
  minTokenAge: number; // в часах
  minTokenLiquidity: number;
  excludeRelatedWallets: boolean;
  maxRelatedWallets: number;
  enableWashTradingDetection: boolean;
  enableTimingAnalysis: boolean;
}

export interface WhaleScanConfig {
  scanInterval: {
    intensive: number; // рабочие часы
    moderate: number;  // обычное время
    minimal: number;   // выходные
  };
  sources: {
    dexScreener: boolean;
    jupiter: boolean;
  };
  limits: {
    maxCandidatesPerScan: number;
    maxNotificationsPerHour: number;
  };
}

export interface WhaleNotificationConfig {
  enabled: boolean;
  minAmount: number;
  maxNotificationsPerHour: number;
  includePriceImpact: boolean;
  includeTokenAge: boolean;
  includeWalletAnalysis: boolean;
  telegramFormat: 'compact' | 'detailed';
}

export interface WhaleScanMetrics {
  totalScans: number;
  totalCandidatesFound: number;
  totalValidWhales: number;
  totalSpamFiltered: number;
  totalNotificationsSent: number;
  lastScanTime: Date;
  avgScanDuration: number;
  successRate: number;
  sourceStats: {
    dexScreener: {
      scans: number;
      candidates: number;
      validWhales: number;
    };
    jupiter: {
      scans: number;
      candidates: number;
      validWhales: number;
    };
  };
}

export interface WhaleValidationRequest {
  walletAddress: string;
  tokenAddress: string;
  amountUSD: number;
  timestamp: Date;
  swapType: 'buy' | 'sell';
  source: string;
}

export interface WhaleValidationResult {
  isValid: boolean;
  validationScore: number; // 0-100
  reason?: string;
  riskFlags: string[];
  confidence: number; // 0-100
  details?: {
    tokenAnalysis?: {
      age: number;
      liquidity: number;
      holders: number;
      marketCap: number;
    };
    walletAnalysis?: {
      isTokenCreator: boolean;
      isTopHolder: boolean;
      holdingPercentage: number;
      relatedWallets: number;
      riskScore: number;
    };
    transactionAnalysis?: {
      priceImpact: number;
      timing: string;
      frequency: number;
    };
  };
}

export interface WhaleDatabase {
  // Методы для работы с БД китов
  saveWhaleTransaction(whale: WhaleAlert): Promise<number>;
  getWhaleTransactions(limit?: number): Promise<WhaleAlert[]>;
  getWhalesByTimeRange(start: Date, end: Date): Promise<WhaleAlert[]>;
  getWhalesByAmount(minAmount: number): Promise<WhaleAlert[]>;
  getWhalesByToken(tokenAddress: string): Promise<WhaleAlert[]>;
  getWhalesByWallet(walletAddress: string): Promise<WhaleAlert[]>;
  markWhaleAsProcessed(whaleId: string): Promise<void>;
  updateWhaleValidation(whaleId: string, validation: WhaleValidationResult): Promise<void>;
  getWhaleScanMetrics(): Promise<WhaleScanMetrics>;
}

export interface WhaleServiceConfig {
  enabled: boolean;
  scanInterval: number;
  filterConfig: WhaleFilterConfig;
  notificationConfig: WhaleNotificationConfig;
  sources: {
    dexScreener: {
      enabled: boolean;
      rateLimit: number;
      endpoints: string[];
    };
    jupiter: {
      enabled: boolean;
      rateLimit: number;
      endpoints: string[];
    };
  };
  validation: {
    strictMode: boolean;
    minValidationScore: number;
    requireMultipleValidators: boolean;
  };
}

// Константы для классификации китов
export const WHALE_CATEGORIES = {
  WHALE: {
    minAmount: 2_000_000, // $2M
    emoji: '🐋',
    label: 'Whale'
  },
  MEGA_WHALE: {
    minAmount: 10_000_000, // $10M
    emoji: '🐋💎',
    label: 'Mega Whale'
  },
  ULTRA_WHALE: {
    minAmount: 50_000_000, // $50M
    emoji: '🐋👑',
    label: 'Ultra Whale'
  }
} as const;

// Флаги рисков
export const RISK_FLAGS = {
  // Токен-связанные риски
  TOKEN_CREATOR: 'TOKEN_CREATOR',
  TOP_HOLDER: 'TOP_HOLDER',
  LARGE_HOLDER: 'LARGE_HOLDER',
  NEW_TOKEN: 'NEW_TOKEN',
  LOW_LIQUIDITY: 'LOW_LIQUIDITY',
  KNOWN_SCAM: 'KNOWN_SCAM',
  
  // Кошелек-связанные риски
  COORDINATED_ACTIVITY: 'COORDINATED_ACTIVITY',
  WASH_TRADING: 'WASH_TRADING',
  SUSPICIOUS_TIMING: 'SUSPICIOUS_TIMING',
  BOT_ACTIVITY: 'BOT_ACTIVITY',
  
  // Транзакция-связанные риски
  TRANSACTION_TOO_OLD: 'TRANSACTION_TOO_OLD',
  AMOUNT_TOO_SMALL: 'AMOUNT_TOO_SMALL',
  HIGH_PRICE_IMPACT: 'HIGH_PRICE_IMPACT',
  UNUSUAL_SLIPPAGE: 'UNUSUAL_SLIPPAGE',
  
  // Системные флаги
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  API_ERROR: 'API_ERROR'
} as const;

// Источники данных
export const WHALE_SOURCES = {
  DEXSCREENER: 'dexscreener',
  JUPITER: 'jupiter',
  MANUAL: 'manual'
} as const;

export type WhaleCategory = keyof typeof WHALE_CATEGORIES;
export type RiskFlag = typeof RISK_FLAGS[keyof typeof RISK_FLAGS];
export type WhaleSource = typeof WHALE_SOURCES[keyof typeof WHALE_SOURCES];