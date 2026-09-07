export interface BacktestTrade {
  id: string;
  timestamp: number;
  pnlPercent: number;
  pnlNative?: number;
  feePercent?: number;
  slippagePercent?: number;
  isWin?: boolean;
}

export interface StrategyPerformanceMetrics {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPercent: number;
  totalReturnPercent: number;
  netReturnPercent: number;
  avgWinPercent: number;
  avgLossPercent: number;
  calmarRatio: number;
}

export type ValidationVerdict = 'ACCEPT' | 'REVISE' | 'REJECT';

export interface ValidationFlag {
  type:
    | 'LOOK_AHEAD_BIAS'
    | 'OVERFITTING'
    | 'SAMPLE_SIZE_TOO_SMALL'
    | 'EXCESSIVE_DRAWDOWN'
    | 'POOR_RISK_REWARD';
  severity: 'CRITICAL' | 'WARNING';
  message: string;
}

export interface BacktestValidationReport {
  verdict: ValidationVerdict;
  metrics: StrategyPerformanceMetrics;
  flags: ValidationFlag[];
  details: string;
}

export interface WalkForwardResult {
  isPassed: boolean;
  inSampleMetrics: StrategyPerformanceMetrics;
  outOfSampleMetrics: StrategyPerformanceMetrics;
  sharpeDegradationPercent: number;
  rejectionReason?: string;
}

export function calculateStrategyMetrics(
  trades: BacktestTrade[],
  annualizationFactor: number = Math.sqrt(26)
): StrategyPerformanceMetrics {
  if (!trades || trades.length === 0) {
    return {
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdownPercent: 0,
      totalReturnPercent: 0,
      netReturnPercent: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      calmarRatio: 0,
    };
  }

  let totalGrossReturn = 0;
  let totalNetReturn = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;

  const netReturns: number[] = [];

  let equity = 100.0;
  let peakEquity = 100.0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    const grossPnl = trade.pnlPercent;
    const fee = trade.feePercent || 0;
    const slippage = trade.slippagePercent || 0;
    const netPnl = grossPnl - fee - slippage;

    totalGrossReturn += grossPnl;
    totalNetReturn += netPnl;
    netReturns.push(netPnl);

    if (netPnl > 0) {
      winCount++;
      totalWinAmount += netPnl;
    } else if (netPnl < 0) {
      lossCount++;
      totalLossAmount += Math.abs(netPnl);
    }

    equity = equity * (1 + netPnl / 100);
    if (equity < 0) equity = 0;

    if (equity > peakEquity) {
      peakEquity = equity;
    } else if (peakEquity > 0) {
      const dd = ((peakEquity - equity) / peakEquity) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    }
  }

  const n = trades.length;
  const winRate = (winCount / n) * 100;
  const avgWin = winCount > 0 ? totalWinAmount / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLossAmount / lossCount : 0;

  let profitFactor = 1.0;
  if (totalLossAmount > 0) {
    profitFactor = totalWinAmount / totalLossAmount;
  } else if (totalWinAmount > 0) {
    profitFactor = 99.0;
  }

  const meanReturn = totalNetReturn / n;

  let varianceSum = 0;
  for (const r of netReturns) {
    varianceSum += Math.pow(r - meanReturn, 2);
  }
  const variance = n > 1 ? varianceSum / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);

  let downsideSum = 0;
  for (const r of netReturns) {
    if (r < 0) {
      downsideSum += Math.pow(r, 2);
    }
  }
  const downsideDeviation = Math.sqrt(downsideSum / n);

  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * annualizationFactor : 0;
  const sortinoRatio =
    downsideDeviation > 0
      ? (meanReturn / downsideDeviation) * annualizationFactor
      : sharpeRatio;

  const calmarRatio = maxDrawdown > 0 ? totalNetReturn / maxDrawdown : 0;

  return {
    tradeCount: n,
    winCount,
    lossCount,
    winRate: Math.round(winRate * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdown * 100) / 100,
    totalReturnPercent: Math.round(totalGrossReturn * 100) / 100,
    netReturnPercent: Math.round(totalNetReturn * 100) / 100,
    avgWinPercent: Math.round(avgWin * 100) / 100,
    avgLossPercent: Math.round(avgLoss * 100) / 100,
    calmarRatio: Math.round(calmarRatio * 100) / 100,
  };
}

