import { describe, it, expect, vi } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { executeEvmSwap, type EvmSwapParams } from '../../src/trade/execution/evm.executor.js';

describe('EvmExecutor - Uniswap / Aerodrome on-chain swaps with viem', () => {
  const testPrivateKey = generatePrivateKey();
  const validToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC

  it('validates chain and parameter bounds', async () => {
    await expect(
      executeEvmSwap(testPrivateKey, {
        chain: 'BASE',
        tokenAddress: 'invalid-address',
        amountInEth: 0.05,
        slippagePercent: 1.0,
      })
    ).rejects.toThrow(/token/i);

    await expect(
      executeEvmSwap(testPrivateKey, {
        chain: 'BASE',
        tokenAddress: validToken,
        amountInEth: -1,
        slippagePercent: 1.0,
      })
    ).rejects.toThrow(/amount/i);

    await expect(
      executeEvmSwap(testPrivateKey, {
        chain: 'BASE',
        tokenAddress: validToken,
        amountInEth: 0.05,
        slippagePercent: 60, // exceeds 50% max
      })
    ).rejects.toThrow(/slippage/i);
  });

  it('dispatches swap transaction using router ABI', async () => {
    const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const mockPublicClient = {
      readContract: vi.fn().mockResolvedValue([10000000000000000n, 50000000n]), // getAmountsOut
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 12345n }),
    };

    const mockWalletClient = {
      writeContract: vi.fn().mockResolvedValue(mockTxHash),
    };

    const result = await executeEvmSwap(
      testPrivateKey,
      {
        chain: 'BASE',
        tokenAddress: validToken,
        amountInEth: 0.01,
        slippagePercent: 1.0,
      },
      {
        publicClient: mockPublicClient as any,
        walletClient: mockWalletClient as any,
      }
    );

    expect(result.status).toBe('SUCCESS');
    expect(result.txHash).toBe(mockTxHash);
    expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: mockTxHash });
  });
});
