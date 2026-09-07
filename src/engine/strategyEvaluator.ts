import type { PublicTokenSignal } from '../services/marketFeed.service.js';
import type { AutoTradeConfig, AutoTradeStrategyType } from '../types/autotrade.js';

export interface EvaluationResult {
  shouldEnter: boolean;
  reason: string;
  confidence: number;
}

export function evaluateSignalForStrategy(
  signal: PublicTokenSignal,
  strategy: AutoTradeStrategyType,
  config: AutoTradeConfig
): EvaluationResult {

  if ((signal.liquidity || 0) < config.minLiquidityUsd) {
    return {
      shouldEnter: false,
      reason: `Liquidity ($${signal.liquidity || 0}) below minimum threshold ($${config.minLiquidityUsd})`,
      confidence: 0,
    };
  }

  if (signal.rating === 'NEUTRAL' || signal.rating?.includes('HONEYPOT')) {
    return {
      shouldEnter: false,
      reason: 'Signal tier is NEUTRAL or detected as potential risk trap',
      confidence: 0,
    };
  }

  if (strategy === 'SWARM_MOMENTUM') {
    return evaluateSwarmMomentum(signal);
  }

  if (strategy === 'MEAN_REVERSION') {
    return evaluateMeanReversion(signal);
  }

  if (strategy === 'BREAKOUT_SURGE') {
    return evaluateBreakoutSurge(signal);
  }

  if (strategy === 'SNIPER_ALPHA') {
    return evaluateSniperAlpha(signal, config);
  }

  if (strategy === 'ENSEMBLE') {
    const swarmResult = evaluateSwarmMomentum(signal);
    if (swarmResult.shouldEnter) return swarmResult;

    const meanRevResult = evaluateMeanReversion(signal);
    if (meanRevResult.shouldEnter) return meanRevResult;

    const breakoutResult = evaluateBreakoutSurge(signal);
    if (breakoutResult.shouldEnter) return breakoutResult;

    const sniperResult = evaluateSniperAlpha(signal, config);
    if (sniperResult.shouldEnter) return sniperResult;

    return {
      shouldEnter: false,
      reason: 'Signal did not meet Swarm Momentum, Mean Reversion, Breakout, or Sniper criteria',
      confidence: Math.max(swarmResult.confidence, meanRevResult.confidence, breakoutResult.confidence, sniperResult.confidence),
    };
  }

  return {
    shouldEnter: false,
    reason: `Unknown strategy: ${strategy}`,
    confidence: 0,
  };
}

function evaluateSwarmMomentum(signal: PublicTokenSignal): EvaluationResult {

  if (signal.earlySelling) {
    return {
      shouldEnter: false,
      reason: 'Early selling detected in wallet cluster (negative flow toxicity)',
      confidence: 0.1,
    };
  }

  const isHighTier =
    signal.rating === 'PLATINUM' ||
    signal.rating === 'GOLD' ||
    signal.rating === 'ROYAL_HONEY' ||
    signal.rating === 'SWARM_INBOUND' ||
    signal.rating?.includes('★');

  if (!isHighTier) {
    return {
      shouldEnter: false,
      reason: `Rating ${signal.rating} does not meet Swarm momentum tier requirement`,
      confidence: 0.3,
    };
  }

  const liqRatio = signal.liqRatio || 0;
  if (liqRatio < 10.0 || liqRatio > 75.0) {
    return {
      shouldEnter: false,
      reason: `Liquidity/MCap ratio (${liqRatio}%) is outside safe bounds (10% - 75%)`,
      confidence: 0.2,
    };
  }

  const minCluster = signal.smartWalletsInferred ? 5 : 3;
  if ((signal.smartWalletsCount || 0) < minCluster) {
    return {
      shouldEnter: false,
      reason: `Insufficient smart wallet cluster density (${signal.smartWalletsCount || 0} < ${minCluster})`,
      confidence: 0.4,
    };
  }

  const isTopTier = signal.rating === 'PLATINUM' || signal.rating === 'ROYAL_HONEY';
  const baseConfidence = isTopTier ? 0.9 : 0.75;
  const clusterBonus = Math.min(0.08, ((signal.smartWalletsCount || 3) - 3) * 0.02);

  return {
    shouldEnter: true,
    reason: `Swarm Alpha Momentum: Estimated cluster (${signal.smartWalletsCount} buys-derived wallets, ${signal.liqRatio}% liq ratio, 0 dumps)`,
    confidence: parseFloat(Math.min(0.98, baseConfidence + clusterBonus).toFixed(2)),
  };
}

