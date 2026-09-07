import { describe, it, expect } from 'vitest';
import {
  calculateStrategyMetrics,
  validateBacktestReport,
  runWalkForwardValidation,
  type BacktestTrade,
} from '../../src/engine/backtestValidator.js';

describe('Trading Backtest Validator (trading-backtest-validator skill)', () => {

  function generateSyntheticTrades(count: number, winRatePct: number, avgWin: number, avgLoss: number): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    const baseTime = 1700000000000;
    for (let i = 0; i < count; i++) {

      const isWin = ((i * 17 + 11) % 100) < winRatePct;
      const rawPnl = isWin ? avgWin : -avgLoss;
      trades.push({
        id: `trade_${i}`,
        timestamp: baseTime + i * 3600000,
        pnlPercent: rawPnl,
        feePercent: 0.2, // 0.2% DEX fee
        slippagePercent: 0.1, // 0.1% slippage
      });
    }
    return trades;
  }

  describe('1. Strategy Performance Metrics & Fee/Slippage Realism', () => {
    it('calculates win rate, profit factor, max drawdown, Sharpe and Sortino ratios', () => {

      const trades = generateSyntheticTrades(100, 60, 10, 5);
      const metrics = calculateStrategyMetrics(trades);

      expect(metrics.tradeCount).toBe(100);
      expect(metrics.winRate).toBe(60);
      expect(metrics.profitFactor).toBeGreaterThan(1.5);
      expect(metrics.sharpeRatio).toBeGreaterThan(0);
      expect(metrics.sortinoRatio).toBeGreaterThan(metrics.sharpeRatio);
      expect(metrics.maxDrawdownPercent).toBeGreaterThan(0);
      expect(metrics.maxDrawdownPercent).toBeLessThan(30);

      expect(metrics.netReturnPercent).toBeLessThan(metrics.totalReturnPercent);
    });

    it('handles zero trades gracefully with zero metrics', () => {
      const metrics = calculateStrategyMetrics([]);
      expect(metrics.tradeCount).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.maxDrawdownPercent).toBe(0);
    });
  });

  describe('2. Bias & Red Flag Detection (validateBacktestReport)', () => {
    it('flags SAMPLE_SIZE_TOO_SMALL when trades < 50', () => {
      const trades = generateSyntheticTrades(20, 65, 8, 4);
      const report = validateBacktestReport(trades);

      expect(report.flags.some((f) => f.type === 'SAMPLE_SIZE_TOO_SMALL')).toBe(true);
      expect(report.verdict).toBe('REVISE');
    });

    it('flags LOOK_AHEAD_BIAS when Sharpe Ratio is suspiciously high (> 4.5)', () => {

      const perfectTrades = generateSyntheticTrades(100, 98, 12, 1);
      const report = validateBacktestReport(perfectTrades);

      expect(report.metrics.sharpeRatio).toBeGreaterThan(4.5);
      expect(report.flags.some((f) => f.type === 'LOOK_AHEAD_BIAS')).toBe(true);
      expect(report.verdict).toBe('REJECT');
    });

    it('flags OVERFITTING when Profit Factor is excessively high (> 3.5)', () => {

      const overfittedTrades = generateSyntheticTrades(80, 85, 20, 2);
      const report = validateBacktestReport(overfittedTrades);

      expect(report.metrics.profitFactor).toBeGreaterThan(3.5);
      expect(report.flags.some((f) => f.type === 'OVERFITTING')).toBe(true);
    });

    it('flags EXCESSIVE_DRAWDOWN when Max Drawdown exceeds 25%', () => {

      const lossTrades = generateSyntheticTrades(100, 30, 10, 15);
      const report = validateBacktestReport(lossTrades);

      expect(report.metrics.maxDrawdownPercent).toBeGreaterThan(25);
      expect(report.flags.some((f) => f.type === 'EXCESSIVE_DRAWDOWN')).toBe(true);
      expect(report.verdict).toBe('REJECT');
    });

    it('accepts a high-quality, statistically grounded strategy', () => {

      const solidTrades = generateSyntheticTrades(150, 58, 8, 4);
      const report = validateBacktestReport(solidTrades);

      expect(report.metrics.sharpeRatio).toBeGreaterThan(1.2);
      expect(report.metrics.sharpeRatio).toBeLessThan(4.5);
      expect(report.metrics.profitFactor).toBeGreaterThan(1.3);
      expect(report.metrics.profitFactor).toBeLessThan(3.5);
      expect(report.metrics.maxDrawdownPercent).toBeLessThan(25);
      expect(report.verdict).toBe('ACCEPT');
    });
  });

  describe('3. Walk-Forward Validation (runWalkForwardValidation)', () => {
    it('passes walk-forward validation when out-of-sample degradation is <= 40%', () => {

      const stableTrades = generateSyntheticTrades(200, 60, 8, 4);
      const wf = runWalkForwardValidation(stableTrades, 0.7);

      expect(wf.isPassed).toBe(true);
      expect(wf.sharpeDegradationPercent).toBeLessThanOrEqual(40);
      expect(wf.outOfSampleMetrics.tradeCount).toBe(60);
    });

    it('rejects strategy when out-of-sample Sharpe drops by > 40% (curve-fitting degradation)', () => {

      const inSample = generateSyntheticTrades(140, 75, 10, 3);
      const outOfSample = generateSyntheticTrades(60, 35, 5, 8).map((t, idx) => ({
        ...t,
        id: `oos_${idx}`,
        timestamp: 1700000000000 + (140 + idx) * 3600000,
      }));

      const combinedTrades = [...inSample, ...outOfSample];
      const wf = runWalkForwardValidation(combinedTrades, 0.7);

      expect(wf.isPassed).toBe(false);
      expect(wf.sharpeDegradationPercent).toBeGreaterThan(40);
      expect(wf.rejectionReason).toMatch(/degradation/i);
    });
  });
});
