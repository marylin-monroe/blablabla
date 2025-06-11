// src/types/index.ts - БЕЗ Family Detection + АГРЕГАЦИЯ ПОЗИЦИЙ
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
  swapType?: 'buy' | 'sell';
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
  tokenSwap?: TokenSwap;
  tokenAddress?: string;
  tokenSymbol?: string;
  amountUSD?: number;
  price?: number;
  signalStrength?: number;
  timestamp?: Date;
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

// Smart Money типы - БЕЗ Family Detection
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
  
  // Family поля ОТКЛЮЧЕНЫ - всегда false/undefined
  isFamilyMember?: false; // всегда false
  familyAddresses?: undefined; // всегда undefined
  coordinationScore?: 0; // всегда 0
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
  
  // Family поля ОТКЛЮЧЕНЫ - всегда false/0/undefined
  isFamilyMember: false; // всегда false
  familySize?: 0; // всегда 0
  familyId?: undefined; // всегда undefined
}

// 🎯 НОВЫЕ ТИПЫ ДЛЯ АГРЕГАЦИИ ПОЗИЦИЙ

// Покупка в составе позиции
export interface PositionPurchase {
  transactionId: string;
  amountUSD: number;
  tokenAmount: number;
  price: number;
  timestamp: Date;
}

// Агрегированная позиция
export interface AggregatedPosition {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  
  // Покупки
  purchases: PositionPurchase[];
  totalUSD: number;
  totalTokens: number;
  avgPrice: number;
  purchaseCount: number;
  
  // Временные рамки
  firstBuyTime: Date;
  lastBuyTime: Date;
  timeWindowMinutes: number;
  
  // Метрики разбивки
  avgPurchaseSize: number;
  maxPurchaseSize: number;
  minPurchaseSize: number;
  sizeStandardDeviation: number;
  sizeCoefficient: number; // Коэффициент вариации
  
  // Детекция паттерна
  hasSimilarSizes: boolean;
  sizeTolerance: number; // В процентах
  suspicionScore: number; // 0-100
}

// Алерт о разбивке позиции
export interface PositionSplittingAlert {
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
    amountUSD: number;
    timestamp: Date;
    transactionId: string;
  }>;
}

// Сохраненная агрегация в БД
export interface SavedPositionAggregation {
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
}

// Статистика агрегации
export interface PositionAggregationStats {
  totalPositions: number;
  highSuspicionPositions: number; // score >= 75
  totalValueUSD: number;
  avgSuspicionScore: number;
  topWalletsByPositions: Array<{
    walletAddress: string;
    positionCount: number;
    totalValueUSD: number;
  }>;
}

// Группа похожих покупок
export interface SimilarPurchaseGroup {
  count: number;
  avgAmount: number;
  tolerance: number;
  amounts: number[];
}

// Family типы УДАЛЕНЫ - больше не используются
// export interface FamilyWalletCluster - УДАЛЕН

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
  familyConnections: []; // всегда пустой массив
  disqualificationReasons: string[];
}

// 🎯 КОНФИГУРАЦИЯ ДЕТЕКЦИИ АГРЕГАЦИИ
export interface PositionDetectionConfig {
  // Временное окно для агрегации
  timeWindowMinutes: number;        // 90 минут по умолчанию
  
  // Критерии разбивки позиции
  minPurchaseCount: number;         // Минимум 3 покупки
  minTotalUSD: number;              // Минимум $10K общая сумма
  maxIndividualUSD: number;         // Максимум $8K за одну покупку
  
  // Детекция похожих сумм
  similarSizeTolerance: number;     // 2% отклонение считается "одинаковой суммой"
  minSimilarPurchases: number;      // Минимум 3 похожие покупки
  
  // Другие фильтры
  positionTimeoutMinutes: number;   // 180 минут таймаут для закрытия позиции
  minSuspicionScore: number;        // Минимальный score для алерта
  
  // Фильтры кошельков
  minWalletAge: number;            // Минимум 7 дней возраст кошелька
  maxWalletActivity: number;       // Максимум 100 транзакций за день (анти-бот)
}

// 🎯 РЕЗУЛЬТАТ ФИЛЬТРАЦИИ КОШЕЛЬКА
export interface WalletFilterResult {
  passed: boolean;
  reason?: string;
}

// 🎯 СТАТИСТИКА АГРЕГАТОРА
export interface AggregationStats {
  activePositions: number;
  config: PositionDetectionConfig;
  positions: Array<{
    wallet: string;
    token: string;
    purchases: number;
    totalUSD: number;
    suspicionScore: number;
    hasSimilarSizes: boolean;
    timeWindow: number;
  }>;
}