function evaluateMeanReversion(signal: PublicTokenSignal): EvaluationResult {

  if ((signal.ageMinutes || 0) < 60) {
    return {
      shouldEnter: false,
      reason: `Pool age (${signal.ageMinutes || 0}m) too young for mean-reversion equilibrium (minimum 60m)`,
      confidence: 0.2,
    };
  }

  if ((signal.volume24h || 0) < 25000) {
    return {
      shouldEnter: false,
      reason: `24h volume ($${signal.volume24h || 0}) too low for statistical reversion`,
      confidence: 0.3,
    };
  }

  const priceChange = signal.priceChange24h || 0;
  const isOversold = priceChange <= -10;

  if (!isOversold) {
    return {
      shouldEnter: false,
      reason: `Price change (${priceChange}%) does not represent an oversold pullback (threshold <= -10%)`,
      confidence: 0.4,
    };
  }

  if (signal.earlySelling) {
    return {
      shouldEnter: false,
      reason: 'Early dump active, avoiding toxic liquidity knives',
      confidence: 0.2,
    };
  }

  return {
    shouldEnter: true,
    reason: `Mean-Reversion Dip: Mature pool (${(signal.ageMinutes / 60).toFixed(1)}h), oversold at ${priceChange}% with healthy volume`,
    confidence: 0.82,
  };
}

function evaluateBreakoutSurge(signal: PublicTokenSignal): EvaluationResult {
  if (signal.earlySelling) {
    return {
      shouldEnter: false,
      reason: 'Early dump detected, cancelling breakout momentum',
      confidence: 0.1,
    };
  }

  const buys5m = signal.buys5m || 0;
  const sells5m = signal.sells5m || 0;
  const priceChange = signal.priceChange24h || 0;

  const hasBuySurge = buys5m >= 12 && (sells5m === 0 || buys5m >= sells5m * 1.8);
  const hasPriceBreakout = priceChange >= 8 && (signal.volume24h || 0) >= 20000;

  if (!hasBuySurge && !hasPriceBreakout) {
    return {
      shouldEnter: false,
      reason: `Insufficient breakout volume or momentum (5m Buys: ${buys5m}, Sells: ${sells5m}, 24h: ${priceChange}%)`,
      confidence: 0.35,
    };
  }

  const liqRatio = signal.liqRatio || 0;
  if (liqRatio < 10.0 || liqRatio > 80.0) {
    return {
      shouldEnter: false,
      reason: `Liquidity/MCap ratio (${liqRatio}%) out of breakout bounds (10% - 80%)`,
      confidence: 0.3,
    };
  }

  return {
    shouldEnter: true,
    reason: `Breakout Surge: Volume spike (${buys5m} buys/5m), ${priceChange > 0 ? '+' : ''}${priceChange}% price momentum`,
    confidence: 0.86,
  };
}

function evaluateSniperAlpha(signal: PublicTokenSignal, config: AutoTradeConfig): EvaluationResult {

  if ((signal.ageMinutes || 0) > 45) {
    return {
      shouldEnter: false,
      reason: `Pool age (${signal.ageMinutes || 0}m) exceeds fresh sniper limit (max 45m)`,
      confidence: 0.2,
    };
  }

  if (signal.earlySelling) {
    return {
      shouldEnter: false,
      reason: 'Toxic early seller dump detected in fresh pool',
      confidence: 0.1,
    };
  }

  if ((signal.liquidity || 0) < config.minLiquidityUsd) {
    return {
      shouldEnter: false,
      reason: `Fresh pool liquidity ($${signal.liquidity || 0}) below safety threshold ($${config.minLiquidityUsd})`,
      confidence: 0.3,
    };
  }

  const hasEarlyInflow = (signal.smartWalletsCount || 0) >= 3 || (signal.buys5m || 0) >= 8;
  if (!hasEarlyInflow) {
    return {
      shouldEnter: false,
      reason: `Insufficient early accumulation cluster (${signal.smartWalletsCount || 0} wallets, ${signal.buys5m || 0} 5m buys)`,
      confidence: 0.4,
    };
  }

  return {
    shouldEnter: true,
    reason: `Sniper Alpha: Fresh pool (${signal.ageMinutes || 0}m old, $${Math.round(signal.liquidity)} liq) with early accumulation`,
    confidence: 0.91,
  };
}

export function calculateKellyTradeSize(
  walletBalance: number,
  winRate: number,
  profitFactor: number,
  maxCap: number,
  fraction: number = 0.25
): number {
  if (walletBalance <= 0 || winRate <= 0 || profitFactor <= 0 || maxCap <= 0) {
    return 0;
  }

  const p = Math.min(0.99, Math.max(0.01, winRate));
  const b = Math.max(0.1, profitFactor);
  const q = 1 - p;

  const edge = p * b - q;
  if (edge <= 0) {
    return 0;
  }

  const fullKellyFraction = edge / b;
  const targetFraction = Math.min(1.0, Math.max(0, fraction * fullKellyFraction));
  const rawTradeAmount = walletBalance * targetFraction;

  const finalAmount = Math.min(maxCap, rawTradeAmount);
  return Math.floor(finalAmount * 10000) / 10000;
}

export function calculateDrawdownModulation(currentDrawdown: number, maxDrawdown: number): number {
  if (maxDrawdown <= 0) return 0;
  if (currentDrawdown >= maxDrawdown) return 0;
  if (currentDrawdown <= 0) return 1.0;

  const multiplier = 1.0 - currentDrawdown / maxDrawdown;
  return Math.max(0, Math.min(1.0, multiplier));
}
