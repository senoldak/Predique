import { calculateSignalTier } from '../engine/scoring.js';
import { checkTokenSecurity, type TokenSecurityResult } from '../security/tokenSecurity.service.js';
import type { SwarmDetector, IngestSwapEvent } from '../engine/swarmDetector.js';

export interface SignalReasonDetail {
  code: string;
  label: string;
  status: 'POSITIVE' | 'WARNING' | 'NEUTRAL';
  value: string;
}

export interface PublicTokenSignal {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  mcap: number;
  liquidity: number;
  liqRatio: number;
  rating: string;
  earlySelling: boolean;
  pileInTime: string;
  ageMinutes: number;
  smartWalletsCount: number;

  smartWalletsInferred?: boolean;

  buys5m?: number;

  sells5m?: number;

  topWallets?: Array<{ label: string; winRate: number; volume: number }>;

  sponsored?: boolean;
  timestamp: number;
  volume24h?: number;
  priceUsd?: number;
  priceChange24h?: number;

  reasons: SignalReasonDetail[];
  security?: TokenSecurityResult;
}

export class LiveMarketFeedService {
  private cachedSignals: PublicTokenSignal[] = [];
  private pollIntervalMs: number;
  private isPolling = false;
  private timer: NodeJS.Timeout | null = null;
  private onNewSignalCallbacks: ((signal: PublicTokenSignal) => void)[] = [];
  private dispatchedAt = new Map<string, number>();
  private swarmDetector?: SwarmDetector;

  constructor(pollIntervalMs = 15000, swarmDetector?: SwarmDetector) {
    this.pollIntervalMs = pollIntervalMs;
    if (swarmDetector) {
      this.swarmDetector = swarmDetector;
    }
  }

  public setSwarmDetector(detector: SwarmDetector): void {
    this.swarmDetector = detector;
  }

  public getSwarmDetector(): SwarmDetector | undefined {
    return this.swarmDetector;
  }

  public async ingestSwap(event: IngestSwapEvent): Promise<PublicTokenSignal | null> {
    if (!this.swarmDetector) return null;
    const signal = await this.swarmDetector.processSwapEvent(event);
    if (signal) {
      this.injectSwarmSignal(signal);
    }
    return signal;
  }

  public onNewSignal(cb: (signal: PublicTokenSignal) => void) {
    this.onNewSignalCallbacks.push(cb);
  }

  public getSignals(): PublicTokenSignal[] {
    return this.cachedSignals;
  }

  public injectSwarmSignal(signal: PublicTokenSignal) {
    this.cachedSignals.unshift(signal);
    if (this.cachedSignals.length > 50) {
      this.cachedSignals.pop();
    }
    for (const cb of this.onNewSignalCallbacks) {
      try {
        cb(signal);
      } catch (err) {
        console.error('Error in onNewSignal callback:', err);
      }
    }
  }

