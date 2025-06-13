// src/types/index.ts - АККУРАТНО ДОБАВЛЕНЫ ТИПЫ ДЛЯ ВНЕШНЕГО ПОИСКА + ВСЕ СУЩЕСТВУЮЩИЕ ТИПЫ СОХРАНЕНЫ

// ===== СУЩЕСТВУЮЩИЕ ТИПЫ (БЕЗ ИЗМЕНЕНИЙ) =====

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
  // 🆕 НОВЫЕ ПОЛЯ ДЛЯ POSITION AGGREGATION
  isAggregated?: boolean;
  aggregationId?: number;
  suspicionScore?: number;
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

// 🆕 НОВЫЙ ИНТЕРФЕЙС ДЛЯ ДЕТЕКЦИИ ИНСАЙДЕРОВ
export interface PositionAggregation {
  id: number;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  totalUSD: number;
  purchaseCount: number;
  avgPurchaseSize: number;
  timeWindowMinutes: number;
  suspicionScore: number; // 0-100
  sizeTolerance: number;
  firstBuyTime: Date;
  lastBuyTime: Date;
  detectedAt: Date;
  purchases: Array<{
    transactionId: string;
    amountUSD: number;
    timestamp: Date;
  }>;
  // Дополнительные поля для анализа
  maxPurchaseSize: number;
  minPurchaseSize: number;
  sizeStdDeviation: number;
  sizeCoefficient: number;
  similarSizeCount: number;
  walletAgeDays: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  isProcessed: boolean;
  alertSent: boolean;
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
  // 🆕 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА
  unprocessedPositions: number;
  alertsSent: number;
  riskDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

// Группа похожих покупок
export interface SimilarPurchaseGroup {
  count: number;
  avgAmount: number;
  tolerance: number;
  amounts: number[];
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
  timestamp: Date;
  consecutiveFailures: number;
  lastSuccessTime?: Date;
}

// Кеш для API ответов
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
  provider: string;
  hitCount: number;
}

// Настройки кеширования
export interface CacheConfig {
  enabled: boolean;
  defaultTTL: number; // секунды
  maxSize: number; // максимальное количество записей
  cleanupInterval: number; // секунды
  
  // TTL для разных типов запросов
  methodTTL: Record<string, number>;
}

// Метрики MultiProvider системы
export interface MultiProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  
  // Провайдеры
  totalProviders: number;
  healthyProviders: number;
  primaryProvider: string;
  
  // Кеш
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  cacheSize: number;
  
  // Failover
  failovers: number;
  lastFailoverTime?: Date;
  
  // Распределение нагрузки
  providerDistribution: Record<string, number>;
}

// 🆕 РАСШИРЕНИЕ DatabaseStats С POSITION AGGREGATION
export interface DatabaseStats {
  totalTransactions: number;
  totalWallets: number;
  last24hTransactions: number;
  avgTransactionSize: number;
  // 🆕 НОВОЕ ПОЛЕ
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
}

// 🆕 РАСШИРЕННАЯ СТАТИСТИКА ОБРАБОТКИ С POSITION AGGREGATION
export interface ProcessingStats {
  totalTransactionsProcessed: number;
  smartMoneyTransactions: number;
  regularTransactions: number;
  // 🆕 НОВЫЕ ПОЛЯ
  positionAggregations: number;
  suspiciousPositions: number;
  alertsSent: number;
  filteredTransactions: number;
  errorCount: number;
  avgProcessingTime: number;
  lastProcessedTime: Date;
  
  // Детальная статистика по типам
  transactionTypes: {
    swaps: number;
    transfers: number;
    other: number;
  };
  
  // 🆕 УРОВНИ РИСКА
  riskLevels: {
    high: number;
    medium: number;
    low: number;
  };
}

// ===== 🆕 НОВЫЕ ТИПЫ ДЛЯ ВНЕШНЕГО ПОИСКА КОШЕЛЬКОВ =====

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
  avgHoldTime: number; // в часах
  earlyEntryRate: number; // процент ранних входов
  performanceScore?: number; // общий скор 0-100 (опционально для обратной совместимости)
  recentActivity: Date;
  volumeScore?: number;
}

export interface WalletAnalysisResult {
  address: string;
  isSmartMoney: boolean;
  category?: 'sniper' | 'hunter' | 'trader';
  metrics: WalletPerformanceMetrics;
  disqualificationReasons: string[];
  // 🆕 НОВОЕ поле для дополнительного анализа
  analysis?: {
    totalTransactions: number;
    analyzedPeriod: string;
    confidenceScore: number;
  };
  // Family поля БЛОКИРОВАНЫ - всегда пустой массив
  familyConnections: []; // всегда пустой массив
}

// 🆕 ТИПЫ ДЛЯ ВНЕШНИХ API

export interface ExternalTokenCandidate {
  address: string;
  source: 'dexscreener' | 'jupiter';
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
  age?: number; // days since creation
  score?: number;
}

