import { describe, it, expect } from 'vitest';
import {
  evaluateSignalForStrategy,
  calculateKellyTradeSize,
  calculateDrawdownModulation,
} from '../../src/engine/strategyEvaluator.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';
import type { AutoTradeConfig } from '../../src/types/autotrade.js';

describe('StrategyEvaluator', () => {
  const baseConfig: AutoTradeConfig = {
    enabled: true,
    mode: 'PAPER',
    strategy: 'SWARM_MOMENTUM',
    maxTradeAmountNative: 0.1,
    maxOpenPositions: 3,
    slippagePercent: 5,
    takeProfitPercent: 35,
    stopLossPercent: 12,
    trailingStopPercent: 10,
    dailyMaxDrawdownPercent: 5,
    minLiquidityUsd: 15000,
  };

  const mockSwarmSignal: PublicTokenSignal = {
    id: 'test_swarm_1',
    tokenAddress: '0x1111111111111111111111111111111111111111',
    tokenSymbol: 'SWARM',
    chain: 'BASE',
    mcap: 100000,
    liquidity: 30000,
    liqRatio: 30,
    rating: 'ROYAL_HONEY',
    earlySelling: false,
    pileInTime: '15 buys/5m',
    ageMinutes: 75,
    smartWalletsCount: 5,
    timestamp: Date.now(),
    reasons: [],
  };

  const mockMeanRevSignal: PublicTokenSignal = {
    id: 'test_meanrev_1',
    tokenAddress: '0x2222222222222222222222222222222222222222',
    tokenSymbol: 'DIP',
    chain: 'SOLANA',
    mcap: 500000,
    liquidity: 120000,
    liqRatio: 24,
    rating: 'SWARM_INBOUND',
    earlySelling: false,
    pileInTime: '8 buys/5m',
    ageMinutes: 180,
    smartWalletsCount: 7,
    priceChange24h: -18,
    volume24h: 85000,
    timestamp: Date.now(),
    reasons: [],
  };

  const mockSniperSignal: PublicTokenSignal = {
    id: 'test_sniper_1',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    tokenSymbol: 'SNIPER',
    chain: 'SOLANA',
    mcap: 50000,
    liquidity: 20000,
    liqRatio: 40,
    rating: 'SWARM_INBOUND',
    earlySelling: false,
    pileInTime: '10 buys/5m',
    ageMinutes: 18,
    smartWalletsCount: 4,
    buys5m: 10,
    timestamp: Date.now(),
    reasons: [],
  };

  describe('SWARM_MOMENTUM Strategy', () => {
    it('approves entry when OFI, rating, and liquidity conditions are met', () => {
      const result = evaluateSignalForStrategy(mockSwarmSignal, 'SWARM_MOMENTUM', baseConfig);
      expect(result.shouldEnter).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reason).toContain('Swarm Alpha Momentum');
    });

    it('rejects entry if earlySelling is detected', () => {
      const result = evaluateSignalForStrategy(
        { ...mockSwarmSignal, earlySelling: true },
        'SWARM_MOMENTUM',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
      expect(result.reason).toContain('Early selling');
    });

    it('rejects entry if liquidity is below minLiquidityUsd', () => {
      const result = evaluateSignalForStrategy(
        { ...mockSwarmSignal, liquidity: 8000 },
        'SWARM_MOMENTUM',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
      expect(result.reason).toContain('Liquidity');
    });

    it('rejects entry if rating is neutral or honeypot', () => {
      const result = evaluateSignalForStrategy(
        { ...mockSwarmSignal, rating: 'NEUTRAL' },
        'SWARM_MOMENTUM',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
    });
  });

  describe('MEAN_REVERSION Strategy', () => {
    it('approves entry when pool is mature, liquid, and in dip recovery', () => {
      const result = evaluateSignalForStrategy(mockMeanRevSignal, 'MEAN_REVERSION', baseConfig);
      expect(result.shouldEnter).toBe(true);
      expect(result.reason).toContain('Mean-Reversion');
    });

    it('rejects young pools (< 60m)', () => {
      const result = evaluateSignalForStrategy(
        { ...mockMeanRevSignal, ageMinutes: 25 },
        'MEAN_REVERSION',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
    });
  });

  describe('BREAKOUT_SURGE Strategy', () => {
    const mockBreakoutSignal: PublicTokenSignal = {
      id: 'test_breakout_1',
      tokenAddress: '0x3333333333333333333333333333333333333333',
      tokenSymbol: 'SURGE',
      chain: 'BASE',
      mcap: 80000,
      liquidity: 25000,
      liqRatio: 31,
      rating: 'SWARM_INBOUND',
      earlySelling: false,
      pileInTime: '20 buys/5m',
      ageMinutes: 30,
      smartWalletsCount: 4,
      buys5m: 16,
      sells5m: 3,
      priceChange24h: 15,
      volume24h: 35000,
      timestamp: Date.now(),
      reasons: [],
    };

    it('approves entry on strong 5m buy volume surge and price momentum', () => {
      const result = evaluateSignalForStrategy(mockBreakoutSignal, 'BREAKOUT_SURGE', baseConfig);
      expect(result.shouldEnter).toBe(true);
      expect(result.reason).toContain('Breakout Surge');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('rejects breakout when early selling dump is detected', () => {
      const result = evaluateSignalForStrategy(
        { ...mockBreakoutSignal, earlySelling: true },
        'BREAKOUT_SURGE',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
      expect(result.reason).toContain('Early dump detected');
    });

    it('rejects when buy surge is weak and no price breakout occurred', () => {
      const result = evaluateSignalForStrategy(
        { ...mockBreakoutSignal, buys5m: 4, sells5m: 5, priceChange24h: 2 },
        'BREAKOUT_SURGE',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
    });
  });

  describe('SNIPER_ALPHA Strategy', () => {
    it('approves entry on fresh pool (< 45m) with early accumulation', () => {
      const result = evaluateSignalForStrategy(mockSniperSignal, 'SNIPER_ALPHA', baseConfig);
      expect(result.shouldEnter).toBe(true);
      expect(result.reason).toContain('Sniper Alpha');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('rejects sniper setup if pool age exceeds 45m', () => {
      const result = evaluateSignalForStrategy(
        { ...mockSniperSignal, ageMinutes: 50 },
        'SNIPER_ALPHA',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
      expect(result.reason).toContain('exceeds fresh sniper limit');
    });

    it('rejects fresh pool with toxic early sellers', () => {
      const result = evaluateSignalForStrategy(
        { ...mockSniperSignal, earlySelling: true },
        'SNIPER_ALPHA',
        baseConfig
      );
      expect(result.shouldEnter).toBe(false);
      expect(result.reason).toContain('Toxic early seller dump');
    });
  });

  describe('ENSEMBLE Strategy', () => {
    it('accepts signals matching Swarm Momentum, Mean Reversion, or Sniper Alpha', () => {
      const r1 = evaluateSignalForStrategy(mockSwarmSignal, 'ENSEMBLE', baseConfig);
      expect(r1.shouldEnter).toBe(true);
      const r2 = evaluateSignalForStrategy(mockMeanRevSignal, 'ENSEMBLE', baseConfig);
      expect(r2.shouldEnter).toBe(true);
      // Make a pure sniper setup that doesn't trigger Swarm Momentum (e.g. liqRatio > 75%)
      const pureSniperSignal = { ...mockSniperSignal, liqRatio: 80 };
      const r3 = evaluateSignalForStrategy(pureSniperSignal, 'ENSEMBLE', baseConfig);
      expect(r3.shouldEnter).toBe(true);
      expect(r3.reason).toContain('Sniper Alpha');
    });
  });

  describe('Fractional Kelly Criterion Calculation', () => {
    it('calculates Quarter-Kelly position size accurately', () => {

      const size = calculateKellyTradeSize(1.0, 0.6, 2.0, 0.2);
      expect(size).toBeCloseTo(0.1, 2);
    });

    it('caps size at maxTradeAmountNative', () => {
      const size = calculateKellyTradeSize(10.0, 0.8, 3.0, 0.1);
      expect(size).toBe(0.1);
    });

    it('floors to zero if Kelly expected value is negative', () => {

      const size = calculateKellyTradeSize(1.0, 0.2, 1.0, 0.1);
      expect(size).toBe(0);
    });
  });

  describe('Drawdown Modulation Lemma', () => {
    it('scales linearly between zero and one based on current vs max drawdown', () => {
      expect(calculateDrawdownModulation(0.0, 0.05)).toBe(1.0);
      expect(calculateDrawdownModulation(0.025, 0.05)).toBeCloseTo(0.5, 2);
      expect(calculateDrawdownModulation(0.05, 0.05)).toBe(0.0);
    });

    it('returns zero if current drawdown exceeds max allowed', () => {
      expect(calculateDrawdownModulation(0.06, 0.05)).toBe(0.0);
    });
  });
});
