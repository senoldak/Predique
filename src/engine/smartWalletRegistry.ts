export type SmartWalletTag = 'ALPHA_SNIPER' | 'WHALE' | 'KOL' | 'INSIDER';

export interface SmartWallet {
  address: string;
  chain: 'SOLANA' | 'EVM';
  label: string;
  tag: SmartWalletTag;
  winRate30d: number; // e.g. 78.5 (%)
  totalPnlUsd: number;
  lastActiveTimestamp?: number;
}

const DEFAULT_SMART_WALLETS: SmartWallet[] = [
  {
    address: 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghDgPump',
    chain: 'SOLANA',
    label: 'Solana Alpha Sniper 1',
    tag: 'ALPHA_SNIPER',
    winRate30d: 82.4,
    totalPnlUsd: 215000,
  },
  {
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    chain: 'SOLANA',
    label: 'Solana Early Accumulator',
    tag: 'INSIDER',
    winRate30d: 76.0,
    totalPnlUsd: 142000,
  },
  {
    address: '0x1234567890123456789012345678901234567890',
    chain: 'EVM',
    label: 'Base Memecoin Whale',
    tag: 'WHALE',
    winRate30d: 79.2,
    totalPnlUsd: 310000,
  },
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chain: 'EVM',
    label: 'EVM Multi-Chain Alpha',
    tag: 'ALPHA_SNIPER',
    winRate30d: 88.1,
    totalPnlUsd: 540000,
  },
];

import type { PostgresStorageAdapter } from '../database/postgres.adapter.js';

export class SmartWalletRegistry {
  private wallets: Map<string, SmartWallet> = new Map();
  private postgres?: PostgresStorageAdapter | null = null;

  constructor(autoSeed = true, postgres?: PostgresStorageAdapter | null) {
    if (postgres) {
      this.postgres = postgres;
    }
    if (autoSeed) {
      this.seedDefaultWallets();
    }
  }

  public setPostgresAdapter(postgres: PostgresStorageAdapter | null): void {
    this.postgres = postgres;
  }

  public async loadFromPostgres(): Promise<number> {
    if (!this.postgres) return 0;
    try {
      const stored = await this.postgres.getSmartWallets();
      for (const w of stored) {
        this.wallets.set(this.normalizeAddress(w.address), { ...w });
      }
      return stored.length;
    } catch (err) {
      console.warn('Failed to load smart wallets from Postgres:', (err as Error).message);
      return 0;
    }
  }

  private normalizeAddress(address: string): string {
    return address.trim().toLowerCase();
  }

  public seedDefaultWallets(): void {
    for (const w of DEFAULT_SMART_WALLETS) {
      this.registerWallet(w);
    }
  }

  public registerWallet(wallet: SmartWallet): void {
    const key = this.normalizeAddress(wallet.address);
    this.wallets.set(key, { ...wallet });
    if (this.postgres) {
      this.postgres.saveSmartWallet(wallet).catch((err) => {
        console.warn('Failed to persist smart wallet to Postgres:', err.message);
      });
    }
  }

  public isSmartWallet(address: string): boolean {
    return this.wallets.has(this.normalizeAddress(address));
  }

  public getWallet(address: string): SmartWallet | undefined {
    return this.wallets.get(this.normalizeAddress(address));
  }

  public getAllWallets(): SmartWallet[] {
    return Array.from(this.wallets.values());
  }

  public getWalletsByChain(chain: 'SOLANA' | 'EVM'): SmartWallet[] {
    return this.getAllWallets().filter((w) => w.chain === chain);
  }

  public getWalletsByTag(tag: SmartWalletTag): SmartWallet[] {
    return this.getAllWallets().filter((w) => w.tag === tag);
  }
}
