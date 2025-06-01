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
}

export interface WalletInfo {
  address: string;
  createdAt: Date;
  lastActivityAt: Date;
  isNew: boolean;
  isReactivated: boolean;
  relatedWallets?: string[];
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  createdAt?: Date;
  isNew?: boolean;
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
}

export interface SmartMoneyReport {
  period: string;
  tokenAggregations: TokenAggregation[];
  totalVolumeUSD: number;
  uniqueTokensCount: number;
  bigOrders: TokenSwap[];
}