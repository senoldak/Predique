import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiChainStreamListener } from '../../src/engine/streamListener.js';
import { SmartWalletRegistry } from '../../src/engine/smartWalletRegistry.js';

describe('MultiChainStreamListener - On-chain swap parser', () => {
  let listener: MultiChainStreamListener;
  let detectedSwaps: any[] = [];

  beforeEach(() => {
    detectedSwaps = [];
    listener = new MultiChainStreamListener({
      onSwapDetected: (swap) => {
        detectedSwaps.push(swap);
      },
    });
  });

  it('correctly parses Raydium/Pump.fun swap logs on Solana', () => {
    const raydiumLogs = [
      'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
      'Program log: ray_log: AAAAABBBBBCCCCCDDDDD',
      'Program log: Instruction: Swap',
      'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success',
    ];

    const result = listener.parseSolanaLogs(raydiumLogs, '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBGMjPJqR4qF9Bxfhr2g1FNCoqMmVK2vFP6nn');
    expect(result).not.toBeNull();
    expect(result?.chain).toBe('SOLANA');
    expect(result?.isSell).toBe(false);
    expect(result?.tokenAddress).toBe('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  });

  it('ignores non-swap Solana logs', () => {
    const transferLogs = [
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
      'Program log: Instruction: Transfer',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
    ];

    const result = listener.parseSolanaLogs(transferLogs, '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBGMjPJqR4qF9Bxfhr2g1FNCoqMmVK2vFP6nn');
    expect(result).toBeNull();
  });

  it('correctly parses Uniswap-style swap logs on EVM', () => {
    const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
    const log = {
      address: '0x4200000000000000000000000000000000000006',
      topics: [SWAP_TOPIC, '0x00', '0x00'],
      data: '0x00000000000000000000000000000000',
      transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    };

    const result = listener.parseEvmSwapLog(log);
    expect(result).not.toBeNull();
    expect(result?.chain).toBe('BASE');
    expect(result?.txHash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
  });

  it('starts and stops gracefully', () => {
    expect(listener.getStatus().isListening).toBe(false);
    listener.start();
    expect(listener.getStatus().isListening).toBe(true);
    listener.stop();
    expect(listener.getStatus().isListening).toBe(false);
  });
});
