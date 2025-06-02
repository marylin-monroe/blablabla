// src/types/index.ts
export interface TokenSwap {
  transactionId: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amount: number;
  amountUSD: number;
  timestamp: Date;
  dex: string;
  isNewWallet: boolean;
  isReactivatedWallet: boolean;
  walletAge: number;
  daysSinceLastActivity: number;
  price?: number;
  pnl?: number;
  multiplier?: number;
  winrate?: number;
  timeToTarget?: string;
}

export interface WalletInfo {
  address: string;
  createdAt: Date;
  lastActivityAt: Date;
  isNew: boolean;
  isReactivated: boolean;
  relatedWallets?: string[];
  tradingHistory?: TradingHistory;
  suspicionScore?: number;
  insiderFlags?: string[];
}

export interface TradingHistory {
  totalTrades: number;
  winRate: number;
  avgBuySize: number;
  maxBuySize: number;
  minBuySize: number;
  sizeProgression: number[];
  timeProgression: Date[];
  panicSells: number;
  fomoeBuys: number;
  fakeLosses: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  createdAt?: Date;
  isNew?: boolean;
  launchPrice?: number;
  currentPrice?: number;
}

export interface TokenAggregation {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  totalVolumeUSD: number;
  uniqueWallets: Set<string>;
  transactions: TokenSwap[];
  isNewToken: boolean;
  biggestPurchase?: TokenSwap;
  firstPurchaseTime: Date;
  lastPurchaseTime: Date;
  avgWalletAge: number;
  suspiciousWallets: number;
}

export interface SmartMoneyReport {
  period: string;
  tokenAggregations: TokenAggregation[];
  totalVolumeUSD: number;
  uniqueTokensCount: number;
  bigOrders: TokenSwap[];
  insiderAlerts: InsiderAlert[];
}

export interface InsiderAlert {
  walletAddress: string;
  tokenSwap: TokenSwap;
  suspicionScore: number;
  detectionReasons: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  tradingHistory: TradingHistory;
}

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  blockTime: number;
  fee: number;
  feePayer: string;
  instructions: any[];
  events?: any[];
  nativeTransfers?: any[];
  tokenTransfers?: any[];
  accountData?: any[];
  transactionError?: any;
}