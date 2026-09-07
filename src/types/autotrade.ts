import type { Position } from '../services/trade.service.js';

export type AutoTradeStrategyType =
  | 'SWARM_MOMENTUM'
  | 'MEAN_REVERSION'
  | 'ENSEMBLE'
  | 'BREAKOUT_SURGE'
  | 'SNIPER_ALPHA';
export type AutoTradeMode = 'PAPER' | 'LIVE';

export interface AutoTradeConfig {
  enabled: boolean;
  mode: AutoTradeMode;
  strategy: AutoTradeStrategyType;
  maxTradeAmountNative: number;
  maxOpenPositions: number;
  slippagePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  dailyMaxDrawdownPercent: number;
  minLiquidityUsd: number;
  autoSweepEnabled?: boolean;
  autoSweepThresholdNative?: number;
  autoSweepReserveNative?: number;
  vaultAddress?: string;
}

export type AutoTradeChain = 'ALL' | 'SOLANA' | 'BASE' | 'ETH';

export interface AutoTradeBotInstance {
  id: string;
  name: string;
  enabled: boolean;
  mode: AutoTradeMode;
  strategy: AutoTradeStrategyType;
  chain: AutoTradeChain;
  maxTradeAmountNative: number;
  maxOpenPositions: number;
  slippagePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  dailyMaxDrawdownPercent: number;
  minLiquidityUsd: number;
  createdAt: number;
  stats?: AutoTradeStats;
}

export interface AutoTradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnlNative: number;
  profitFactor: number;
  peakDrawdownPercent: number;
  currentDailyDrawdownPercent: number;
  circuitBreakerActive: boolean;
  activeAutoPositionsCount: number;
}

export interface AutoTradePosition extends Position {
  botId?: string;
  botName?: string;
  strategy: AutoTradeStrategyType;
  highestPriceUsd: number;
  tp1Hit: boolean;
  stopLossPriceUsd: number;
  entryTimestamp: number;
  originalAmountIn?: number;
  tp1PnlNative?: number;
}

export interface AutoTradeHistoryItem {
  id: string;
  botId?: string;
  botName?: string;
  positionId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  strategy: AutoTradeStrategyType;
  mode: AutoTradeMode;
  entryPriceUsd: number;
  exitPriceUsd: number;
  amountIn: number;
  pnlPercent: number;
  pnlNative: number;
  exitReason: 'TP1' | 'TRAILING_STOP' | 'HARD_STOP' | 'MANUAL';
  timestamp: number;
}

export type AutoTradeEventType =
  | 'AUTOTRADE_STATE'
  | 'AUTOTRADE_BUY'
  | 'AUTOTRADE_TP1'
  | 'AUTOTRADE_EXIT'
  | 'AUTOTRADE_SWEEP'
  | 'CIRCUIT_BREAKER_TRIPPED';

export interface AutoTradeEvent {
  type: AutoTradeEventType;
  timestamp: number;
  data: Record<string, unknown>;
}
