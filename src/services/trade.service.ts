import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import { Keypair } from '@solana/web3.js';
import { WalletService } from './wallet.service.js';
import { buildQuickBuyPayload } from '../trade/router.js';
import { isValidEvmAddress, isValidSolanaAddress, validateTradeAmount } from '../utils/sanitize.js';
import { executeSolanaSwap, executeEvmSwap } from '../trade/execution/index.js';
import type { PostgresStorageAdapter } from '../database/postgres.adapter.js';

export interface QuickBuyParams {
  userId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: 'SOLANA' | 'BASE' | 'ETH' | 'BNB' | 'ROBINHOOD';
  amountIn: number;
  slippagePercent: number;
  enableMoonbagAutoTp?: boolean;
  entryMcap?: number;
  isPaper?: boolean;
  entryPriceUsd?: number;
  clientOrderId?: string;
  poolLiquidityUsd?: number;
  maxAllowedPriceImpactPercent?: number;
}

export interface Position {
  id: string;
  userId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  amountIn: number;
  entryMcap: number;
  currentMcap: number;
  entryPriceUsd?: number;
  currentPriceUsd?: number;
  pnlPercent: number;
  moonbagActive: boolean;
  timestamp: number;
  isPaper?: boolean;
  clientOrderId?: string;
}

export interface ClosedTradeRecord {
  id: string;
  positionId: string;
  userId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  amountIn: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  entryMcap: number;
  exitMcap: number;
  pnlPercent: number;
  percentageSold: number;
  openTimestamp: number;
  closeTimestamp: number;
  holdDurationSeconds: number;
  txHash: string;
  isPaper: boolean;
}


export function generateClientOrderId(
  userId: string,
  tokenAddress: string,
  botOrStrategyId: string,
  timestampWindowMs: number = 30000
): string {
  const windowBucket = Math.floor(Date.now() / timestampWindowMs);
  return crypto
    .createHash('sha256')
    .update(`${userId}:${botOrStrategyId}:${tokenAddress.toLowerCase()}:${windowBucket}`)
    .digest('hex')
    .slice(0, 24);
}

export class TradeService {
  private walletService: WalletService;
  private redis: Redis | null = null;
  private postgres?: PostgresStorageAdapter | null = null;
  private positions: Map<string, Position[]> = new Map();
  private paperPositions: Map<string, Position[]> = new Map();
  private tradeHistory: Map<string, ClosedTradeRecord[]> = new Map();
  private processedOrderIds: Map<string, number> = new Map();

  constructor(walletService: WalletService, redis?: Redis | null, postgres?: PostgresStorageAdapter | null) {
    this.walletService = walletService;
    if (redis) this.redis = redis;
    if (postgres) this.postgres = postgres;
  }

  public setPostgresAdapter(postgres: PostgresStorageAdapter | null): void {
    this.postgres = postgres;
  }

  private posKey(userId: string, isPaper: boolean): string {
    return `predique:custody:positions:${isPaper ? 'paper' : 'live'}:${userId}`;
  }

  private historyKey(userId: string, isPaper: boolean): string {
    return `predique:custody:history:${isPaper ? 'paper' : 'live'}:${userId}`;
  }


  private async loadList(userId: string, isPaper: boolean): Promise<Position[]> {
    const targetMap = isPaper ? this.paperPositions : this.positions;
    const mem = targetMap.get(userId);
    if (mem) return mem;
    if (!this.redis) return [];
    try {
      const raw = await this.redis.get(this.posKey(userId, isPaper));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Position[];
      if (Array.isArray(parsed)) {
        targetMap.set(userId, parsed);
        return parsed;
      }
    } catch (err) {
      console.warn('Positions Redis load failed:', (err as Error).message);
    }
    return targetMap.get(userId) || [];
  }

  private async saveList(userId: string, isPaper: boolean): Promise<void> {
    if (!this.redis) return;
    try {
      const targetMap = isPaper ? this.paperPositions : this.positions;
      await this.redis.set(this.posKey(userId, isPaper), JSON.stringify(targetMap.get(userId) || []));
    } catch (err) {
      console.warn('Positions Redis save failed:', (err as Error).message);
    }
  }

