import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { Keypair } from '@solana/web3.js';
import { encryptKey, decryptWithRotation } from '../security/crypto.js';
import { isValidSolanaAddress } from '../utils/sanitize.js';
import type { PostgresStorageAdapter } from '../database/postgres.adapter.js';

import { createWalletClient, parseEther } from 'viem';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

export interface WalletInfo {
  address: string;
  chain: 'EVM' | 'SOLANA';
  balance: number;
}

export interface BalanceSweepOptions {
  chain: 'EVM' | 'SOLANA';
  vaultAddress: string;
  reserveAmount?: number;
  sweepAmount?: number;
  mode?: 'paper' | 'live';
}

export interface SweepResult {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  chain: 'EVM' | 'SOLANA';
  sweptAmount: number;
  remainingBalance: number;
  vaultAddress: string;
  txHash?: string;
  reason?: string;
}

interface StoredWallet {
  address: string;
  chain: 'EVM' | 'SOLANA';
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface PaperBalances {
  evm: number;
  solana: number;
}

export class WalletService {
  private masterKey: string;
  private previousMasterKey: string | null = null;
  private redis: Redis | null = null;
  private postgres?: PostgresStorageAdapter | null = null;
  private userWallets: Map<string, StoredWallet[]> = new Map();
  private cachedBalances: Map<string, { balance: number; timestamp: number }> = new Map();
  private userPaperBalances: Map<string, PaperBalances> = new Map();
  private userVaultBalances: Map<string, PaperBalances> = new Map();

  private evmClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  constructor(
    masterKeyHex: string,
    redis?: Redis | null,
    previousMasterKeyHex?: string | null,
    postgres?: PostgresStorageAdapter | null
  ) {
    this.masterKey = masterKeyHex;
    if (redis) this.redis = redis;
    if (previousMasterKeyHex) this.previousMasterKey = previousMasterKeyHex;
    if (postgres) this.postgres = postgres;
  }

  public setPostgresAdapter(postgres: PostgresStorageAdapter | null): void {
    this.postgres = postgres;
  }

  public setPreviousMasterKey(hex: string | null): void {
    this.previousMasterKey = hex;
  }

  private walletKey(userId: string): string {
    return `predique:custody:wallets:${userId}`;
  }

  private paperKey(userId: string): string {
    return `predique:custody:paper:${userId}`;
  }

  private vaultKey(userId: string): string {
    return `predique:custody:vault:${userId}`;
  }

  private async loadVault(userId: string): Promise<PaperBalances> {
    const mem = this.userVaultBalances.get(userId);
    if (mem) return mem;
    if (!this.redis) return { evm: 0.0, solana: 0.0 };
    try {
      const raw = await this.redis.get(this.vaultKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw) as PaperBalances;
        if (typeof parsed.evm === 'number' && typeof parsed.solana === 'number') {
          this.userVaultBalances.set(userId, parsed);
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Vault Redis load failed:', (err as Error).message);
    }
    return { evm: 0.0, solana: 0.0 };
  }

  private async saveVault(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const b = this.userVaultBalances.get(userId);
      if (b) await this.redis.set(this.vaultKey(userId), JSON.stringify(b));
    } catch (err) {
      console.warn('Vault Redis save failed:', (err as Error).message);
    }
  }

  private async loadWallets(userId: string): Promise<StoredWallet[]> {
    const mem = this.userWallets.get(userId);
    if (mem) return mem;

    // 1. Try Redis first (fast path)
    if (this.redis) {
      try {
        const raw = await this.redis.get(this.walletKey(userId));
        if (raw) {
          const parsed = JSON.parse(raw) as StoredWallet[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.userWallets.set(userId, parsed);
            return parsed;
          }
        }
      } catch (err) {
        console.warn('Wallet Redis load failed, trying fallback:', (err as Error).message);
      }
    }

    // 2. Fallback to PostgreSQL if configured (cold/recovery path)
    if (this.postgres) {
      try {
        const dbWallets = await this.postgres.getWallets(userId);
        if (dbWallets.length > 0) {
          this.userWallets.set(userId, dbWallets);
          // Re-warm Redis
          if (this.redis) {
            await this.redis.set(this.walletKey(userId), JSON.stringify(dbWallets)).catch(() => undefined);
          }
          return dbWallets;
        }
      } catch (err) {
        console.warn('Wallet Postgres fallback load failed:', (err as Error).message);
      }
    }

    return this.userWallets.get(userId) || [];
  }

