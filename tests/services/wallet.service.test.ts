import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { WalletService } from '../../src/services/wallet.service';
import { isValidSolanaAddress } from '../../src/utils/sanitize.js';

describe('WalletService', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let walletService: WalletService;

  beforeEach(() => {
    walletService = new WalletService(masterKey);
  });

  it('generates and retrieves an EVM wallet for a user with AES-256-GCM encryption', async () => {
    const wallet = await walletService.getOrGenerateWallet('user_123', 'EVM');
    expect(wallet.chain).toBe('EVM');
    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

    const sameWallet = await walletService.getOrGenerateWallet('user_123', 'EVM');
    expect(sameWallet.address).toBe(wallet.address);
  });

  it('generates and retrieves a Solana wallet for a user', async () => {
    const wallet = await walletService.getOrGenerateWallet('user_123', 'SOLANA');
    expect(wallet.chain).toBe('SOLANA');
    expect(wallet.address.length).toBeGreaterThanOrEqual(32);
    expect(isValidSolanaAddress(wallet.address)).toBe(true);

    const secret = await walletService.getDecryptedPrivateKey('user_123', 'SOLANA');
    const restored = Keypair.fromSecretKey(Buffer.from(secret, 'base64'));
    expect(restored.publicKey.toBase58()).toBe(wallet.address);
  });

  it('lists all wallets with balances for a user without leaking private keys', async () => {
    await walletService.getOrGenerateWallet('user_456', 'EVM');
    await walletService.getOrGenerateWallet('user_456', 'SOLANA');

    const wallets = await walletService.getWallets('user_456');
    expect(wallets).toHaveLength(2);
    for (const w of wallets) {
      expect(w).toHaveProperty('address');
      expect(w).toHaveProperty('chain');
      expect(w).toHaveProperty('balance');
      expect((w as any).privateKey).toBeUndefined();
      expect((w as any).encryptedPrivateKey).toBeUndefined();
    }
  });

  it('returns virtual balances in paper mode and allows balance deduction and reset', async () => {
    await walletService.getOrGenerateWallet('user_test', 'EVM');
    await walletService.getOrGenerateWallet('user_test', 'SOLANA');

    const paperWallets = await walletService.getWallets('user_test', 'paper');
    expect(paperWallets.find((w) => w.chain === 'SOLANA')?.balance).toBe(10.0);
    expect(paperWallets.find((w) => w.chain === 'EVM')?.balance).toBe(1.5);

    const deducted = await walletService.deductPaperBalance('user_test', 'SOLANA', 2.0);
    expect(deducted).toBe(true);
    const afterDeduct = await walletService.getWallets('user_test', 'paper');
    expect(afterDeduct.find((w) => w.chain === 'SOLANA')?.balance).toBe(8.0);

    await walletService.resetPaperBalance('user_test');
    const afterReset = await walletService.getWallets('user_test', 'paper');
    expect(afterReset.find((w) => w.chain === 'SOLANA')?.balance).toBe(10.0);
  });

  it('decrypts with the previous master key during rotation', async () => {
    const oldKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const newKey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const redis = new (RedisMock as unknown as new () => Redis)();
    const wsOld = new WalletService(oldKey, redis);
    await wsOld.getOrGenerateWallet('u_rotate', 'EVM');
    const secret1 = await wsOld.getDecryptedPrivateKey('u_rotate', 'EVM');

    const wsNew = new WalletService(newKey, redis, oldKey);
    const secret2 = await wsNew.getDecryptedPrivateKey('u_rotate', 'EVM');
    expect(secret2).toBe(secret1);

    // Because of automatic re-encryption on rotation, redis is now updated with newKey!
    // Therefore, wsNoFallback (using newKey without fallback) can now decrypt it successfully.
    const wsNoFallback = new WalletService(newKey, redis);
    const secret3 = await wsNoFallback.getDecryptedPrivateKey('u_rotate', 'EVM');
    expect(secret3).toBe(secret1);

    // A service with an entirely different key cannot decrypt it
    const wrongKey = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const wsWrong = new WalletService(wrongKey, redis);
    await expect(wsWrong.getDecryptedPrivateKey('u_rotate', 'EVM')).rejects.toThrow();
  });
});
