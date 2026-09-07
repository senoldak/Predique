import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { recordWalletBuy } from '../../src/engine/stateMachine.js';
import { calculateSignalTier } from '../../src/engine/scoring.js';
import { formatSignalMessage } from '../../src/bot/formatters.js';
import { buildQuickBuyPayload } from '../../src/trade/router.js';

describe('Predique End-to-End Pipeline', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new (RedisMock as unknown as typeof Redis)();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  it('executes complete alpha cycle from cluster buy to formatted alert and quick-buy payload', async () => {
    const token = '0x6c002de352a8e12d6fa5267041fd139f389b2501';
    const chain = 'base';
    const tokenKey = `${chain}:${token}`;

    const buy1 = await recordWalletBuy(redis, tokenKey, '0xwalletA', 0.1, 1000);
    expect(buy1.shouldTriggerBuy).toBe(false);

    const buy2 = await recordWalletBuy(redis, tokenKey, '0xwalletB', 0.15, 5000);
    expect(buy2.shouldTriggerBuy).toBe(false);

    const buy3 = await recordWalletBuy(redis, tokenKey, '0xwalletC', 0.15, 8000);
    expect(buy3.shouldTriggerBuy).toBe(true);
    expect(buy3.walletCount).toBe(3);
    expect(buy3.totalVolume).toBe(0.4);
    expect(buy3.pileInText).toBe('<1m pile-in');

    const score = calculateSignalTier({
      ageMinutes: 85, // 1h 25m
      liqMcRatio: 30.0,
      smartWalletsCount: buy3.walletCount,
      earlySelling: false,
      hasHoneypot: false
    });

    expect(score.tier).toBe('PLATINUM');
    expect(score.stars).toBe('★★★');
    expect(score.tag).toBe('🔒 no early exit');

    const message = formatSignalMessage({
      chain: 'Base',
      chainTag: '#Base',
      tokenSymbol: 'ALPHA',
      contractAddress: token,
      mcapUsd: 50000,
      liquidityUsd: 15000,
      liqMcRatio: 30.0,
      ageText: '1h 25m',
      tierStars: score.stars,
      smartWalletsCount: buy3.walletCount,
      totalSpent: buy3.totalVolume,
      currency: 'ETH',
      topWallets: [
        { label: 'Bee #1 (Sniper Alpha)', winRate: 88, volume: 0.1 },
        { label: 'Bee #2 (Top Meme Hunter)', winRate: 82, volume: 0.15 },
        { label: 'Bee #3 (Early Whale)', winRate: 79, volume: 0.15 }
      ],
      buys5m: 3, sells5m: 0,
      pileInText: buy3.pileInText,
      earlySelling: false
    });

    expect(message.text).toContain('PREDIQUE');
    expect(message.text).toContain('ALPHA');
    expect(message.inlineKeyboard).toHaveLength(2);

    const quickBuy = buildQuickBuyPayload({
      userTelegramId: 987654321,
      chain: 'base',
      tokenAddress: token,
      amountInNative: 0.01,
      slippageBps: 500,
      enableMoonbag: true
    });

    expect(quickBuy.router.type).toBe('EVM_UNISWAP');
    expect(quickBuy.amountInNative).toBe(0.01);
    expect(quickBuy.enableMoonbag).toBe(true);
  });
});
