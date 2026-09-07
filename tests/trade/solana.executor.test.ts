import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { executeSolanaSwap } from '../../src/trade/execution/solana.executor.js';

describe('SolanaExecutor - Jupiter v6 & Pump.fun on-chain swaps', () => {
  const testKeypair = Keypair.generate();
  const validToken = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates slippage and parameters before requesting quotes', async () => {
    await expect(
      executeSolanaSwap(testKeypair, {
        tokenAddress: validToken,
        amountSol: 0.1,
        slippageBps: 5, // below 10 min
      })
    ).rejects.toThrow(/slippage/i);

    await expect(
      executeSolanaSwap(testKeypair, {
        tokenAddress: 'invalid-address',
        amountSol: 0.1,
        slippageBps: 100,
      })
    ).rejects.toThrow(/token/i);
  });

  it('fetches Jupiter quote and executes signed swap transaction', async () => {
    const mockQuoteResponse = {
      inputMint: 'So11111111111111111111111111111111111111112',
      inAmount: '100000000',
      outputMint: validToken,
      outAmount: '5000000000',
      otherAmountThreshold: '4950000000',
      swapMode: 'ExactIn',
      slippageBps: 100,
      routePlan: [],
    };

    const messageV0 = new MessageV0({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
      },
      staticAccountKeys: [testKeypair.publicKey, new PublicKey(validToken)],
      recentBlockhash: '11111111111111111111111111111111',
      compiledInstructions: [],
      addressTableLookups: [],
    });

    const dummyTx = new VersionedTransaction(messageV0);
    const serializedDummyTx = Buffer.from(dummyTx.serialize()).toString('base64');

    const fetchSpy = vi.fn().mockImplementation(async (info: any) => {
      const urlStr = typeof info === 'string' ? info : info?.url || String(info);
      if (urlStr.endsWith('/swap') || urlStr.includes('/v6/swap')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ swapTransaction: serializedDummyTx }),
          json: async () => ({ swapTransaction: serializedDummyTx }),
        };
      }
      if (urlStr.includes('/v6/quote') || urlStr.includes('/quote')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockQuoteResponse),
          json: async () => mockQuoteResponse,
        };
      }
      return { ok: false, status: 404, text: async () => 'Not found', json: async () => ({}) };
    });

    vi.stubGlobal('fetch', fetchSpy);

    const mockSendRawTransaction = vi.fn().mockResolvedValue('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBGMjPJqR4qF9Bxfhr2g1FNCoqMmVK2vFP6nn');
    const mockConfirmTransaction = vi.fn().mockResolvedValue({ value: { err: null } });

    const result = await executeSolanaSwap(
      testKeypair,
      {
        tokenAddress: validToken,
        amountSol: 0.1,
        slippageBps: 100,
      },
      {
        sendRawTransaction: mockSendRawTransaction,
        confirmTransaction: mockConfirmTransaction,
      } as any
    );

    expect(result.status).toBe('SUCCESS');
    expect(result.txHash).toBe('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBGMjPJqR4qF9Bxfhr2g1FNCoqMmVK2vFP6nn');
    expect(result.tokensExpected).toBe(5000000000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
