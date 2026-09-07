import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { SwarmDetector, type IngestSwapEvent } from '../../src/engine/swarmDetector.js';
import { SmartWalletRegistry } from '../../src/engine/smartWalletRegistry.js';

describe('SwarmDetector - Real on-chain smart wallet cluster detection', () => {
  let redis: any;
  let registry: SmartWalletRegistry;
  let detector: SwarmDetector;

  const smart1 = '0x1111111111111111111111111111111111111111';
  const smart2 = '0x2222222222222222222222222222222222222222';
  const smart3 = '0x3333333333333333333333333333333333333333';
  const smart4 = '0x4444444444444444444444444444444444444444';
  const normalWallet = '0x9999999999999999999999999999999999999999';
  const token = '0xabcdef0123456789abcdef0123456789abcdef01';

  beforeEach(() => {
    redis = new (RedisMock as any)();
    registry = new SmartWalletRegistry(false);
    registry.registerWallet({
      address: smart1,
      chain: 'EVM',
      label: 'Whale Alpha 1',
      tag: 'ALPHA_SNIPER',
      winRate30d: 80,
      totalPnlUsd: 100000,
    });
    registry.registerWallet({
      address: smart2,
      chain: 'EVM',
      label: 'Whale Alpha 2',
      tag: 'WHALE',
      winRate30d: 75,
      totalPnlUsd: 120000,
    });
    registry.registerWallet({
      address: smart3,
      chain: 'EVM',
      label: 'Insider 1',
      tag: 'INSIDER',
      winRate30d: 88,
      totalPnlUsd: 250000,
    });
    registry.registerWallet({
      address: smart4,
      chain: 'EVM',
      label: 'KOL 1',
      tag: 'KOL',
      winRate30d: 70,
      totalPnlUsd: 90000,
    });

    detector = new SwarmDetector(redis, registry);
  });

  it('ignores swaps from non-registered smart wallets', async () => {
    const event: IngestSwapEvent = {
      walletAddress: normalWallet,
      chain: 'BASE',
      tokenAddress: token,
      tokenSymbol: 'HONEY',
      amountUsd: 500,
      txHash: '0xtx1',
      timestamp: Date.now(),
    };

    const signal = await detector.processSwapEvent(event);
    expect(signal).toBeNull();
  });

  it('triggers BUY_SIGNAL on 3rd distinct smart wallet accumulation', async () => {
    const baseTime = Date.now();

    // 1st Smart Wallet buy
    const sig1 = await detector.processSwapEvent({
      walletAddress: smart1,
      chain: 'BASE',
      tokenAddress: token,
      tokenSymbol: 'HONEY',
      amountUsd: 1000,
      txHash: '0xtx1',
      timestamp: baseTime,
      marketCap: 50000,
      liquidityUsd: 20000,
    });
    expect(sig1).toBeNull();

    // 2nd Smart Wallet buy
    const sig2 = await detector.processSwapEvent({
      walletAddress: smart2,
      chain: 'BASE',
      tokenAddress: token,
      tokenSymbol: 'HONEY',
      amountUsd: 1500,
      txHash: '0xtx2',
      timestamp: baseTime + 10000,
      marketCap: 55000,
      liquidityUsd: 22000,
    });
    expect(sig2).toBeNull();

    // 3rd Smart Wallet buy -> Triggers Cluster BUY_SIGNAL!
    const sig3 = await detector.processSwapEvent({
      walletAddress: smart3,
      chain: 'BASE',
      tokenAddress: token,
      tokenSymbol: 'HONEY',
      amountUsd: 2000,
      txHash: '0xtx3',
      timestamp: baseTime + 25000,
      marketCap: 60000,
      liquidityUsd: 25000,
    });

    expect(sig3).not.toBeNull();
    expect(sig3?.smartWalletsCount).toBe(3);
    expect(sig3?.smartWalletsInferred).toBe(false);
    expect(sig3?.pileInTime).toBe('<1m pile-in');
    expect(sig3?.tokenSymbol).toBe('HONEY');
    expect(sig3?.reasons.some((r) => r.code === 'SWARM_CLUSTER')).toBe(true);
    expect(sig3?.topWallets).toHaveLength(1);
    expect(sig3?.topWallets?.[0].label).toContain('Insider 1');
    expect(sig3?.topWallets?.[0].winRate).toBe(88);

    // 4th Smart Wallet buy -> Triggers BUY_UPDATE
    const sig4 = await detector.processSwapEvent({
      walletAddress: smart4,
      chain: 'BASE',
      tokenAddress: token,
      tokenSymbol: 'HONEY',
      amountUsd: 2500,
      txHash: '0xtx4',
      timestamp: baseTime + 40000,
      marketCap: 70000,
      liquidityUsd: 30000,
    });

    expect(sig4).not.toBeNull();
    expect(sig4?.smartWalletsCount).toBe(4);
    expect(sig4?.reasons.some((r) => r.code === 'SWARM_CLUSTER_EXPANSION')).toBe(true);
  });
});