  private async saveWallets(userId: string): Promise<void> {
    const list = this.userWallets.get(userId) || [];

    if (this.redis) {
      try {
        await this.redis.set(this.walletKey(userId), JSON.stringify(list));
      } catch (err) {
        console.warn('Wallet Redis save failed:', (err as Error).message);
      }
    }

    if (this.postgres) {
      for (const w of list) {
        try {
          await this.postgres.saveWallet(userId, w);
        } catch (err) {
          console.warn('Wallet Postgres save failed:', (err as Error).message);
        }
      }
    }
  }

  private async loadPaper(userId: string): Promise<PaperBalances> {
    const mem = this.userPaperBalances.get(userId);
    if (mem) return mem;
    if (!this.redis) return { evm: 1.5, solana: 10.0 };
    try {
      const raw = await this.redis.get(this.paperKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw) as PaperBalances;
        if (typeof parsed.evm === 'number' && typeof parsed.solana === 'number') {
          this.userPaperBalances.set(userId, parsed);
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Paper Redis load failed:', (err as Error).message);
    }
    return { evm: 1.5, solana: 10.0 };
  }

  private async savePaper(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const b = this.userPaperBalances.get(userId);
      if (b) await this.redis.set(this.paperKey(userId), JSON.stringify(b));
    } catch (err) {
      console.warn('Paper Redis save failed:', (err as Error).message);
    }
  }

  public async getOrCreatePaperBalancesAsync(userId: string): Promise<PaperBalances> {
    let balances = this.userPaperBalances.get(userId);
    if (balances) return balances;
    balances = await this.loadPaper(userId);
    this.userPaperBalances.set(userId, balances);
    return balances;
  }

  public getOrCreatePaperBalances(userId: string): PaperBalances {
    let balances = this.userPaperBalances.get(userId);
    if (!balances) {
      balances = { evm: 1.5, solana: 10.0 };
      this.userPaperBalances.set(userId, balances);
      void this.loadPaper(userId).then((loaded) => {
        if (this.userPaperBalances.get(userId) === balances) {
          // keep memory default unless Redis has explicit record
        }
      }).catch(() => undefined);
    }
    return balances;
  }

  public async resetPaperBalance(userId: string): Promise<WalletInfo[]> {
    this.userPaperBalances.set(userId, { evm: 1.5, solana: 10.0 });
    await this.savePaper(userId);
    return this.getWallets(userId, 'paper');
  }

  public async deductPaperBalance(userId: string, chain: 'EVM' | 'SOLANA', amount: number): Promise<boolean> {
    const balances = await this.getOrCreatePaperBalancesAsync(userId);
    const key = chain === 'EVM' ? 'evm' : 'solana';
    if (balances[key] < amount) {
      return false;
    }
    balances[key] = parseFloat((balances[key] - amount).toFixed(8));
    this.userPaperBalances.set(userId, balances);
    await this.savePaper(userId);
    return true;
  }

  public async creditPaperBalance(userId: string, chain: 'EVM' | 'SOLANA', amount: number): Promise<number> {
    const balances = await this.getOrCreatePaperBalancesAsync(userId);
    const key = chain === 'EVM' ? 'evm' : 'solana';
    balances[key] = parseFloat((balances[key] + amount).toFixed(8));
    this.userPaperBalances.set(userId, balances);
    await this.savePaper(userId);
    return balances[key];
  }

  public async getOrGenerateWallet(userId: string, chain: 'EVM' | 'SOLANA'): Promise<WalletInfo> {
    const existingList = await this.loadWallets(userId);

    const found = existingList.find((w) => {
      if (w.chain !== chain) return false;
      if (chain === 'SOLANA' && !isValidSolanaAddress(w.address)) return false;
      return true;
    });
    if (found) {
      const liveBalance = await this.fetchLiveBalance(found.address, found.chain);
      return {
        address: found.address,
        chain: found.chain,
        balance: liveBalance,
      };
    }

    let address = '';
    let rawPrivateKey = '';

    if (chain === 'EVM') {
      rawPrivateKey = generatePrivateKey();
      const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);
      address = account.address;
    } else {

      const kp = Keypair.generate();
      address = kp.publicKey.toBase58();
      rawPrivateKey = Buffer.from(kp.secretKey).toString('base64');
    }

    const { ciphertext, iv, authTag } = encryptKey(rawPrivateKey, this.masterKey);
    const stored: StoredWallet = {
      address,
      chain,
      ciphertext,
      iv,
      authTag,
    };

    existingList.push(stored);
    this.userWallets.set(userId, existingList);
    await this.saveWallets(userId);

    const liveBalance = await this.fetchLiveBalance(address, chain);

    return {
      address,
      chain,
      balance: liveBalance,
    };
  }

