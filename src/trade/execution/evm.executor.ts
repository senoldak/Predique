import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, mainnet, bsc } from 'viem/chains';
import { isValidEvmAddress, validateTradeAmount } from '../../utils/sanitize.js';
import { getProtectedEvmRpc } from './mev.js';

export interface EvmSwapParams {
  chain: 'BASE' | 'ETH' | 'BNB' | 'ROBINHOOD';
  tokenAddress: string;
  amountInEth: number;
  slippagePercent: number;
  rpcUrl?: string;
  deadlineMinutes?: number;
  useMevProtection?: boolean;
}


export interface EvmSwapResult {
  status: 'SUCCESS' | 'FAILED';
  txHash: string;
  receiptStatus?: string;
  error?: string;
}

const UNISWAP_V2_ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
    ],
    name: 'getAmountsOut',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

export const CHAIN_ROUTER_CONFIG: Record<
  string,
  { chain: Chain; routerAddress: `0x${string}`; wethAddress: `0x${string}`; defaultRpc: string }
> = {
  BASE: {
    chain: base,
    routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Base Uniswap V2 Router
    wethAddress: '0x4200000000000000000000000000000000000006', // WETH on Base
    defaultRpc: 'https://mainnet.base.org',
  },
  ETH: {
    chain: mainnet,
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router02
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    defaultRpc: 'https://cloudflare-eth.com',
  },
  BNB: {
    chain: bsc,
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 Router
    wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    defaultRpc: 'https://bsc-dataseed.binance.org',
  },
  ROBINHOOD: {
    chain: base,
    routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    wethAddress: '0x4200000000000000000000000000000000000006',
    defaultRpc: 'https://mainnet.base.org',
  },
};

export async function executeEvmSwap(
  privateKeyHex: string,
  params: EvmSwapParams,
  clientsOverride?: { publicClient?: any; walletClient?: any }
): Promise<EvmSwapResult> {
  const chainKey = params.chain.toUpperCase();
  const config = CHAIN_ROUTER_CONFIG[chainKey];
  if (!config) {
    throw new Error(`Unsupported EVM chain: ${params.chain}`);
  }

  if (!isValidEvmAddress(params.tokenAddress)) {
    throw new Error(`Invalid EVM tokenAddress: ${params.tokenAddress}`);
  }

  if (!validateTradeAmount(params.amountInEth) || params.amountInEth <= 0) {
    throw new Error(`Invalid amountInEth: ${params.amountInEth}`);
  }

  if (!Number.isFinite(params.slippagePercent) || params.slippagePercent <= 0 || params.slippagePercent > 50) {
    throw new Error(`Invalid slippagePercent: ${params.slippagePercent}. Must be within (0, 50].`);
  }

  const account = privateKeyToAccount(
    (privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`) as `0x${string}`
  );

  const rpcToUse =
    params.rpcUrl ||
    (params.useMevProtection !== false ? getProtectedEvmRpc(params.chain) : config.defaultRpc);

  const publicClient =
    clientsOverride?.publicClient ||
    createPublicClient({
      chain: config.chain,
      transport: http(rpcToUse),
    });

  const walletClient =
    clientsOverride?.walletClient ||
    createWalletClient({
      account,
      chain: config.chain,
      transport: http(rpcToUse),
    });


  const amountInWei = parseEther(params.amountInEth.toString());
  const path = [config.wethAddress, params.tokenAddress as `0x${string}`] as const;

  let amountOutMin = 0n;
  try {
    const amounts = (await publicClient.readContract({
      address: config.routerAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountInWei, path as any],
    })) as [bigint, bigint];

    const expectedOut = amounts[1];
    const slippageMultiplier = 1 - params.slippagePercent / 100;
    amountOutMin = BigInt(Math.floor(Number(expectedOut) * slippageMultiplier));
  } catch {
    amountOutMin = 0n;
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineMinutes || 10) * 60);

  const txHash = (await walletClient.writeContract({
    address: config.routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: [amountOutMin, path as any, account.address, deadline],
    value: amountInWei,
  })) as `0x${string}`;

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    status: 'SUCCESS',
    txHash,
    receiptStatus: receipt?.status,
  };
}
