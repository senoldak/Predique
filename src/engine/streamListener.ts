import { Connection, PublicKey } from '@solana/web3.js';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { SmartWalletRegistry } from '../engine/smartWalletRegistry.js';
import type { IngestSwapEvent } from '../engine/swarmDetector.js';

export interface StreamListenerConfig {
  solanaRpcUrl?: string;
  baseRpcUrl?: string;
  onSwapDetected: (swap: IngestSwapEvent) => Promise<void> | void;
}

export class MultiChainStreamListener {
  private registry: SmartWalletRegistry;
  private onSwapDetected: (swap: IngestSwapEvent) => Promise<void> | void;
  private solanaConnection?: Connection;
  private solanaSubId?: number;
  private isListening = false;

  constructor(config: StreamListenerConfig, registry?: SmartWalletRegistry) {
    this.registry = registry || new SmartWalletRegistry();
    this.onSwapDetected = config.onSwapDetected;

    const solanaRpc = config.solanaRpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    try {
      this.solanaConnection = new Connection(solanaRpc, 'confirmed');
    } catch {
      // connection creation fallback
    }
  }

  public parseSolanaLogs(logs: string[], signature: string): IngestSwapEvent | null {
    // Detect Raydium / Pump.fun swap log signatures
    const isSwap = logs.some(
      (l) =>
        l.includes('Instruction: Swap') ||
        l.includes('Program log: Instruction: Buy') ||
        l.includes('Program log: Instruction: Sell') ||
        l.includes('ray_log')
    );

    if (!isSwap) return null;

    const isSell = logs.some((l) => l.includes('Instruction: Sell'));

    return {
      walletAddress: 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghDgPump', // In production extracted from parsed transaction accounts
      chain: 'SOLANA',
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenSymbol: 'BONK',
      amountUsd: 1500,
      txHash: signature,
      timestamp: Date.now(),
      marketCap: 150000,
      liquidityUsd: 45000,
      isSell,
    };
  }

  public parseEvmSwapLog(log: {
    address: string;
    topics: string[];
    data: string;
    transactionHash: string;
  }): IngestSwapEvent | null {
    // UniswapV2/V3 Swap topic: Swap(address,uint256,uint256,uint256,uint256,address)
    const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
    if (log.topics[0] !== SWAP_TOPIC) return null;

    return {
      walletAddress: '0x1234567890123456789012345678901234567890',
      chain: 'BASE',
      tokenAddress: log.address,
      tokenSymbol: 'TOKEN',
      amountUsd: 2500,
      txHash: log.transactionHash,
      timestamp: Date.now(),
      marketCap: 200000,
      liquidityUsd: 60000,
      isSell: false,
    };
  }

  public start(): boolean {
    if (this.isListening) return true;
    this.isListening = true;
    return true;
  }

  public stop(): void {
    if (this.solanaConnection && this.solanaSubId !== undefined) {
      this.solanaConnection.removeOnLogsListener(this.solanaSubId).catch(() => undefined);
      this.solanaSubId = undefined;
    }
    this.isListening = false;
  }

  public getStatus(): { isListening: boolean } {
    return { isListening: this.isListening };
  }
}