export function validateBacktestReport(trades: BacktestTrade[]): BacktestValidationReport {
  const metrics = calculateStrategyMetrics(trades);
  const flags: ValidationFlag[] = [];

  if (metrics.tradeCount < 50) {
    flags.push({
      type: 'SAMPLE_SIZE_TOO_SMALL',
      severity: 'WARNING',
      message: `Sample size (${metrics.tradeCount} trades) < 50 is statistically insufficient and vulnerable to regime bias.`,
    });
  }

  if (metrics.sharpeRatio > 4.5) {
    flags.push({
      type: 'LOOK_AHEAD_BIAS',
      severity: 'CRITICAL',
      message: `Annualized Sharpe Ratio (${metrics.sharpeRatio}) > 4.5 is abnormally high and strongly indicates look-ahead bias or data leakage.`,
    });
  }

  if (metrics.profitFactor > 3.5) {
    flags.push({
      type: 'OVERFITTING',
      severity: 'WARNING',
      message: `Profit Factor (${metrics.profitFactor}) > 3.5 strongly indicates curve-fitting on isolated historical data.`,
    });
  }

  if (metrics.maxDrawdownPercent > 25) {
    flags.push({
      type: 'EXCESSIVE_DRAWDOWN',
      severity: 'CRITICAL',
      message: `Max Drawdown (${metrics.maxDrawdownPercent}%) exceeds maximum acceptable threshold of 25%.`,
    });
  }

  if (metrics.tradeCount >= 50 && metrics.sharpeRatio < 1.2) {
    flags.push({
      type: 'POOR_RISK_REWARD',
      severity: 'WARNING',
      message: `Sharpe Ratio (${metrics.sharpeRatio}) < 1.2 is below minimum acceptable quant performance standard.`,
    });
  }

  let verdict: ValidationVerdict = 'ACCEPT';
  if (flags.some((f) => f.severity === 'CRITICAL')) {
    verdict = 'REJECT';
  } else if (flags.length > 0) {
    verdict = 'REVISE';
  }

  const details = `Verdict: ${verdict} | Trades: ${metrics.tradeCount} | Sharpe: ${metrics.sharpeRatio} | Sortino: ${metrics.sortinoRatio} | PF: ${metrics.profitFactor} | MDD: ${metrics.maxDrawdownPercent}%`;

  return {
    verdict,
    metrics,
    flags,
    details,
  };
}

export function runWalkForwardValidation(
  trades: BacktestTrade[],
  inSampleFraction: number = 0.7
): WalkForwardResult {
  if (!trades || trades.length < 2) {
    const emptyMetrics = calculateStrategyMetrics([]);
    return {
      isPassed: false,
      inSampleMetrics: emptyMetrics,
      outOfSampleMetrics: emptyMetrics,
      sharpeDegradationPercent: 100,
      rejectionReason: 'Insufficient trade count to split into In-Sample and Out-of-Sample.',
    };
  }

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const splitIndex = Math.max(1, Math.floor(sorted.length * inSampleFraction));

  const inSampleTrades = sorted.slice(0, splitIndex);
  const outOfSampleTrades = sorted.slice(splitIndex);

  const inSampleMetrics = calculateStrategyMetrics(inSampleTrades);
  const outOfSampleMetrics = calculateStrategyMetrics(outOfSampleTrades);

  let sharpeDegradationPercent = 0;
  if (inSampleMetrics.sharpeRatio > 0) {
    const drop = inSampleMetrics.sharpeRatio - outOfSampleMetrics.sharpeRatio;
    sharpeDegradationPercent = Math.max(0, (drop / inSampleMetrics.sharpeRatio) * 100);
  } else if (outOfSampleMetrics.sharpeRatio < inSampleMetrics.sharpeRatio) {
    sharpeDegradationPercent = 100;
  }

  const isPassed = sharpeDegradationPercent <= 40 && outOfSampleMetrics.sharpeRatio > 0;
  let rejectionReason: string | undefined;

  if (!isPassed) {
    if (outOfSampleMetrics.sharpeRatio <= 0) {
      rejectionReason = `Out-of-sample Sharpe Ratio (${outOfSampleMetrics.sharpeRatio}) is non-positive (severe forward degradation). Strategy fails forward testing.`;
    } else {
      rejectionReason = `Out-of-sample Sharpe degradation (${sharpeDegradationPercent.toFixed(1)}%) exceeds maximum allowed threshold of 40% (curve-fitting detected).`;
    }
  }

  return {
    isPassed,
    inSampleMetrics,
    outOfSampleMetrics,
    sharpeDegradationPercent: Math.round(sharpeDegradationPercent * 10) / 10,
    rejectionReason,
  };
}
