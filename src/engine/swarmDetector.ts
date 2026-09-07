import type { Redis } from 'ioredis';
import { SmartWalletRegistry, type SmartWallet } from './smartWalletRegistry.js';
import { recordWalletBuy, recordWalletSell } from './stateMachine.js';
import { calculateSignalTier } from './scoring.js';
import type { PublicTokenSignal, SignalReasonDetail } from '../services/marketFeed.service.js';

export interface IngestSwapEvent {
  walletAddress: string;
  chain: 'SOLANA' | 'BASE' | 'ETH' | 'BNB' | 'ROBINHOOD';
  tokenAddress: string;
  tokenSymbol: string;
  amountUsd: number;
  txHash: string;
  timestamp: number;
  marketCap?: number;
  liquidityUsd?: number;
  isSell?: boolean;
}

export class SwarmDetector {
  private redis: Redis;
  private registry: SmartWalletRegistry;

  constructor(redis: Redis, registry?: SmartWalletRegistry) {
    this.redis = redis;
    this.registry = registry || new SmartWalletRegistry();
  }

  public getRegistry(): SmartWalletRegistry {
    return this.registry;
  }

  public async processSwapEvent(event: IngestSwapEvent): Promise<PublicTokenSignal | null> {
    const isSmart = this.registry.isSmartWallet(event.walletAddress);
    if (!isSmart) {
      return null;
    }

    const tokenKey = `${event.chain.toLowerCase()}:${event.tokenAddress.toLowerCase()}`;

    if (event.isSell) {
      await recordWalletSell(this.redis, tokenKey, event.walletAddress);
      return null;
    }


    const result = await recordWalletBuy(
      this.redis,
      tokenKey,
      event.walletAddress,
      event.amountUsd,
      event.timestamp
    );

    if (!result.shouldTriggerBuy && !result.shouldTriggerUpdate) {
      return null;
    }

    const mcap = event.marketCap || 50000;
    const liquidity = event.liquidityUsd || 25000;
    const liqRatio = mcap > 0 ? Number(((liquidity / mcap) * 100).toFixed(1)) : 0;
    const earlySelling = false;
    const ageMinutes = 65; // Default mature token age or inferred

    const score = calculateSignalTier({
      ageMinutes,
      liqMcRatio: liqRatio,
      smartWalletsCount: result.walletCount,
      earlySelling,
    });

    const reasons: SignalReasonDetail[] = [];

    if (result.shouldTriggerBuy) {
      reasons.push({
        code: 'SWARM_CLUSTER',
        label: 'Swarm Cluster Inbound',
        status: 'POSITIVE',
        value: `${result.walletCount} distinct smart wallets accumulated within ${result.pileInText}`,
      });
    } else if (result.shouldTriggerUpdate) {
      reasons.push({
        code: 'SWARM_CLUSTER_EXPANSION',
        label: 'Swarm Cluster Growing',
        status: 'POSITIVE',
        value: `Expanded to ${result.walletCount} smart wallets (${result.pileInText})`,
      });
    }

    const smartMeta = this.registry.getWallet(event.walletAddress);
    const topWallets = smartMeta
      ? [
          {
            label: `${smartMeta.label} [${smartMeta.tag}]`,
            winRate: smartMeta.winRate30d,
            volume: event.amountUsd,
          },
        ]
      : undefined;

    const signal: PublicTokenSignal = {
      id: `swarm_${event.chain.toLowerCase()}_${event.tokenAddress.slice(0, 8)}_${event.timestamp}`,
      tokenAddress: event.tokenAddress,
      tokenSymbol: event.tokenSymbol,
      chain: event.chain,
      mcap,
      liquidity,
      liqRatio,
      rating: score.stars,
      earlySelling,
      pileInTime: result.pileInText,
      ageMinutes,
      smartWalletsCount: result.walletCount,
      smartWalletsInferred: false,
      topWallets,
      timestamp: event.timestamp,
      reasons,
    };

    return signal;
  }
}