  public async executeQuickBuy(params: QuickBuyParams): Promise<{
    status: 'SUCCESS' | 'FAILED';
    txHash: string;
    moonbagActive: boolean;
    positionId: string;
    simulated: boolean;
  }> {
    const isPaper = !!params.isPaper;

    if (!isPaper && process.env.ALLOW_LIVE_TRADING !== 'true') {
      throw new Error('LIVE trading disabled: on-chain execution not audited (use isPaper=true)');
    }

    if (params.clientOrderId) {
      const now = Date.now();

      for (const [id, ts] of this.processedOrderIds.entries()) {
        if (now - ts > 300000) this.processedOrderIds.delete(id);
      }
      if (this.processedOrderIds.has(params.clientOrderId)) {
        throw new Error(`Duplicate order: clientOrderId ${params.clientOrderId} already processed`);
      }
      if (this.redis) {
        const key = `predique:idempotency:${params.clientOrderId}`;
        const set = await this.redis.set(key, '1', 'EX', 60, 'NX');
        if (!set) {
          throw new Error(`Duplicate order: clientOrderId ${params.clientOrderId} already processed`);
        }
      }
      this.processedOrderIds.set(params.clientOrderId, now);
    }

    if (!validateTradeAmount(params.amountIn)) {
      throw new Error('Invalid amountIn: must be a finite positive number');
    }

    if (params.amountIn < 0.0001) {
      throw new Error(`Invalid amountIn: ${params.amountIn} is a dust amount (minimum is 0.0001)`);
    }

    if (!Number.isFinite(params.slippagePercent) || params.slippagePercent <= 0 || params.slippagePercent > 50) {
      throw new Error('Invalid slippagePercent: must be within (0, 50]');
    }
    const chainUpper = params.chain?.toUpperCase();
    if (chainUpper === 'SOLANA') {
      if (!isValidSolanaAddress(params.tokenAddress)) {
        throw new Error('Invalid Solana tokenAddress (must be base58 32-44 chars)');
      }
    } else if (['BASE', 'ETH', 'BNB', 'ROBINHOOD'].includes(chainUpper)) {
      if (!isValidEvmAddress(params.tokenAddress)) {
        throw new Error('Invalid EVM tokenAddress');
      }
    } else {
      throw new Error('Unsupported chain');
    }

    const chainType = chainUpper === 'SOLANA' ? 'SOLANA' : 'EVM';

    if (isPaper) {
      const success = await this.walletService.deductPaperBalance(params.userId, chainType, params.amountIn);
      if (!success) {
        throw new Error(`Insufficient paper ${chainType === 'SOLANA' ? 'SOL' : 'ETH'} balance`);
      }
    } else {
      await this.walletService.getOrGenerateWallet(params.userId, chainType);
    }

    const numericTelegramId = Number.parseInt(params.userId.replace(/\D/g, ''), 10) || 123456789;
    const slippageBps = Math.round(params.slippagePercent * 100);

    const payload = buildQuickBuyPayload({
      userTelegramId: numericTelegramId,
      tokenAddress: params.tokenAddress,
      chain: params.chain,
      amountInNative: params.amountIn,
      slippageBps,
      enableMoonbag: !!params.enableMoonbagAutoTp,
      poolLiquidityUsd: params.poolLiquidityUsd,
      maxAllowedPriceImpactPercent: params.maxAllowedPriceImpactPercent,
    });

    let txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    let tokensReceived: number | undefined;

    if (!isPaper) {
      const privateKey = await this.walletService.getDecryptedPrivateKey(params.userId, chainType);
      try {
        if (chainType === 'SOLANA') {
          const secretKeyBuf = Buffer.from(privateKey, 'base64');
          const keypair = Keypair.fromSecretKey(secretKeyBuf);
          const execRes = await executeSolanaSwap(keypair, {
            tokenAddress: params.tokenAddress,
            amountSol: params.amountIn,
            slippageBps,
          });
          txHash = execRes.txHash;
          tokensReceived = execRes.tokensExpected;
        } else {
          const execRes = await executeEvmSwap(privateKey, {
            chain: params.chain as any,
            tokenAddress: params.tokenAddress,
            amountInEth: params.amountIn,
            slippagePercent: params.slippagePercent,
          });
          txHash = execRes.txHash;
        }
      } catch (err) {
        throw new Error(`On-chain execution failed: ${(err as Error).message}`);
      }
    }

    const positionId = `pos_${crypto.randomBytes(8).toString('hex')}`;

    const newPosition: Position = {
      id: positionId,
      userId: params.userId,
      tokenAddress: params.tokenAddress,
      tokenSymbol: params.tokenSymbol,
      chain: params.chain,
      amountIn: params.amountIn,
      entryMcap: params.entryMcap || 25000,
      currentMcap: params.entryMcap || 25000,
      entryPriceUsd: params.entryPriceUsd,
      currentPriceUsd: params.entryPriceUsd,
      pnlPercent: 0,
      moonbagActive: !!params.enableMoonbagAutoTp,
      timestamp: payload.timestamp,
      isPaper,
      clientOrderId: params.clientOrderId,
    };

    const targetMap = isPaper ? this.paperPositions : this.positions;
    const existing = await this.loadList(params.userId, isPaper);
    existing.push(newPosition);
    targetMap.set(params.userId, existing);
    await this.saveList(params.userId, isPaper);

    return {
      status: 'SUCCESS',
      txHash,
      moonbagActive: !!params.enableMoonbagAutoTp,
      positionId,
      simulated: isPaper,
    };
  }


