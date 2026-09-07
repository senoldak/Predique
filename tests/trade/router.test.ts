import { describe, it, expect } from 'vitest';
import { getRouterForChain, buildQuickBuyPayload, calculatePriceImpact } from '../../src/trade/router.js';

describe('Swap Router Dispatcher', () => {
  it('returns pump.fun direct router for solana pump tokens', () => {
    const router = getRouterForChain('solana', 'HpWnGa2UtSTmy5VU87XGm8yPKZc93P7F927LwjQ5pump');
    expect(router.type).toBe('SOLANA_PUMPFUN');
  });

  it('returns jupiter router for standard solana tokens', () => {
    const router = getRouterForChain('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(router.type).toBe('SOLANA_JUPITER');
  });

  it('returns uniswap router for base and ethereum tokens', () => {
    const router = getRouterForChain('base', '0xabf4f0999be267d8eaae658fb1f426f5a8568771');
    expect(router.type).toBe('EVM_UNISWAP');
  });

  it('returns pancake router for bnb chain tokens', () => {
    const router = getRouterForChain('bnb', '0x447a8be41c91d9437a1b0ea86bab3fafa3ce7777');
    expect(router.type).toBe('EVM_PANCAKE');
  });

  it('returns pons router for robinhood chain tokens', () => {
    const router = getRouterForChain('robinhood', '0x6c002de352a8e12d6fa5267041fd139f389b2501');
    expect(router.type).toBe('EVM_PONS');
  });

  it('builds valid quick-buy execution payload', () => {
    const payload = buildQuickBuyPayload({
      userTelegramId: 123456789,
      chain: 'base',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      amountInNative: 0.01,
      slippageBps: 500,
      enableMoonbag: true
    });

    expect(payload.router.type).toBe('EVM_UNISWAP');
    expect(payload.amountInNative).toBe(0.01);
    expect(payload.enableMoonbag).toBe(true);
  });

  it('rejects invalid address format', () => {
    expect(() => buildQuickBuyPayload({
      userTelegramId: 123,
      chain: 'base',
      tokenAddress: '0xInvalidAddress',
      amountInNative: 0.01,
      slippageBps: 500,
      enableMoonbag: false
    })).toThrow(/Invalid base token address/);
  });

  it('rejects invalid trade amounts', () => {
    expect(() => buildQuickBuyPayload({
      userTelegramId: 123,
      chain: 'base',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      amountInNative: -0.05,
      slippageBps: 500,
      enableMoonbag: false
    })).toThrow(/Invalid trade amount/);
  });

  it('rejects dangerous slippage values', () => {
    expect(() => buildQuickBuyPayload({
      userTelegramId: 123,
      chain: 'base',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      amountInNative: 0.01,
      slippageBps: 8000, // 80% slippage is dangerous
      enableMoonbag: false
    })).toThrow(/Invalid slippage/);
  });

  describe('PriceImpactGuard & Dynamic Slippage Engine', () => {
    it('calculates safe price impact for normal retail orders in deep liquidity', () => {
      const res = calculatePriceImpact({
        amountInNative: 0.1,
        chain: 'base',
        poolLiquidityUsd: 100000,
      });

      // 0.1 ETH @ 3200 = $320. In $100k pool -> 0.32% impact
      expect(res.estimatedImpactPercent).toBeCloseTo(0.32, 1);
      expect(res.severity).toBe('SAFE');
      expect(res.warning).toBeUndefined();
      expect(res.recommendedSlippageBps).toBeGreaterThanOrEqual(100);
    });

    it('flags high and critical price impact when trade order drains shallow pool', () => {
      const res = calculatePriceImpact({
        amountInNative: 2.0, // 2 ETH = $6400
        chain: 'base',
        poolLiquidityUsd: 20000, // $20k pool -> 32% impact!
      });

      expect(res.estimatedImpactPercent).toBe(32);
      expect(res.severity).toBe('CRITICAL');
      expect(res.warning).toContain('CRITICAL PRICE IMPACT');
      expect(res.recommendedSlippageBps).toBe(4800);
    });

    it('rejects orders in buildQuickBuyPayload if price impact exceeds maximum allowed limit', () => {
      expect(() => buildQuickBuyPayload({
        userTelegramId: 123,
        chain: 'base',
        tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
        amountInNative: 5.0, // 5 ETH = $16,000
        slippageBps: 500,
        enableMoonbag: false,
        poolLiquidityUsd: 10000, // 160% impact
        maxAllowedPriceImpactPercent: 15.0,
      })).toThrow(/Trade rejected by PriceImpactGuard/);
    });

    it('attaches price impact assessment to quick buy payload', () => {
      const payload = buildQuickBuyPayload({
        userTelegramId: 123,
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amountInNative: 0.5, // 0.5 SOL @ 180 = $90
        slippageBps: 200,
        enableMoonbag: false,
        poolLiquidityUsd: 50000,
      });

      expect(payload.impact).toBeDefined();
      expect(payload.impact.severity).toBe('SAFE');
      expect(payload.impact.tradeValueUsd).toBe(90);
    });
  });
});
