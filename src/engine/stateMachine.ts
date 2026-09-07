import type { Redis } from 'ioredis';

export function formatPileIn(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return '<1m pile-in';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m pile-in`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h pile-in`;
  const days = Math.floor(hours / 24);
  return `${days}d pile-in`;
}

export interface RecordBuyResult {
  walletCount: number;
  shouldTriggerBuy: boolean;
  shouldTriggerUpdate: boolean;
  pileInText: string;
  totalVolume: number;
}

export async function recordWalletBuy(
  redis: Redis,
  tokenKey: string,
  wallet: string,
  amount: number,
  timestamp: number
): Promise<RecordBuyResult> {
  const key = `predique:state:${tokenKey}`;
  const walletsKey = `predique:wallets:${tokenKey}`;

  const isNew = (await redis.sadd(walletsKey, wallet)) === 1;
  const count = await redis.scard(walletsKey);

  if (count === 1 && isNew) {
    await redis.hset(key, 'first_buy_time', timestamp.toString());

    await redis.hset(key, 'early_selling', '0');
    await redis.hset(key, 'total_volume', '0');
    await redis.expire(key, 86400 * 3);
    await redis.expire(walletsKey, 86400 * 3);
  }

  await redis.hset(key, 'latest_buy_time', timestamp.toString());
  await redis.hincrbyfloat(key, 'total_volume', amount);

  const firstTime = Number(await redis.hget(key, 'first_buy_time')) || timestamp;

  const pileInMs = Math.max(0, timestamp - firstTime);
  const pileInText = formatPileIn(pileInMs);
  const totalVolume = Number(await redis.hget(key, 'total_volume')) || amount;

  const called = (await redis.hget(key, 'called')) === '1';

  let shouldTriggerBuy = false;
  let shouldTriggerUpdate = false;

  if (count >= 3 && !called) {
    const acquired = (await redis.hsetnx(key, 'called', '1')) === 1;
    if (acquired) {
      shouldTriggerBuy = true;
    } else if (isNew) {
      shouldTriggerUpdate = true;
    }
  } else if (count > 3 && called && isNew) {
    shouldTriggerUpdate = true;
  }

  return {
    walletCount: count,
    shouldTriggerBuy,
    shouldTriggerUpdate,
    pileInText,
    totalVolume
  };
}

export async function recordWalletSell(redis: Redis, tokenKey: string, wallet: string): Promise<void> {
  const key = `predique:state:${tokenKey}`;
  const walletsKey = `predique:wallets:${tokenKey}`;

  const isBuyer = (await redis.sismember(walletsKey, wallet)) === 1;
  if (isBuyer) {
    await redis.hset(key, 'early_selling', '1');
  }
}

export async function getTokenState(redis: Redis, tokenKey: string) {
  const key = `predique:state:${tokenKey}`;
  const walletsKey = `predique:wallets:${tokenKey}`;

  const data = await redis.hgetall(key);
  const count = await redis.scard(walletsKey);

  return {
    walletCount: count,
    called: data.called === '1',
    earlySelling: data.early_selling === '1',
    firstBuyTime: Number(data.first_buy_time) || 0,
    latestBuyTime: Number(data.latest_buy_time) || 0,
    totalVolume: Number(data.total_volume) || 0
  };
}