  public async getPositions(userId: string, isPaper: boolean = false): Promise<Position[]> {
    return this.loadList(userId, isPaper);
  }

  public async getAllPositions(userId?: string): Promise<{ live: Position[]; paper: Position[] }> {
    if (userId) {
      const [live, paper] = await Promise.all([
        this.loadList(userId, false),
        this.loadList(userId, true),
      ]);
      return { live, paper };
    }

    const live: Position[] = [];
    for (const list of this.positions.values()) {
      live.push(...list);
    }
    const paper: Position[] = [];
    for (const list of this.paperPositions.values()) {
      paper.push(...list);
    }

    const fallbackPaperUsers = ['trader_guest', 'trader_paper_auto'];
    for (const u of fallbackPaperUsers) {
      if (!this.paperPositions.has(u)) {
        const pList = await this.loadList(u, true);
        for (const p of pList) {
          if (!paper.some((existing) => existing.id === p.id)) {
            paper.push(p);
          }
        }
      }
    }

    return { live, paper };
  }

  public updatePositionsPrice(priceMap: Map<string, number>): void {
    const updateList = (map: Map<string, Position[]>, isPaper: boolean) => {
      for (const [userId, positions] of map.entries()) {
        let touched = false;
        for (const pos of positions) {
          const currentPrice = priceMap.get(pos.tokenAddress.toLowerCase()) ?? priceMap.get(pos.tokenAddress);
          if (currentPrice && currentPrice > 0) {
            pos.currentPriceUsd = currentPrice;
            touched = true;
            if (pos.entryPriceUsd && pos.entryPriceUsd > 0) {
              pos.pnlPercent = parseFloat((((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(2));
              if (pos.entryMcap > 0) {
                pos.currentMcap = Math.round(pos.entryMcap * (currentPrice / pos.entryPriceUsd));
              }
            }
          }
        }

        if (touched) void this.saveList(userId, isPaper);
      }
    };

    updateList(this.positions, false);
    updateList(this.paperPositions, true);
  }

  public async closePosition(
    userId: string,
    positionId: string,
    percentage: number = 100,
    isPaper: boolean = false,
    currentPriceUsd?: number
  ): Promise<{ status: 'SUCCESS'; percentageSold: number; txHash: string; returnedAmount?: number }> {
    const targetMap = isPaper ? this.paperPositions : this.positions;
    const list = await this.loadList(userId, isPaper);
    const posIndex = list.findIndex((p) => p.id === positionId);
    if (posIndex === -1) {
      throw new Error(`Position ${positionId} not found`);
    }

    const pos = list[posIndex];
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const clampedPercentage = Math.min(100, Math.max(1, percentage));
    const soldProportion = clampedPercentage / 100;
    const soldAmountIn = pos.amountIn * soldProportion;

    let returnedAmount = soldAmountIn;
    const priceNow = currentPriceUsd || pos.currentPriceUsd || pos.entryPriceUsd;
    if (priceNow && pos.entryPriceUsd && pos.entryPriceUsd > 0) {
      returnedAmount = parseFloat((soldAmountIn * (priceNow / pos.entryPriceUsd)).toFixed(8));
    }
    if (isPaper) {
      const chainUpper = (pos.chain || '').toUpperCase();
      const chainType = chainUpper === 'SOLANA' ? 'SOLANA' : 'EVM';
      await this.walletService.creditPaperBalance(userId, chainType, returnedAmount);
    }

    const closeTimestamp = Date.now();
    const holdDurationSeconds = Math.max(0, Math.floor((closeTimestamp - pos.timestamp) / 1000));
    const pnlPercent = (priceNow && pos.entryPriceUsd && pos.entryPriceUsd > 0)
      ? parseFloat((((priceNow - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(2))
      : 0;

    const closedRecord: ClosedTradeRecord = {
      id: `hist_${crypto.randomBytes(8).toString('hex')}`,
      positionId: pos.id,
      userId,
      tokenAddress: pos.tokenAddress,
      tokenSymbol: pos.tokenSymbol,
      chain: pos.chain,
      amountIn: soldAmountIn,
      entryPriceUsd: pos.entryPriceUsd,
      exitPriceUsd: priceNow,
      entryMcap: pos.entryMcap,
      exitMcap: pos.currentMcap,
      pnlPercent,
      percentageSold: clampedPercentage,
      openTimestamp: pos.timestamp,
      closeTimestamp,
      holdDurationSeconds,
      txHash,
      isPaper,
    };

    await this.recordHistory(userId, closedRecord, isPaper);

    if (percentage >= 100) {
      list.splice(posIndex, 1);
    } else {
      pos.amountIn = parseFloat((pos.amountIn - soldAmountIn).toFixed(8));
    }

    targetMap.set(userId, list);
    await this.saveList(userId, isPaper);

    return {
      status: 'SUCCESS',
      percentageSold: clampedPercentage,
      txHash,
      returnedAmount,
    };
  }

  private async recordHistory(userId: string, record: ClosedTradeRecord, isPaper: boolean): Promise<void> {
    const existing = await this.getTradeHistory(userId, isPaper);
    const list = [record, ...existing.filter((r) => r.id !== record.id)];
    if (list.length > 100) list.pop();
    this.tradeHistory.set(this.historyKey(userId, isPaper), list);

    if (this.redis) {
      try {
        await this.redis.set(this.historyKey(userId, isPaper), JSON.stringify(list));
      } catch (err) {
        console.warn('Trade history Redis save failed:', (err as Error).message);
      }
    }

    if (this.postgres) {
      try {
        await this.postgres.saveTrade(record);
      } catch (err) {
        console.warn('Trade history Postgres save failed:', (err as Error).message);
      }
    }
  }

  public async getTradeHistory(userId: string, isPaper: boolean = false): Promise<ClosedTradeRecord[]> {
    const cacheKey = this.historyKey(userId, isPaper);
    const mem = this.tradeHistory.get(cacheKey);
    if (mem) return [...mem];

    if (this.redis) {
      try {
        const raw = await this.redis.get(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as ClosedTradeRecord[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.tradeHistory.set(cacheKey, parsed);
            return [...parsed];
          }
        }
      } catch (err) {
        console.warn('Trade history Redis load failed:', (err as Error).message);
      }
    }

    if (this.postgres) {
      try {
        const pgTrades = await this.postgres.getTrades(userId, isPaper);
        if (Array.isArray(pgTrades) && pgTrades.length > 0) {
          this.tradeHistory.set(cacheKey, pgTrades);
          if (this.redis) {
            await this.redis.set(cacheKey, JSON.stringify(pgTrades)).catch(() => undefined);
          }
          return pgTrades;
        }
      } catch (err) {
        console.warn('Trade history Postgres load failed:', (err as Error).message);
      }
    }

    return [];
  }


  public async setMoonbagActive(
    userId: string,
    positionId: string,
    active: boolean,
    isPaper: boolean = false
  ): Promise<boolean> {
    const targetMap = isPaper ? this.paperPositions : this.positions;
    const list = await this.loadList(userId, isPaper);
    const pos = list.find((p) => p.id === positionId);
    if (!pos) return false;
    pos.moonbagActive = active;
    targetMap.set(userId, list);
    await this.saveList(userId, isPaper);
    return true;
  }

  public clearPaperPositions(userId: string): void {
    this.paperPositions.delete(userId);
    if (this.redis) {
      this.redis.del(this.posKey(userId, true)).catch(() => undefined);
    }
  }
}
