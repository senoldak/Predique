import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';

describe('Balance Sweeper & Automated Rebalancing System', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let walletService: WalletService;
  let redis: Redis;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    walletService = new WalletService(masterKey, redis);
  });

  describe('WalletService.sweepBalances (Paper Mode)', () => {
    it('sweeps EVM paper balance to vault address while preserving reserve amount', async () => {
      const userId = 'user_paper_evm';
      const vaultAddress = '0x1111111111111111111111111111111111111111';

      // Default EVM paper balance is 1.5 ETH
      const initial = await walletService.getOrCreatePaperBalancesAsync(userId);
      expect(initial.evm).toBe(1.5);

      await walletService.getOrGenerateWallet(userId, 'EVM');

      // Sweep everything above 0.5 ETH reserve
      const sweepRes = await walletService.sweepBalances(userId, {
        chain: 'EVM',
        vaultAddress,
        reserveAmount: 0.5,
        mode: 'paper',
      });

      expect(sweepRes.status).toBe('SUCCESS');
      expect(sweepRes.sweptAmount).toBe(1.0);
      expect(sweepRes.remainingBalance).toBe(0.5);
      expect(sweepRes.vaultAddress).toBe(vaultAddress);
      expect(sweepRes.txHash).toMatch(/^paper_sweep_/);

      // Verify wallet paper balance updated
      const updatedWallets = await walletService.getWallets(userId, 'paper');
      const evmWallet = updatedWallets.find((w) => w.chain === 'EVM');
      expect(evmWallet?.balance).toBe(0.5);

      const paperBalances = await walletService.getOrCreatePaperBalancesAsync(userId);
      expect(paperBalances.evm).toBe(0.5);

      // Verify vault balance credited
      const vault = await walletService.getVaultBalances(userId);
      expect(vault.evm).toBe(1.0);
    });

    it('sweeps Solana paper balance to vault address for exact sweepAmount', async () => {
      const userId = 'user_paper_sol';
      const vaultAddress = '5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CmPEwKgV4Gv';

      // Default Solana paper balance is 10.0 SOL
      const initial = await walletService.getOrCreatePaperBalancesAsync(userId);
      expect(initial.solana).toBe(10.0);

      // Sweep exact 3.5 SOL
      const sweepRes = await walletService.sweepBalances(userId, {
        chain: 'SOLANA',
        vaultAddress,
        sweepAmount: 3.5,
        reserveAmount: 2.0,
        mode: 'paper',
      });

      expect(sweepRes.status).toBe('SUCCESS');
      expect(sweepRes.sweptAmount).toBe(3.5);
      expect(sweepRes.remainingBalance).toBe(6.5);

      const vault = await walletService.getVaultBalances(userId);
      expect(vault.solana).toBe(3.5);
    });

    it('skips sweep when current balance is less than or equal to reserve', async () => {
      const userId = 'user_skip_test';
      const vaultAddress = '0x1111111111111111111111111111111111111111';

      // Default EVM balance is 1.5 ETH, reserve is set to 2.0 ETH
      const sweepRes = await walletService.sweepBalances(userId, {
        chain: 'EVM',
        vaultAddress,
        reserveAmount: 2.0,
        mode: 'paper',
      });

      expect(sweepRes.status).toBe('SKIPPED');
      expect(sweepRes.sweptAmount).toBe(0);
      expect(sweepRes.remainingBalance).toBe(1.5);
      expect(sweepRes.reason).toContain('is less than or equal to reserve');
    });

    it('validates vault address format and rejects invalid addresses', async () => {
      const userId = 'user_val_test';

      const invalidEvm = await walletService.sweepBalances(userId, {
        chain: 'EVM',
        vaultAddress: 'invalid-address',
        mode: 'paper',
      });
      expect(invalidEvm.status).toBe('FAILED');
      expect(invalidEvm.reason).toContain('Invalid EVM vault address');

      const invalidSol = await walletService.sweepBalances(userId, {
        chain: 'SOLANA',
        vaultAddress: '0xnot_a_solana_address',
        mode: 'paper',
      });
      expect(invalidSol.status).toBe('FAILED');
      expect(invalidSol.reason).toContain('Invalid Solana vault address');
    });
  });

  describe('WalletService.sweepBalances (Live Mode Safety Barrier)', () => {
    it('strictly blocks live on-chain sweep when ALLOW_LIVE_TRADING !== true', async () => {
      const oldEnv = process.env.ALLOW_LIVE_TRADING;
      process.env.ALLOW_LIVE_TRADING = 'false';

      try {
        const userId = 'user_live_blocked';
        const sweepRes = await walletService.sweepBalances(userId, {
          chain: 'EVM',
          vaultAddress: '0x1111111111111111111111111111111111111111',
          reserveAmount: 0.1,
          mode: 'live',
        });

        expect(sweepRes.status).toBe('FAILED');
        expect(sweepRes.reason).toContain('Live balance sweeping disabled: ALLOW_LIVE_TRADING is not true');
      } finally {
        process.env.ALLOW_LIVE_TRADING = oldEnv;
      }
    });

    it('handles live mode with ALLOW_LIVE_TRADING enabled without leaking private keys', async () => {
      const oldEnv = process.env.ALLOW_LIVE_TRADING;
      process.env.ALLOW_LIVE_TRADING = 'true';

      try {
        const userId = 'user_live_active';
        await walletService.getOrGenerateWallet(userId, 'EVM');

        // Mock fetchLiveBalance to return 2.0 ETH
        vi.spyOn(walletService, 'fetchLiveBalance').mockResolvedValue(2.0);

        // When sweep is executed without mock rpc, it will fail gracefully at network level without key leak
        const sweepRes = await walletService.sweepBalances(userId, {
          chain: 'EVM',
          vaultAddress: '0x1111111111111111111111111111111111111111',
          reserveAmount: 0.5,
          mode: 'live',
        });

        // Either succeeded or network call failed gracefully with error reason
        if (sweepRes.status === 'FAILED') {
          expect(sweepRes.reason).toContain('On-chain transfer failed');
          // Private key must never appear in error reason or logs
          expect(sweepRes.reason).not.toMatch(/0x[0-9a-fA-F]{64}/);
        }
      } finally {
        process.env.ALLOW_LIVE_TRADING = oldEnv;
      }
    });
  });

  describe('AutoTradeService Automated Sweeper Integration', () => {
    let tradeService: TradeService;
    let autoTradeService: AutoTradeService;

    beforeEach(() => {
      tradeService = new TradeService(walletService, redis);
      autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 100);
    });

    afterEach(() => {
      autoTradeService.destroy();
    });

    it('triggers auto-sweep on profitable position exit when balance exceeds threshold', async () => {
      const vaultAddress = '0x2222222222222222222222222222222222222222';

      autoTradeService.updateConfig({
        enabled: true,
        mode: 'PAPER',
        takeProfitPercent: 20,
        trailingStopPercent: 10,
        autoSweepEnabled: true,
        autoSweepThresholdNative: 1.2, // threshold is 1.2 ETH
        autoSweepReserveNative: 0.5,   // keep 0.5 ETH reserve
        vaultAddress,
      });

      const events: any[] = [];
      autoTradeService.onTradeEvent((ev) => events.push(ev));

      // 1. Process signal to open a paper trade
      const mockSignal: PublicTokenSignal = {
        id: 'sig_sweep_test',
        tokenAddress: '0x1234567890123456789012345678901234567890',
        tokenSymbol: 'SWEEP_TOKEN',
        chain: 'BASE',
        mcap: 100000,
        liquidity: 30000,
        liqRatio: 30,
        rating: 'ROYAL_HONEY',
        earlySelling: false,
        pileInTime: '15 buys/5m',
        ageMinutes: 45,
        smartWalletsCount: 5,
        priceUsd: 1.0,
        timestamp: Date.now(),
        reasons: [],
      };

      const opened = await autoTradeService.processSignal(mockSignal);
      expect(opened).toBe(true);

      const positions = autoTradeService.getAutoPositions();
      expect(positions.length).toBe(1);
      const pos = positions[0];

      // 2. Simulate TP1 exit (+30% gain)
      await autoTradeService.evaluateActivePositions(new Map([[pos.tokenAddress.toLowerCase(), 1.30]]));

      // 3. Simulate trailing stop exit
      await autoTradeService.evaluateActivePositions(new Map([[pos.tokenAddress.toLowerCase(), 1.15]]));

      // 4. Verify that sweep event was emitted or triggerAutoSweepIfNeeded ran
      const sweepEvents = events.filter((e) => e.type === 'AUTOTRADE_SWEEP');
      expect(sweepEvents.length).toBeGreaterThanOrEqual(1);

      const sweepEv = sweepEvents[0].data;
      expect(sweepEv.vaultAddress).toBe(vaultAddress);
      expect(sweepEv.chain).toBe('EVM');
      expect(sweepEv.sweptAmount).toBeGreaterThan(0);
      expect(sweepEv.remainingBalance).toBe(0.5);

      // Verify paper vault recorded the surplus
      const vaultBalances = await walletService.getVaultBalances(pos.userId);
      expect(vaultBalances.evm).toBeGreaterThan(0);
    });

    it('does not trigger auto-sweep if autoSweepEnabled is false', async () => {
      autoTradeService.updateConfig({
        enabled: true,
        mode: 'PAPER',
        autoSweepEnabled: false,
        vaultAddress: '0x2222222222222222222222222222222222222222',
      });

      const events: any[] = [];
      autoTradeService.onTradeEvent((ev) => events.push(ev));

      await autoTradeService.triggerAutoSweepIfNeeded('user_no_sweep', 'EVM', 'paper');
      const sweepEvents = events.filter((e) => e.type === 'AUTOTRADE_SWEEP');
      expect(sweepEvents.length).toBe(0);
    });
  });
});
