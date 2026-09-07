import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveMarketFeedService } from '../../src/services/marketFeed.service.js';
import { clearTokenSecurityCache } from '../../src/security/tokenSecurity.service.js';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function pair(address: string, buys: number, sells: number) {
  return {
    chainId: 'base',
    baseToken: { address, symbol: 'TKN' },
    marketCap: 100000,
    liquidity: { usd: 30000 },
    pairCreatedAt: Date.now() - 70 * 60 * 1000,
    txns: { m5: { buys, sells } },
    volume: { h24: 50000 },
    priceUsd: '1.5',
    priceChange: { h24: 5 },
  };
}

describe('LiveMarketFeedService', () => {
  beforeEach(() => {
    clearTokenSecurityCache();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('token-profiles')) {
        return {
          ok: true,
          json: async () => [
            { chainId: 'base', tokenAddress: ADDR_A },
            { chainId: 'base', tokenAddress: ADDR_B },
          ],
        } as unknown as Response;
      }
      if (String(url).includes('api.gopluslabs.io')) {
        return { ok: true, json: async () => ({ code: 1, message: 'OK', result: {} }) } as unknown as Response;
      }
      if (String(url).includes('api.rugcheck.xyz')) {
        return { ok: true, json: async () => ({ risks: [], score: 0 }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ pairs: [pair(ADDR_A, 12, 2), pair(ADDR_B, 0, 0)] }),
      } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels organic flow as non-sponsored with inferred cluster counts', async () => {
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();

    expect(signals).toHaveLength(1);
    const sig = signals[0];
    expect(sig.tokenAddress).toBe(ADDR_A);
    expect(sig.sponsored).toBe(false);
    expect(sig.reasons.map((r) => r.code)).not.toContain('SPONSORED_FEED');
    expect(sig.smartWalletsInferred).toBe(true);
    expect(sig.buys5m).toBe(12);
    expect(sig.smartWalletsCount).toBe(6);
  });

  it('keeps trade drivers first and disclaimers last in reasons', async () => {
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();
    const codes = signals[0].reasons.map((r) => r.code);
    expect(codes[0]).toBe('BUY_CLUSTER');
    expect(codes.slice(-1)).toEqual(['HONEYPOT_UNKNOWN']);
  });

  it('uses organic profiles source with sponsored=false and no SPONSORED_FEED', async () => {
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();
    expect(signals).toHaveLength(1);
    expect(signals[0].sponsored).toBe(false);
    const codes = signals[0].reasons.map((r) => r.code);
    expect(codes).not.toContain('SPONSORED_FEED');
    expect(codes.slice(-1)).toEqual(['HONEYPOT_UNKNOWN']);
  });

  it('skips thin clusters with fewer than 5 buys', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'base', tokenAddress: ADDR_A }] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ pairs: [pair(ADDR_A, 3, 1)] }) } as unknown as Response;
    });
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();
    expect(signals).toHaveLength(0);
  });

  it('returns cached signals when upstream is empty', async () => {
    const feed = new LiveMarketFeedService(60000);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'base', tokenAddress: ADDR_A }] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ pairs: [pair(ADDR_A, 12, 2)] }) } as unknown as Response;
    });
    const first = await feed.fetchLiveMarketData();
    expect(first).toHaveLength(1);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async () => {
      return { ok: true, json: async () => [] } as unknown as Response;
    });
    const second = await feed.fetchLiveMarketData();
    expect(second).toHaveLength(1);
    expect(second[0].tokenAddress).toBe(ADDR_A);
  });

  it('filters honeypot tokens before dispatch', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'base', tokenAddress: ADDR_A }] } as unknown as Response;
      }
      if (String(url).includes('api.gopluslabs.io')) {
        return {
          ok: true,
          json: async () => ({ code: 1, message: 'OK', result: { [ADDR_A.toLowerCase()]: { is_honeypot: '1', buy_tax: '0', sell_tax: '0', is_blacklisted: '0' } } }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ pairs: [pair(ADDR_A, 12, 2)] }) } as unknown as Response;
    });
    const feed = new LiveMarketFeedService(60000);
    const seen: string[] = [];
    feed.onNewSignal((s) => seen.push(s.tokenAddress));
    const signals = await feed.fetchLiveMarketData();
    expect(signals).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('attaches clean security with checked reason and still emits', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'base', tokenAddress: ADDR_A }] } as unknown as Response;
      }
      if (String(url).includes('api.gopluslabs.io')) {
        return {
          ok: true,
          json: async () => ({ code: 1, message: 'OK', result: { [ADDR_A.toLowerCase()]: { is_honeypot: '0', buy_tax: '2', sell_tax: '3', is_blacklisted: '0' } } }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ pairs: [pair(ADDR_A, 12, 2)] }) } as unknown as Response;
    });
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();
    expect(signals).toHaveLength(1);
    expect(signals[0].security?.status).toBe('clean');
    const codes = signals[0].reasons.map((r) => r.code);
    expect(codes).toContain('HONEYPOT_CHECKED_CLEAN');
    expect(codes).not.toContain('HONEYPOT_UNCHECKED');
  });

  it('carries measured sells5m on every signal', async () => {
    const feed = new LiveMarketFeedService(60000);
    const signals = await feed.fetchLiveMarketData();
    expect(signals).toHaveLength(1);
    expect(signals[0].buys5m).toBe(12);
    expect(signals[0].sells5m).toBe(2);
  });

  it('bridges ingestSwap to SwarmDetector and emits signal via onNewSignal', async () => {
    const mockDetector = {
      processSwapEvent: vi.fn().mockResolvedValue({
        id: 'swarm_base_mock_123',
        tokenAddress: ADDR_A,
        tokenSymbol: 'SWARM_TEST',
        chain: 'BASE',
        mcap: 100000,
        liquidity: 40000,
        liqRatio: 40,
        rating: 'Tier 4',
        earlySelling: false,
        pileInTime: '<1m pile-in',
        ageMinutes: 30,
        smartWalletsCount: 3,
        smartWalletsInferred: false,
        timestamp: Date.now(),
        reasons: [],
      }),
    };

    const feed = new LiveMarketFeedService(60000, mockDetector as any);
    const received: any[] = [];
    feed.onNewSignal((s) => received.push(s));

    const result = await feed.ingestSwap({
      walletAddress: '0x1111111111111111111111111111111111111111',
      chain: 'BASE',
      tokenAddress: ADDR_A,
      tokenSymbol: 'SWARM_TEST',
      amountUsd: 1500,
      txHash: '0xswap123',
      timestamp: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.tokenSymbol).toBe('SWARM_TEST');
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('swarm_base_mock_123');
    expect(feed.getSignals()).toHaveLength(1);
  });
});
