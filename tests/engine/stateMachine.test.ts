import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { recordWalletBuy, recordWalletSell, formatPileIn, getTokenState } from '../../src/engine/stateMachine.js';

describe('Redis Swarm State Machine', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new (RedisMock as unknown as typeof Redis)();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  it('formats pile-in strings accurately', () => {
    expect(formatPileIn(45000)).toBe('<1m pile-in');
    expect(formatPileIn(120000)).toBe('2m pile-in');
    expect(formatPileIn(3600000)).toBe('1h pile-in');
    expect(formatPileIn(172800000)).toBe('2d pile-in');
  });

  it('triggers BUY_SIGNAL upon 3rd unique smart wallet buy', async () => {
    const tokenKey = 'base:0x123';
    const res1 = await recordWalletBuy(redis, tokenKey, '0xwallet1', 0.1, 1000);
    expect(res1.shouldTriggerBuy).toBe(false);

    const res2 = await recordWalletBuy(redis, tokenKey, '0xwallet2', 0.2, 2000);
    expect(res2.shouldTriggerBuy).toBe(false);

    const res3 = await recordWalletBuy(redis, tokenKey, '0xwallet3', 0.3, 3000);
    expect(res3.shouldTriggerBuy).toBe(true);
    expect(res3.walletCount).toBe(3);
    expect(res3.pileInText).toBe('<1m pile-in');
  });

  it('triggers BUY_UPDATE on 4th or later wallet buy', async () => {
    const tokenKey = 'base:0x456';
    await recordWalletBuy(redis, tokenKey, '0xwallet1', 0.1, 1000);
    await recordWalletBuy(redis, tokenKey, '0xwallet2', 0.1, 2000);
    await recordWalletBuy(redis, tokenKey, '0xwallet3', 0.1, 3000);

    const res4 = await recordWalletBuy(redis, tokenKey, '0xwallet4', 0.5, 4000);
    expect(res4.shouldTriggerBuy).toBe(false);
    expect(res4.shouldTriggerUpdate).toBe(true);
    expect(res4.walletCount).toBe(4);
  });

  it('marks early selling when a buyer wallet sells', async () => {
    const tokenKey = 'base:0x123';
    await recordWalletBuy(redis, tokenKey, '0xwallet1', 0.1, 1000);
    await recordWalletSell(redis, tokenKey, '0xwallet1');

    const state = await getTokenState(redis, tokenKey);
    expect(state.earlySelling).toBe(true);
  });

  it('ignores sell events from wallets that never bought', async () => {
    const tokenKey = 'base:0x999';
    await recordWalletBuy(redis, tokenKey, '0xwallet1', 0.1, 1000);
    await recordWalletSell(redis, tokenKey, '0xrandomTrader');

    const state = await getTokenState(redis, tokenKey);
    expect(state.earlySelling).toBe(false);
  });
});