  public start() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.fetchLiveMarketData().catch((err) => {
      console.warn('⚠️ Initial live market feed fetch error:', (err as Error).message);
    });
    this.timer = setInterval(() => {
      this.fetchLiveMarketData().catch((err) => {
        console.warn('⚠️ Periodic live market feed fetch error:', (err as Error).message);
      });
    }, this.pollIntervalMs);
  }

  public stop() {
    this.isPolling = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async fetchLiveMarketData(): Promise<PublicTokenSignal[]> {
    try {

      const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`DexScreener API returned HTTP ${res.status}`);
      }

      const profiles = (await res.json()) as Array<{
        chainId: string;
        tokenAddress: string;
      }>;

      if (!Array.isArray(profiles) || profiles.length === 0) {
        return this.cachedSignals;
      }

      const targetChains = new Set(['solana', 'base', 'bsc', 'ethereum', 'robinhood']);
      const addressesToFetch: string[] = [];
      const seen = new Set<string>();

      for (const item of profiles) {
        if (!item?.tokenAddress) continue;
        const c = item.chainId?.toLowerCase();
        if (targetChains.has(c) && !seen.has(item.tokenAddress)) {
          seen.add(item.tokenAddress);
          addressesToFetch.push(item.tokenAddress);
          if (addressesToFetch.length >= 15) break;
        }
      }

      if (addressesToFetch.length === 0) {
        return this.cachedSignals;
      }

      const batchUrl = `https://api.dexscreener.com/latest/dex/tokens/${addressesToFetch.join(',')}`;
      const batchRes = await fetch(batchUrl, { headers: { Accept: 'application/json' } });
      if (!batchRes.ok) {
        throw new Error(`DexScreener batch returned HTTP ${batchRes.status}`);
      }

      const batchData = (await batchRes.json()) as { pairs?: Array<any> };
      const pairs = batchData.pairs || [];

      const bestPairPerToken = new Map<string, any>();
      for (const pair of pairs) {
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        const currentBest = bestPairPerToken.get(addr);
        const liq = pair.liquidity?.usd || 0;
        if (!currentBest || liq > (currentBest.liquidity?.usd || 0)) {
          bestPairPerToken.set(addr, pair);
        }
      }

      const updatedSignals: PublicTokenSignal[] = [];

      const candidates: Array<{ pair: any; chain: string; address: string }> = [];
      for (const pair of bestPairPerToken.values()) {
        const txPre = pair.txns?.m5 || { buys: 0, sells: 0 };
        const buysPre = Number(txPre.buys) || 0;

        if (buysPre <= 0) continue;

        if (buysPre < 5) continue;
        const addrPre = pair.baseToken?.address;
        if (!addrPre) continue;
        candidates.push({ pair, chain: String(pair.chainId || 'UNKNOWN'), address: String(addrPre) });
      }

      const securities = await Promise.allSettled(candidates.map((c) => checkTokenSecurity(c.chain, c.address)));

      for (let idx = 0; idx < candidates.length; idx++) {
        const { pair } = candidates[idx];
        const settled = securities[idx];
        const security: TokenSecurityResult =
          settled.status === 'fulfilled'
            ? settled.value
            : { status: 'unknown', isHoneypot: false, buyTax: 0, sellTax: 0, hasBlacklist: false, lpLocked: null, source: 'unknown', checkedAt: Date.now() };
        const mcap = Math.round(pair.marketCap || pair.fdv || 0);
        const liquidity = Math.round(pair.liquidity?.usd || 0);
        const liqRatio = mcap > 0 ? Number(((liquidity / mcap) * 100).toFixed(1)) : 0;
        const rawChain = (pair.chainId || 'UNKNOWN').toUpperCase();
        const chain = rawChain === 'BSC' ? 'BNB' : rawChain;
        const symbol = pair.baseToken?.symbol || 'TOKEN';

        const pairCreatedAt = pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now() - 3600000;
        const ageMinutes = Math.max(1, Math.round((Date.now() - pairCreatedAt) / (1000 * 60)));

        const tx5m = pair.txns?.m5 || { buys: 0, sells: 0 };
        const buysCount = Number(tx5m.buys) || 0;

        if (buysCount <= 0) continue;

        if (buysCount < 5) continue;
        const sellsCount = Number(tx5m.sells) || 0;
        const earlySelling = sellsCount > buysCount && ageMinutes < 30;

        const smartWalletsCount = Math.min(15, Math.max(3, Math.round(buysCount / 2)));

        const score = calculateSignalTier({
          ageMinutes,
          liqMcRatio: liqRatio,
          smartWalletsCount,
          earlySelling,
          hasHoneypot: security.isHoneypot,
        });

        if (security.isHoneypot) continue;

        const reasons: SignalReasonDetail[] = [];

        if (buysCount >= 5) {
          reasons.push({
            code: 'BUY_CLUSTER',
            label: 'High 5m Buy Velocity',
            status: 'POSITIVE',
            value: `${buysCount} buys in last 5m`,
          });
        } else {
          reasons.push({
            code: 'NORMAL_VOLUME',
            label: 'Buy Flow',
            status: 'NEUTRAL',
            value: `${buysCount} buys in last 5m`,
          });
        }

        if (liqRatio >= 15 && liqRatio <= 65) {
          reasons.push({
            code: 'HEALTHY_LIQUIDITY',
            label: 'Balanced Liquidity Ratio',
            status: 'POSITIVE',
            value: `${liqRatio}% (Low slippage risk)`,
          });
        } else if (liqRatio < 10) {
          reasons.push({
            code: 'THIN_LIQUIDITY',
            label: 'Thin Liquidity',
            status: 'WARNING',
            value: `${liqRatio}% (High price impact risk)`,
          });
        } else {
          reasons.push({
            code: 'LIQUIDITY_RATIO',
            label: 'Liquidity Ratio',
            status: 'NEUTRAL',
            value: `${liqRatio}%`,
          });
        }

        if (!earlySelling) {
          reasons.push({
            code: 'NO_DUMP',
            label: 'No Early Dump Pressure',
            status: 'POSITIVE',
            value: `Buys absorbing sells (${buysCount}B vs ${sellsCount}S)`,
          });
        } else {
          reasons.push({
            code: 'SELL_PRESSURE',
            label: 'Sell Pressure Warning',
            status: 'WARNING',
            value: `${sellsCount} early sells detected`,
          });
        }

        const ageHours = (ageMinutes / 60).toFixed(1);
        if (ageMinutes >= 60) {
          reasons.push({
            code: 'MATURE_PAIR',
            label: 'Established Pool',
            status: 'POSITIVE',
            value: `Active for ${ageHours}h (Lower instant rug risk)`,
          });
        } else {
          reasons.push({
            code: 'NEW_PAIR',
            label: 'Fresh Pair',
            status: 'NEUTRAL',
            value: `Newly created pool (${ageMinutes}m old)`,
          });
        }

        if (security.status === 'clean') {
          reasons.push({ code: 'HONEYPOT_CHECKED_CLEAN', label: 'Contract Clean', status: 'POSITIVE', value: `No honeypot — tax ${security.buyTax}%/${security.sellTax}%` });
        } else if (security.status === 'risk') {
          reasons.push({ code: 'HONEYPOT_RISK', label: 'Contract Risk', status: 'WARNING', value: `Tax ${security.buyTax}%/${security.sellTax}%${security.hasBlacklist ? ' — blacklist' : ''} — DYOR` });
        } else {
          reasons.push({ code: 'HONEYPOT_UNKNOWN', label: 'Security Unverified', status: 'NEUTRAL', value: 'Security audit unavailable — DYOR' });
        }

        const signal: PublicTokenSignal = {
          id: `real_${pair.baseToken.address.slice(0, 8)}_${pair.chainId}`,
          tokenAddress: pair.baseToken.address,
          tokenSymbol: symbol,
          chain,
          mcap,
          liquidity,
          liqRatio,
          rating: score.tier,
          earlySelling,
          pileInTime: `${buysCount} buys/5m`,
          ageMinutes,
          smartWalletsCount,
          smartWalletsInferred: true,
          buys5m: buysCount,
          sells5m: sellsCount,
          sponsored: false,
          timestamp: Date.now(),
          volume24h: Math.round(pair.volume?.h24 || 0),
          priceUsd: Number(pair.priceUsd || 0),
          priceChange24h: Number(pair.priceChange?.h24 || 0),
          reasons,
          security,
        };

        updatedSignals.push(signal);
      }

      if (updatedSignals.length > 0) {

        const now = Date.now();
        for (const sig of updatedSignals) {
          const key = sig.tokenAddress.toLowerCase();
          const lastDispatched = this.dispatchedAt.get(key);
          const isHighTier =
            sig.rating === 'PLATINUM' ||
            sig.rating === 'GOLD' ||
            sig.rating === 'ROYAL_HONEY' ||
            sig.rating === 'SWARM_INBOUND';
          const cooldown = isHighTier ? 15 * 60 * 1000 : 30 * 60 * 1000;

          if (!lastDispatched || now - lastDispatched > cooldown) {
            this.dispatchedAt.set(key, now);
            this.onNewSignalCallbacks.forEach((cb) => cb(sig));
          }
        }
        this.cachedSignals = updatedSignals;
      }

      return this.cachedSignals;
    } catch (err) {
      console.warn('⚠️ MarketFeed fetch error:', (err as Error).message);
      return this.cachedSignals;
    }
  }
}
