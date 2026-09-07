import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TradeService } from '../../src/services/trade.service';
import { WalletService } from '../../src/services/wallet.service';
import * as executionModule from '../../src/trade/execution/index.js';

describe('TradeService', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let walletService: WalletService;
  let tradeService: TradeService;

  beforeEach(() => {
    walletService = new WalletService(masterKey);
    tradeService = new TradeService(walletService);
  });

  it('executes quick-buy and creates an active position with Moonbag tracking', async () => {
    const result = await tradeService.executeQuickBuy({
      userId: 'user_trade_1',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      tokenSymbol: 'NECTAR',
      chain: 'BASE',
      amountIn: 0.1,
      slippagePercent: 5,
      enableMoonbagAutoTp: true,
      entryMcap: 24500,
      isPaper: true,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.moonbagActive).toBe(true);

    const positions = await tradeService.getPositions('user_trade_1', true);
    expect(positions).toHaveLength(1);
    expect(positions[0].tokenSymbol).toBe('NECTAR');
    expect(positions[0].amountIn).toBe(0.1);
    expect(positions[0].moonbagActive).toBe(true);
  });

  it('allows closing or partially selling a position', async () => {
    await tradeService.executeQuickBuy({
      userId: 'user_trade_2',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      tokenSymbol: 'NECTAR',
      chain: 'BASE',
      amountIn: 0.2,
      slippagePercent: 5,
      enableMoonbagAutoTp: false,
      entryMcap: 24500,
      isPaper: true,
    });

    const positions = await tradeService.getPositions('user_trade_2', true);
    const positionId = positions[0].id;

    const sellResult = await tradeService.closePosition('user_trade_2', positionId, 50, true);
    expect(sellResult.status).toBe('SUCCESS');
    expect(sellResult.percentageSold).toBe(50);

    const updatedPositions = await tradeService.getPositions('user_trade_2', true);
    expect(updatedPositions[0].amountIn).toBeCloseTo(0.1);
  });

  it('blocks LIVE execution by default (fail-closed)', async () => {
    await expect(tradeService.executeQuickBuy({
      userId: 'user_live_blocked',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      tokenSymbol: 'NECTAR',
      chain: 'BASE',
      amountIn: 0.1,
      slippagePercent: 5,
    })).rejects.toThrow(/LIVE trading disabled/);
  });

  it('executes paper trade, updates live PnL, and credits balance on close', async () => {
    await walletService.getOrGenerateWallet('user_paper', 'EVM');
    const buyRes = await tradeService.executeQuickBuy({
      userId: 'user_paper',
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'TEST',
      chain: 'BASE',
      amountIn: 0.5,
      slippagePercent: 5,
      isPaper: true,
      entryPriceUsd: 1.0,
    });

    expect(buyRes.status).toBe('SUCCESS');
    const positions = await tradeService.getPositions('user_paper', true);
    expect(positions).toHaveLength(1);
    expect(positions[0].entryPriceUsd).toBe(1.0);

    tradeService.updatePositionsPrice(new Map([['0x1111111111111111111111111111111111111111', 1.5]]));
    const updated = await tradeService.getPositions('user_paper', true);
    expect(updated[0].pnlPercent).toBeCloseTo(50.0);

    const closeRes = await tradeService.closePosition('user_paper', positions[0].id, 100, true, 1.5);
    expect(closeRes.status).toBe('SUCCESS');
    const afterClose = await tradeService.getPositions('user_paper', true);
    expect(afterClose).toHaveLength(0);
  });

  it('dispatches to on-chain executor in live trading mode when ALLOW_LIVE_TRADING is true', async () => {
    process.env.ALLOW_LIVE_TRADING = 'true';
    const mockTx = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const execSpy = vi.spyOn(executionModule, 'executeEvmSwap').mockResolvedValue({
      status: 'SUCCESS',
      txHash: mockTx,
      receiptStatus: 'success',
    });

    try {
      await walletService.getOrGenerateWallet('user_live_exec', 'EVM');
      const buyRes = await tradeService.executeQuickBuy({
        userId: 'user_live_exec',
        tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
        tokenSymbol: 'NECTAR',
        chain: 'BASE',
        amountIn: 0.05,
        slippagePercent: 1.0,
        isPaper: false,
      });

      expect(buyRes.status).toBe('SUCCESS');
      expect(buyRes.simulated).toBe(false);
      expect(buyRes.txHash).toBe(mockTx);
      expect(execSpy).toHaveBeenCalledTimes(1);

      const livePositions = await tradeService.getPositions('user_live_exec', false);
      expect(livePositions).toHaveLength(1);
      expect(livePositions[0].isPaper).toBe(false);
    } finally {
      delete process.env.ALLOW_LIVE_TRADING;
    }
  });

});