export interface ExternalWalletCandidate {
  address: string;
  score: number;
  reasons: string[];
  lastActivity: Date;
  estimatedVolume: number;
  tokenCount: number;
  source: 'token_holders' | 'recent_traders' | 'high_volume';
}

// 🆕 ТИПЫ ДЛЯ КРЕДИТНОГО МЕНЕДЖЕРА

export interface ApiCreditUsage {
  provider: 'quicknode' | 'alchemy';
  operation: string;
  credits: number;
  timestamp: Date;
  success: boolean;
}

export interface ProviderStats {
  dailyUsage: number;
  hourlyUsage: number;
  totalUsage: number;
  lastReset: Date;
  isAvailable: boolean;
  errorCount: number;
}

export interface CreditManagerStats {
  currentProvider: string;
  providers: Record<string, ProviderStats>;
  totalCreditsToday: number;
  remainingCreditsToday: number;
  hourlyRate: number;
  projectedDailyUsage: number;
}

// 🆕 РАСШИРЕННАЯ СТАТИСТИКА DISCOVERY

export interface DiscoveryStats {
  isRunning: boolean;
  externalSearchEnabled: boolean;
  lastRun?: Date;
  totalAnalyzed: number;
  smartMoneyFound: number;
  newWalletsAdded: number;
  discoveryRate: number;
  creditStats?: CreditManagerStats;
  externalSources?: {
    dexscreener: { requests: number; tokens: number };
    jupiter: { requests: number; tokens: number };
  };
}

// ===== ОСТАЛЬНЫЕ СУЩЕСТВУЮЩИЕ ТИПЫ (БЕЗ ИЗМЕНЕНИЙ) =====

// Провайдер здоровья
export interface ProviderHealth {
  name: string;
  isHealthy: boolean;
  lastCheck: Date;
  responseTime: number;
  errorRate: number;
  consecutiveFailures: number;
  lastSuccessTime?: Date;
}

// 🆕 СТАТИСТИКА ПРОВАЙДЕРОВ
export interface ProviderStatsExtended {
  quicknode: ProviderStats;
  alchemy: ProviderStats;
  [key: string]: ProviderStats;
}

// 🆕 ТИПЫ ДЛЯ ADVANCED POSITION ANALYSIS
export interface AdvancedPositionAnalysis {
  walletAddress: string;
  analysisType: 'position_splitting' | 'coordinated_buying' | 'wash_trading';
  confidence: number; // 0-100
  riskScore: number; // 0-100
  
  patterns: Array<{
    type: string;
    description: string;
    evidence: any[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  
  recommendations: string[];
  shouldAlert: boolean;
  shouldBlock: boolean;
}

// 🆕 CONFIGURATION FOR POSITION MONITORING
export interface PositionMonitoringConfig {
  enabled: boolean;
  
  // Thresholds
  minPositionSize: number; // USD
  maxPositionSplits: number;
  timeWindowHours: number;
  
  // Detection sensitivity
  sizeSimilarityThreshold: number; // percentage
  timingThreshold: number; // minutes
  suspicionThreshold: number; // 0-100
  
  // Actions
  autoAlert: boolean;
  autoBlock: boolean;
  telegramNotifications: boolean;
  
  // Advanced features
  mlDetection: boolean;
  behaviorAnalysis: boolean;
  networkAnalysis: boolean;
}

// 🆕 WALLET RISK PROFILE
export interface WalletRiskProfile {
  address: string;
  overallRisk: number; // 0-100
  lastUpdated: Date;
  
  riskFactors: {
    newWallet: boolean;
    highActivity: boolean;
    suspiciousPatterns: boolean;
    relatedToKnownActors: boolean;
    positionSplitting: boolean;
    washTrading: boolean;
    frontRunning: boolean;
  };
  
  behaviorMetrics: {
    avgTransactionSize: number;
    transactionFrequency: number;
    tradingHours: number[];
    preferredTokens: string[];
    gasUsagePattern: string;
  };
  
  networkConnections: {
    directConnections: string[];
    clusterMembership: string[];
    suspiciousConnections: number;
  };
}

// 🆕 SMART MONEY DETECTION RESULT
export interface SmartMoneyDetectionResult {
  isSmartMoney: boolean;
  confidence: number;
  category: 'sniper' | 'hunter' | 'trader' | 'unknown';
  
  indicators: {
    earlyEntry: boolean;
    highWinRate: boolean;
    largeTrades: boolean;
    consistentProfits: boolean;
    timeConsistency: boolean;
  };
  
  metrics: {
    winRate: number;
    avgTradeSize: number;
    totalPnL: number;
    tradingFrequency: number;
    riskAdjustedReturns: number;
  };
  
  redFlags: string[];
  recommendation: 'monitor' | 'add_to_smart_money' | 'investigate' | 'ignore';
}