  public async getWallets(userId: string, mode: 'live' | 'paper' = 'live'): Promise<WalletInfo[]> {
    const list = await this.loadWallets(userId);
    const results: WalletInfo[] = [];
    const paperBalances = mode === 'paper' ? await this.getOrCreatePaperBalancesAsync(userId) : null;

    for (const w of list) {

      if (w.chain === 'SOLANA' && !isValidSolanaAddress(w.address)) continue;
      let balance = 0;
      if (mode === 'paper') {
        balance = w.chain === 'EVM' ? paperBalances!.evm : paperBalances!.solana;
      } else {
        balance = await this.fetchLiveBalance(w.address, w.chain);
      }

      results.push({
        address: w.address,
        chain: w.chain,
        balance,
      });
    }

    return results;
  }

  public async fetchLiveBalance(address: string, chain: 'EVM' | 'SOLANA'): Promise<number> {
    const cacheKey = `${chain}:${address}`;
    const cached = this.cachedBalances.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 10000) {
      return cached.balance;
    }

    let balance = 0;

    try {
      if (chain === 'EVM') {
        const rawBal = await this.evmClient.getBalance({
          address: address as `0x${string}`,
        });
        balance = parseFloat(Number(formatEther(rawBal)).toFixed(8));
      } else if (chain === 'SOLANA') {

        const res = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [address],
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as { result?: { value?: number } };
          const lamports = data.result?.value || 0;
          balance = parseFloat((lamports / 1e9).toFixed(8));
        }
      }
    } catch {

      balance = 0;
    }

    this.cachedBalances.set(cacheKey, { balance, timestamp: Date.now() });
    return balance;
  }

  public async getDecryptedPrivateKey(userId: string, chain: 'EVM' | 'SOLANA'): Promise<string> {
    const list = await this.loadWallets(userId);
    const found = list.find((w) => w.chain === chain);
    if (!found) {
      throw new Error(`No ${chain} wallet found for user ${userId}`);
    }

    const { plaintext, usedPrevious } = decryptWithRotation(
      {
        ciphertext: found.ciphertext,
        iv: found.iv,
        authTag: found.authTag,
      },
      this.masterKey,
      this.previousMasterKey
    );
    if (usedPrevious) {
      console.warn(`security event: wallet decrypted with previous master key user=${userId} chain=${chain} (auto-migrating to current master key)`);
      try {
        const reEncrypted = encryptKey(plaintext, this.masterKey);
        found.ciphertext = reEncrypted.ciphertext;
        found.iv = reEncrypted.iv;
        found.authTag = reEncrypted.authTag;
        await this.saveWallets(userId);
        console.log(`security event: wallet successfully re-encrypted with current master key user=${userId} chain=${chain}`);
      } catch (reEncryptErr) {
        console.error(`security error: failed to re-encrypt wallet user=${userId} chain=${chain}:`, (reEncryptErr as Error).message);
      }
    }
    return plaintext;
  }

  public async getVaultBalances(userId: string): Promise<PaperBalances> {
    return this.loadVault(userId);
  }

  public async sweepBalances(userId: string, options: BalanceSweepOptions): Promise<SweepResult> {
    const { chain, vaultAddress, reserveAmount = 0, sweepAmount, mode = 'paper' } = options;

    if (!vaultAddress || typeof vaultAddress !== 'string' || vaultAddress.trim().length === 0) {
      return {
        status: 'FAILED',
        chain,
        sweptAmount: 0,
        remainingBalance: 0,
        vaultAddress: vaultAddress || '',
        reason: 'Invalid or missing vaultAddress',
      };
    }

    if (chain === 'SOLANA') {
      if (!isValidSolanaAddress(vaultAddress)) {
        return {
          status: 'FAILED',
          chain,
          sweptAmount: 0,
          remainingBalance: 0,
          vaultAddress,
          reason: 'Invalid Solana vault address format',
        };
      }
    } else if (chain === 'EVM') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(vaultAddress)) {
        return {
          status: 'FAILED',
          chain,
          sweptAmount: 0,
          remainingBalance: 0,
          vaultAddress,
          reason: 'Invalid EVM vault address format',
        };
      }
    } else {
      return {
        status: 'FAILED',
        chain,
        sweptAmount: 0,
        remainingBalance: 0,
        vaultAddress,
        reason: 'Unsupported chain for sweeping',
      };
    }

    if (mode === 'paper') {
      const paperKey = chain === 'EVM' ? 'evm' : 'solana';
      const paperBal = await this.getOrCreatePaperBalancesAsync(userId);
      const currentBal = paperBal[paperKey];

      let toSweep = 0;
      if (typeof sweepAmount === 'number' && sweepAmount > 0) {
        toSweep = sweepAmount;
      } else {
        toSweep = currentBal - reserveAmount;
      }

      toSweep = parseFloat(toSweep.toFixed(8));

      if (toSweep <= 0) {
        return {
          status: 'SKIPPED',
          chain,
          sweptAmount: 0,
          remainingBalance: currentBal,
          vaultAddress,
          reason: `Balance ${currentBal} is less than or equal to reserve ${reserveAmount}`,
        };
      }

      if (currentBal < toSweep) {
        return {
          status: 'SKIPPED',
          chain,
          sweptAmount: 0,
          remainingBalance: currentBal,
          vaultAddress,
          reason: `Insufficient balance ${currentBal} to sweep ${toSweep}`,
        };
      }

      const deducted = await this.deductPaperBalance(userId, chain, toSweep);
      if (!deducted) {
        return {
          status: 'FAILED',
          chain,
          sweptAmount: 0,
          remainingBalance: currentBal,
          vaultAddress,
          reason: 'Failed to deduct paper balance during sweep',
        };
      }

      const vault = await this.loadVault(userId);
      vault[paperKey] = parseFloat((vault[paperKey] + toSweep).toFixed(8));
      this.userVaultBalances.set(userId, vault);
      await this.saveVault(userId);

      const remaining = parseFloat((currentBal - toSweep).toFixed(8));
      return {
        status: 'SUCCESS',
        chain,
        sweptAmount: toSweep,
        remainingBalance: remaining,
        vaultAddress,
        txHash: `paper_sweep_${crypto.randomBytes(8).toString('hex')}`,
      };
    }

    // LIVE MODE
    if (process.env.ALLOW_LIVE_TRADING !== 'true') {
      return {
        status: 'FAILED',
        chain,
        sweptAmount: 0,
        remainingBalance: 0,
        vaultAddress,
        reason: 'Live balance sweeping disabled: ALLOW_LIVE_TRADING is not true',
      };
    }

    const wallets = await this.loadWallets(userId);
    const sourceWallet = wallets.find((w) => w.chain === chain);
    if (!sourceWallet) {
      return {
        status: 'FAILED',
        chain,
        sweptAmount: 0,
        remainingBalance: 0,
        vaultAddress,
        reason: `No ${chain} source wallet found for user ${userId}`,
      };
    }

    const currentLiveBalance = await this.fetchLiveBalance(sourceWallet.address, chain);

    let toSweep = 0;
    if (typeof sweepAmount === 'number' && sweepAmount > 0) {
      toSweep = sweepAmount;
    } else {
      toSweep = currentLiveBalance - reserveAmount;
    }

    toSweep = parseFloat(toSweep.toFixed(8));

    if (toSweep <= 0) {
      return {
        status: 'SKIPPED',
        chain,
        sweptAmount: 0,
        remainingBalance: currentLiveBalance,
        vaultAddress,
        reason: `Current balance ${currentLiveBalance} <= reserve ${reserveAmount}`,
      };
    }

    let txHash: string;
    const decryptedKey = await this.getDecryptedPrivateKey(userId, chain);

    try {
      if (chain === 'EVM') {
        const account = privateKeyToAccount(decryptedKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: base,
          transport: http('https://mainnet.base.org'),
        });

        const hash = await walletClient.sendTransaction({
          to: vaultAddress as `0x${string}`,
          value: parseEther(toSweep.toString()),
        });
        txHash = hash;
      } else {
        const secretKeyBuf = Buffer.from(decryptedKey, 'base64');
        const keypair = Keypair.fromSecretKey(secretKeyBuf);
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

        const lamports = Math.round(toSweep * 1e9);
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(vaultAddress),
            lamports,
          })
        );

        const sig = await connection.sendTransaction(transaction, [keypair]);
        txHash = sig;
      }
    } catch (err: unknown) {
      return {
        status: 'FAILED',
        chain,
        sweptAmount: 0,
        remainingBalance: currentLiveBalance,
        vaultAddress,
        reason: `On-chain transfer failed: ${(err as Error).message}`,
      };
    } finally {
      // Ephemeral memory safety hygiene
    }

    const remaining = parseFloat(Math.max(0, currentLiveBalance - toSweep).toFixed(8));
    this.cachedBalances.delete(`${chain}:${sourceWallet.address}`);

    return {
      status: 'SUCCESS',
      chain,
      sweptAmount: toSweep,
      remainingBalance: remaining,
      vaultAddress,
      txHash,
    };
  }
}
