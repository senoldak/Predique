export type RouterType = 'SOLANA_PUMPFUN' | 'SOLANA_JUPITER' | 'EVM_UNISWAP' | 'EVM_PANCAKE' | 'EVM_PONS';

export interface RouteResolution {
  type: RouterType;
  chain: string;
  tokenAddress: string;
}

export function getRouterForChain(chain: string, tokenAddress: string): RouteResolution {
  const c = chain.toLowerCase();

  if (c === 'solana') {
    if (tokenAddress.toLowerCase().endsWith('pump')) {
      return { type: 'SOLANA_PUMPFUN', chain, tokenAddress };
    }
    return { type: 'SOLANA_JUPITER', chain, tokenAddress };
  }

  if (c === 'bnb' || c === 'bsc') {
    return { type: 'EVM_PANCAKE', chain, tokenAddress };
  }

  if (c === 'robinhood') {
    return { type: 'EVM_PONS', chain, tokenAddress };
  }

  return { type: 'EVM_UNISWAP', chain, tokenAddress };
}

export interface QuickBuyParams {
  userTelegramId: number;
  chain: string;
  tokenAddress: string;
  amountInNative: number;
  slippageBps: number;
  enableMoonbag: boolean;
}

export interface QuickBuyPayload extends QuickBuyParams {
  router: RouteResolution;
  timestamp: number;
}

import { isValidEvmAddress, isValidSolanaAddress, validateTradeAmount } from '../utils/sanitize.js';

export interface PriceImpactAssessment {
  estimatedImpactPercent: number;
  tradeValueUsd: number;
  poolLiquidityUsd: number;
  severity: 'SAFE' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  recommendedSlippageBps: number;
  warning?: string;
}

export function estimateNativePriceUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'solana') return 180.0;
  if (c === 'bnb' || c === 'bsc') return 600.0;
  return 3200.0; // ETH, BASE, ARBITRUM, etc.
}

export function calculatePriceImpact(params: {
  amountInNative: number;
  chain: string;
  poolLiquidityUsd?: number;
}): PriceImpactAssessment {
  const nativePrice = estimateNativePriceUsd(params.chain);
  const tradeValueUsd = params.amountInNative * nativePrice;
  const poolLiquidityUsd = Math.max(params.poolLiquidityUsd ?? 50000, 100);

  // Constant product AMM impact approximation: dP/P ~ 2 * (dx / X)
  // where poolLiquidityUsd = 2 * X (half base, half quote)
  const estimatedImpactPercent = parseFloat(((tradeValueUsd / poolLiquidityUsd) * 100).toFixed(2));

  let severity: PriceImpactAssessment['severity'] = 'SAFE';
  let warning: string | undefined;

  if (estimatedImpactPercent >= 15) {
    severity = 'CRITICAL';
    warning = `🚨 CRITICAL PRICE IMPACT (${estimatedImpactPercent}%): Trade size ($${tradeValueUsd.toFixed(0)}) represents excessive drain on pool liquidity ($${poolLiquidityUsd.toFixed(0)}). Extreme sandwich/MEV loss risk.`;
  } else if (estimatedImpactPercent >= 7) {
    severity = 'HIGH';
    warning = `⚠️ HIGH PRICE IMPACT (${estimatedImpactPercent}%): Substantial liquidity slippage expected. Consider sizing down.`;
  } else if (estimatedImpactPercent >= 3) {
    severity = 'MODERATE';
    warning = `ℹ️ Moderate price impact (${estimatedImpactPercent}%).`;
  }

  // Recommended dynamic slippage: base 100 bps (1%) + ceil(impact * 100 * 1.5), capped at 5000 bps
  const recommendedSlippageBps = Math.min(
    5000,
    Math.max(100, Math.ceil(estimatedImpactPercent * 150))
  );

  return {
    estimatedImpactPercent,
    tradeValueUsd,
    poolLiquidityUsd,
    severity,
    recommendedSlippageBps,
    warning,
  };
}

export function buildQuickBuyPayload(params: QuickBuyParams & { poolLiquidityUsd?: number; maxAllowedPriceImpactPercent?: number }): QuickBuyPayload & { impact: PriceImpactAssessment } {
  if (!validateTradeAmount(params.amountInNative)) {
    throw new Error(`Invalid trade amount: ${params.amountInNative}. Must be a positive finite number.`);
  }

  if (!Number.isInteger(params.slippageBps) || params.slippageBps < 10 || params.slippageBps > 5000) {
    throw new Error(`Invalid slippage: ${params.slippageBps} bps. Must be between 10 (0.1%) and 5000 (50%).`);
  }

  const isSolana = params.chain.toLowerCase() === 'solana';
  const isValid = isSolana
    ? isValidSolanaAddress(params.tokenAddress)
    : isValidEvmAddress(params.tokenAddress);

  if (!isValid) {
    throw new Error(`Invalid ${params.chain} token address: ${params.tokenAddress}`);
  }

  const impact = calculatePriceImpact({
    amountInNative: params.amountInNative,
    chain: params.chain,
    poolLiquidityUsd: params.poolLiquidityUsd,
  });

  const maxImpact = params.maxAllowedPriceImpactPercent ?? 20.0;
  if (impact.estimatedImpactPercent > maxImpact) {
    throw new Error(`Trade rejected by PriceImpactGuard: estimated impact ${impact.estimatedImpactPercent}% exceeds limit of ${maxImpact}%.`);
  }

  const router = getRouterForChain(params.chain, params.tokenAddress);
  return {
    ...params,
    router,
    timestamp: Date.now(),
    impact,
  };
}
