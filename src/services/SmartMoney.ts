// src/types/SmartMoney.ts
export interface SmartMoneyWallet {
  address: string;
  category: 'sniper' | 'hunter' | 'trader';
  winRate: number;
  totalPnL: number;
  totalTrades: number;
  avgTradeSize: number;
  maxTradeSize: number;
  minTradeSize: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  lastActiveAt: Date;
  performanceScore: number;
  volumeScore?: number;
  isActive: boolean;
  
  // Семейные связи
  isFamilyMember?: boolean;
  familyAddresses?: string[];
  coordinationScore?: number;
  stealthLevel?: number;
  
  // Категория-специфичные метрики
  earlyEntryRate?: number;
  avgHoldTime?: number;
  
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SmartMoneyFlow {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  period: '1h' | '24h';
  totalInflowUSD: number;
  totalOutflowUSD: number;
  netFlowUSD: number;
  uniqueWallets: number;
  avgTradeSize: number;
  topWallets: Array<{
    address: string;
    amountUSD: number;
    category: string;
  }>;
}

export interface HotNewToken {
  address: string;
  symbol: string;
  name: string;
  fdv: number;
  smStakeUSD: number;
  ageHours: number;
  buyVolumeUSD: number;
  sellVolumeUSD: number;
  buyCount: number;
  sellCount: number;
  uniqueSmWallets: number;
  topBuyers: Array<{
    address: string;
    amountUSD: number;
    category: string;
  }>;
}

export interface SmartMoneySwap {
  transactionId: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenAmount: number;
  amountUSD: number;
  swapType: 'buy' | 'sell';
  timestamp: Date;
  
  // Smart Money метрики
  category: 'sniper' | 'hunter' | 'trader';
  winRate: number;
  pnl: number;
  totalTrades: number;
  
  // Семейная информация
  isFamilyMember: boolean;
  familySize?: number;
  familyId?: string;
}

export interface FamilyWalletCluster {
  id: string;
  wallets: string[];
  suspicionScore: number;
  coordinationScore: number;
  detectionMethods: string[];
  totalPnL: number;
  combinedVolume: number;
  avgTimingDiff: number;
  commonTokens: string[];
  createdAt: Date;
}

export interface WalletPerformanceMetrics {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  avgTradeSize: number;
  maxTradeSize: number;
  minTradeSize: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  avgHoldTime: number;
  earlyEntryRate: number;
  recentActivity: Date;
}

export interface WalletAnalysisResult {
  address: string;
  isSmartMoney: boolean;
  category?: 'sniper' | 'hunter' | 'trader';
  metrics: WalletPerformanceMetrics;
  familyConnections: string[];
  disqualificationReasons: string[];
}

export interface TokenSwap {
  id?: string;
  transactionId: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amount: number;
  amountUSD: number;
  price: number;
  swapType: 'buy' | 'sell';
  timestamp: Date;
  dex: string;
  
  // Дополнительные поля для уведомлений
  multiplier?: number;
  winrate?: number;
  pnl?: number;
  timeToTarget?: string;
}

// Дополнительные типы для существующего функционала
export interface InsiderAlert {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  amountUSD: number;
  price: number;
  signalStrength: number;
  timestamp: Date;
}

export interface WalletInfo {
  address: string;
  totalVolume: number;
  tradeCount: number;
  winRate: number;
  avgTradeSize: number;
  lastActive: Date;
}

export interface SmartMoneyReport {
  period: string;
  totalVolume: number;
  totalTrades: number;
  uniqueWallets: number;
  tokenAggregations: Array<{
    tokenSymbol: string;
    tokenAddress: string;
    totalVolumeUSD: number;
    uniqueWallets: Set<string>;
    tradeCount: number;
  }>;
}