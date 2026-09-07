import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { WalletService } from '../../src/services/wallet.service.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';

describe('AutoTradeService', () => {
  let walletService: WalletService;
  let tradeService: TradeService;
  let autoTradeService: AutoTradeService;

  beforeEach(async () => {
    walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    tradeService = new TradeService(walletService);
    autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 500);
  });

  afterEach(() => {
    autoTradeService.destroy();
  });

  it('initializes with default config and disabled state', () => {
    const config = autoTradeService.getConfig();
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('PAPER');
    expect(config.takeProfitPercent).toBe(35);
    expect(config.stopLossPercent).toBe(12);
    expect(config.strategy).toBe('SWARM_MOMENTUM');
  });

  it('toggles on and off and updates config correctly', () => {
    expect(autoTradeService.toggle(true)).toBe(true);
    expect(autoTradeService.getConfig().enabled).toBe(true);

    const updated = autoTradeService.updateConfig({
      mode: 'LIVE',
      maxTradeAmountNative: 0.25,
      strategy: 'ENSEMBLE',
    });
    expect(updated.mode).toBe('LIVE');
    expect(updated.maxTradeAmountNative).toBe(0.25);
    expect(updated.strategy).toBe('ENSEMBLE');

    expect(autoTradeService.toggle(false)).toBe(false);
    expect(autoTradeService.getConfig().enabled).toBe(false);
  });

  it('processes incoming valid signal and opens auto-position in paper mode', async () => {
    autoTradeService.toggle(true);
    const mockSignal: PublicTokenSignal = {
      id: 'sig_test_1',
      tokenAddress: '0x1234567890123456789012345678901234567890',
      tokenSymbol: 'SWARM',
      chain: 'BASE',
      mcap: 150000,
      liquidity: 45000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '20 buys/5m',
      ageMinutes: 80,
      smartWalletsCount: 6,
      priceUsd: 1.0,
      timestamp: Date.now(),
      reasons: [],
    };

    const opened = await autoTradeService.processSignal(mockSignal);
    expect(opened).toBe(true);

    const positions = autoTradeService.getAutoPositions();
    expect(positions.length).toBe(1);
    expect(positions[0].tokenSymbol).toBe('SWARM');
    expect(positions[0].strategy).toBe('SWARM_MOMENTUM');
    expect(positions[0].highestPriceUsd).toBe(1.0);
    expect(positions[0].tp1Hit).toBe(false);
  });

  it('prevents duplicate trade on the same token (idempotency guard)', async () => {
    autoTradeService.toggle(true);
    const mockSignal: PublicTokenSignal = {
      id: 'sig_test_2',
      tokenAddress: '0x9999999999999999999999999999999999999999',
      tokenSymbol: 'DOUBLE',
      chain: 'BASE',
      mcap: 200000,
      liquidity: 60000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '10 buys/5m',
      ageMinutes: 90,
      smartWalletsCount: 5,
      priceUsd: 2.0,
      timestamp: Date.now(),
      reasons: [],
    };

    const first = await autoTradeService.processSignal(mockSignal);
    expect(first).toBe(true);

    const second = await autoTradeService.processSignal(mockSignal);
    expect(second).toBe(false);
    expect(autoTradeService.getAutoPositions().length).toBe(1);
  });

  it('executes TP1 (+35%) by selling 50% and moving stop to breakeven', async () => {
    autoTradeService.toggle(true);
    const tokenAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mockSignal: PublicTokenSignal = {
      id: 'sig_tp1',
      tokenAddress,
      tokenSymbol: 'MOON',
      chain: 'BASE',
      mcap: 100000,
      liquidity: 30000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '12 buys/5m',
      ageMinutes: 70,
      smartWalletsCount: 4,
      priceUsd: 1.0,
      timestamp: Date.now(),
      reasons: [],
    };

    await autoTradeService.processSignal(mockSignal);
    const initialPos = autoTradeService.getAutoPositions()[0];
    const initialAmount = initialPos.amountIn;

    const priceMap = new Map<string, number>();
    priceMap.set(tokenAddress.toLowerCase(), 1.4);

    await autoTradeService.evaluateActivePositions(priceMap);

    const updatedPos = autoTradeService.getAutoPositions()[0];
    expect(updatedPos.tp1Hit).toBe(true);
    expect(updatedPos.stopLossPriceUsd).toBe(1.0);
    expect(updatedPos.highestPriceUsd).toBe(1.4);
    expect(updatedPos.amountIn).toBeCloseTo(initialAmount / 2, 2);
  });

  it('executes Trailing Stop exit when price drops 10% from peak after TP1', async () => {
    autoTradeService.toggle(true);
    const tokenAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mockSignal: PublicTokenSignal = {
      id: 'sig_trail',
      tokenAddress,
      tokenSymbol: 'TRAIL',
      chain: 'BASE',
      mcap: 100000,
      liquidity: 30000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '12 buys/5m',
      ageMinutes: 70,
      smartWalletsCount: 4,
      priceUsd: 1.0,
      timestamp: Date.now(),
      reasons: [],
    };

    await autoTradeService.processSignal(mockSignal);

    const pricePump = new Map<string, number>();
    pricePump.set(tokenAddress.toLowerCase(), 1.5);
    await autoTradeService.evaluateActivePositions(pricePump);

    expect(autoTradeService.getAutoPositions()[0].tp1Hit).toBe(true);

    const priceDrop = new Map<string, number>();
    priceDrop.set(tokenAddress.toLowerCase(), 1.3);
    await autoTradeService.evaluateActivePositions(priceDrop);

    expect(autoTradeService.getAutoPositions().length).toBe(0);

    const history = autoTradeService.getTradeHistory();
    expect(history.length).toBeGreaterThan(0);
    const exitRecord = history.find((h) => h.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
    expect(exitRecord).toBeDefined();
    expect(exitRecord?.exitReason).toBe('TRAILING_STOP');

    expect(exitRecord?.amountIn).toBeGreaterThan(0);
    expect(exitRecord?.pnlNative).toBeCloseTo(exitRecord!.amountIn * 0.4, 2);
  });

  it('caps Kelly sizing during cold start (<20 trades)', async () => {
    autoTradeService.toggle(true);
    const tokenAddress = '0xdddddddddddddddddddddddddddddddddddddddd';
    const mockSignal: PublicTokenSignal = {
      id: 'sig_cold',
      tokenAddress,
      tokenSymbol: 'COLD',
      chain: 'BASE',
      mcap: 100000,
      liquidity: 30000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '12 buys/5m',
      ageMinutes: 70,
      smartWalletsCount: 4,
      priceUsd: 1.0,
      timestamp: Date.now(),
      reasons: [],
    };

    await autoTradeService.processSignal(mockSignal);
    const pos = autoTradeService.getAutoPositions().find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
    expect(pos).toBeDefined();
    expect(pos!.amountIn).toBeLessThanOrEqual(0.025 + 1e-9);
  });

  it('triggers circuit breaker when daily drawdown reaches 5%', async () => {
    autoTradeService.toggle(true);
    autoTradeService.updateConfig({ dailyMaxDrawdownPercent: 5 });

    autoTradeService.recordSimulatedPnl(-0.06, 1.0);

    expect(autoTradeService.getStats().circuitBreakerActive).toBe(true);

    const mockSignal: PublicTokenSignal = {
      id: 'sig_cb',
      tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      tokenSymbol: 'LOCKED',
      chain: 'BASE',
      mcap: 100000,
      liquidity: 30000,
      liqRatio: 30,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '10 buys/5m',
      ageMinutes: 80,
      smartWalletsCount: 4,
      priceUsd: 1.0,
      timestamp: Date.now(),
      reasons: [],
    };

    const entered = await autoTradeService.processSignal(mockSignal);
    expect(entered).toBe(false);
  });
});
