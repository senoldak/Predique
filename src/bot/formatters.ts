export interface TopWalletInfo {
  label: string;
  winRate: number;
  volume: number;
}

export interface SignalMessagePayload {
  chain: string;
  chainTag: string;
  tokenSymbol: string;
  contractAddress: string;
  mcapUsd: number;
  liquidityUsd: number;
  liqMcRatio: number;
  ageText: string;
  tierStars: string;
  smartWalletsCount: number;
  totalSpent: number;
  currency: string;
  topWallets: TopWalletInfo[];
  buys5m: number;
  sells5m: number;
  pileInText: string;
  earlySelling: boolean;
  security?: TokenSecurityResult;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

import { escapeHtml } from '../utils/sanitize.js';
import type { TokenSecurityResult } from '../security/tokenSecurity.service.js';

export function formatCompactUsd(val: number): string {
  if (val >= 1_000_000_000) {
    return `$${(val / 1_000_000_000).toFixed(val >= 10_000_000_000 ? 1 : 2)}B`;
  }
  if (val >= 1_000_000) {
    return `$${(val / 1_000_000).toFixed(val >= 10_000_000 ? 1 : 2)}M`;
  }
  if (val >= 1_000) {
    return `$${(val / 1_000).toFixed(1)}k`;
  }
  return `$${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function formatHumanAge(ageTextOrMinutes: string | number): string {
  let minutes = 0;
  if (typeof ageTextOrMinutes === 'number') {
    minutes = ageTextOrMinutes;
  } else {
    const parsed = parseInt(String(ageTextOrMinutes).replace(/[^0-9]/g, ''), 10);
    minutes = isNaN(parsed) ? 0 : parsed;
  }
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export function renderSecurityLine(security?: TokenSecurityResult): string {
  if (!security || security.status === 'unknown') {
    return `🛡️ <b>Tax:</b> Unchecked (DYOR)`;
  }
  if (security.status === 'honeypot') {
    return `🛡️ <b>Tax:</b> 🚫 <b>HONEYPOT DETECTED</b>`;
  }
  if (security.status === 'risk') {
    return `🛡️ <b>Tax:</b> ⚠️ <b>High Risk (${security.buyTax}%/${security.sellTax}%${security.hasBlacklist ? ' · Blacklist' : ''})</b>`;
  }
  return `🛡️ <b>Tax:</b> ${security.buyTax}%/${security.sellTax}%`;
}

export function formatSignalMessage(payload: SignalMessagePayload) {
  const chainLower = payload.chain.toLowerCase();
  const safeSymbol = escapeHtml(payload.tokenSymbol.replace(/^\$/, ''));
  const safeAddress = escapeHtml(payload.contractAddress);
  const chainName = (payload.chainTag || payload.chain).toUpperCase().replace('#', '');
  const mcapFormatted = formatCompactUsd(payload.mcapUsd);
  const liqFormatted = formatCompactUsd(payload.liquidityUsd);
  const ageFormatted = formatHumanAge(payload.ageText);

  const tierUpper = (payload.tierStars || '').toUpperCase();
  let tierBadge = '⚔️ Tactical Knight';
  if (tierUpper.includes('PLATINUM') || tierUpper.includes('ROYAL') || tierUpper.includes('TIER_5') || tierUpper.includes('TIER 5') || tierUpper.includes('★★★')) {
    tierBadge = '👑 Grandmaster';
  } else if (tierUpper.includes('GOLD') || tierUpper.includes('SWARM') || tierUpper.includes('TIER_4') || tierUpper.includes('TIER 4') || tierUpper.includes('★★')) {
    tierBadge = '⚔️ Tactical Knight';
  } else if (tierUpper.includes('SILVER') || tierUpper.includes('WORKER') || tierUpper.includes('TIER_3') || tierUpper.includes('TIER 3') || tierUpper.includes('★')) {
    tierBadge = '♟️ Strategic Scout';
  }

  const dumpRiskTag = payload.earlySelling ? ' · ⚠️ Early Dump Risk' : '';
  const securityLine = renderSecurityLine(payload.security);

  const hasRealWallets = payload.topWallets && payload.topWallets.length > 0 && payload.topWallets.every((w) => w.winRate > 0);

  let flowLine = '';
  if (hasRealWallets) {
    const topW = payload.topWallets[0];
    const cleaned = topW.label.replace(/^[🐝👑\s]+/, '').replace(/^Bee\s*#\d+\s*(\((.*?)\))?/i, '$2').trim() || 'Alpha Wallet';
    flowLine = `📊 <b>Smart Flow:</b> ${escapeHtml(cleaned)}: ${topW.winRate}% WR (${topW.volume.toFixed(2)} ${payload.currency})`;
  } else {
    const net = payload.buys5m - payload.sells5m;
    const netText = net > 0 ? `+${net}` : `${net}`;
    flowLine = `📊 <b>Flow (5m):</b> ${payload.buys5m} Buys / ${payload.sells5m} Sells <code>(${netText} Net)</code>`;
  }

  const text = `♞ <b>PREDIQUE ALPHA</b> ⬝ <b>$${safeSymbol}</b> <code>[${chainName}]</code>
<code>${safeAddress}</code>

💰 <b>MCap:</b> ${mcapFormatted}  ·  💧 <b>Liq:</b> ${liqFormatted} (${payload.liqMcRatio.toFixed(1)}%)
⏳ <b>Age:</b> ${ageFormatted}  ·  ${securityLine}
🎯 <b>Tier:</b> ${tierBadge}${dumpRiskTag}
${flowLine}`;

  const curr = payload.currency;
  const p1 = curr === 'SOL' ? '0.05' : '0.01';
  const p2 = curr === 'SOL' ? '0.1' : '0.05';
  const p3 = curr === 'SOL' ? '0.25' : '0.10';

  const explorerUrl = chainLower === 'solana'
    ? `https://solscan.io/token/${payload.contractAddress}`
    : chainLower === 'base'
    ? `https://basescan.org/token/${payload.contractAddress}`
    : `https://etherscan.io/token/${payload.contractAddress}`;

  const chainCode = chainLower === 'solana' ? 'sol' : chainLower === 'base' ? 'base' : 'eth';
  const shortAddr = payload.contractAddress;

  const sniperUrl = chainLower === 'solana'
    ? `https://photon-sol.tinyastro.io/en/lp/${payload.contractAddress}`
    : `https://bullx.io/terminal?chainId=${chainLower === 'base' ? 8453 : 1}&address=${payload.contractAddress}`;

  const inlineKeyboard: InlineKeyboardButton[][] = [
    [
      { text: '📊 Chart', url: `https://dexscreener.com/${chainLower}/${payload.contractAddress}` },
      { text: chainLower === 'solana' ? '⚡ Photon' : '⚡ BullX', url: sniperUrl },
      { text: '🔍 Explorer', url: explorerUrl },
      { text: '𝕏 Search', url: `https://x.com/search?q=${payload.contractAddress}&f=live` }
    ],
    [
      { text: `♞ ${p1} ${curr}`, callback_data: `st:${chainCode}:${shortAddr}:${p1}` },
      { text: `♞ ${p2} ${curr}`, callback_data: `st:${chainCode}:${shortAddr}:${p2}` },
      { text: `♞ ${p3} ${curr}`, callback_data: `st:${chainCode}:${shortAddr}:${p3}` },
      { text: '🎯 Moonbag', callback_data: `mb:${chainCode}:${shortAddr}` }
    ]
  ];


  return { text, inlineKeyboard };
}

import type {
  AutoTradePosition,
  AutoTradeHistoryItem,
  AutoTradeConfig,
  AutoTradeStats,
} from '../types/autotrade.js';

export function formatAutoBuyAlert(
  position: AutoTradePosition,
  rationale: string,
  mode: string
): string {
  const isPaper = mode.toUpperCase() === 'PAPER';
  const modeTag = isPaper ? '🧪 [PAPER VIRTUAL]' : '⚡ [LIVE]';
  const symbol = escapeHtml(position.tokenSymbol);
  const address = escapeHtml(position.tokenAddress);
  const chain = position.chain.toUpperCase();
  const curr = chain === 'SOLANA' ? 'SOL' : 'ETH';

  return `♞ <b>AUTO-BUY EXECUTED</b> ${modeTag}
<b>$${symbol}</b> ⬝ <code>[${chain}]</code>
<code>${address}</code>
💰 <b>Size:</b> ${position.amountIn} ${curr}  ·  🎯 <b>Entry:</b> $${position.entryPriceUsd?.toFixed(6) || 'N/A'}
🛡️ <b>SL:</b> $${position.stopLossPriceUsd.toFixed(6)} (-12%)  ·  🏆 <b>TP1:</b> +35%
⚡ <b>Catalyst:</b> ${escapeHtml(rationale)}`;
}

export function formatAutoTpAlert(
  position: AutoTradePosition,
  pnlPercent: number,
  priceUsd: number
): string {
  const symbol = escapeHtml(position.tokenSymbol);
  const chain = position.chain.toUpperCase();

  return `🏆 <b>TP1 PROFIT TAKEN (+${pnlPercent.toFixed(1)}%)</b>
<b>$${symbol}</b> ⬝ <code>[${chain}]</code>
💰 <b>Sold:</b> 50% Position  ·  🏷️ <b>Price:</b> $${priceUsd.toFixed(6)}
🛡️ <b>Stop:</b> Moved to Breakeven Stop ($${position.entryPriceUsd?.toFixed(6)})
♞ <b>Runner:</b> Remaining 50% tracking trailing stop (-10% from peak)`;
}

export function formatAutoExitAlert(historyItem: AutoTradeHistoryItem): string {
  const symbol = escapeHtml(historyItem.tokenSymbol);
  const isWin = historyItem.pnlPercent >= 0;
  const pnlSign = isWin ? '+' : '';
  const icon = isWin ? '🟢' : '🔴';
  const curr = historyItem.chain.toUpperCase() === 'SOLANA' ? 'SOL' : 'ETH';

  return `🛡️ <b>POSITION CLOSED</b> ${icon} <b>${pnlSign}${historyItem.pnlPercent.toFixed(1)}%</b> (${pnlSign}${historyItem.pnlNative} ${curr})
<b>$${symbol}</b> ⬝ <code>[${historyItem.chain.toUpperCase()}]</code>  ·  <b>Reason:</b> ${historyItem.exitReason.replace(/_/g, ' ')}
📥 <b>Entry:</b> $${historyItem.entryPriceUsd.toFixed(6)}  ·  📤 <b>Exit:</b> $${historyItem.exitPriceUsd.toFixed(6)}`;
}

export function formatWhaleAlert(params: {
  chain: string;
  tokenSymbol: string;
  contractAddress: string;
  walletLabel: string;
  walletAddress: string;
  winRate30d: number;
  totalPnlUsd: number;
  action: 'BUY' | 'ACCUMULATING';
  volumeNative: number;
  mcapUsd?: number;
  priceUsd?: number;
}): { text: string; inlineKeyboard: InlineKeyboardButton[][] } {
  const chainLower = params.chain.toLowerCase();
  const safeSymbol = escapeHtml(params.tokenSymbol.replace(/^\$/, ''));
  const safeContract = escapeHtml(params.contractAddress);
  const chainName = params.chain.toUpperCase();
  const curr = chainLower === 'solana' ? 'SOL' : (chainLower === 'bnb' ? 'BNB' : 'ETH');
  const chainCode = chainLower === 'solana' ? 'sol' : (chainLower === 'base' ? 'base' : 'eth');

  const pnlFormatted = params.totalPnlUsd >= 1000
    ? `+$${(params.totalPnlUsd / 1000).toFixed(0)}k`
    : `+$${params.totalPnlUsd.toFixed(0)}`;

  const mcapText = params.mcapUsd ? `  ·  💰 <b>MCap:</b> ${formatCompactUsd(params.mcapUsd)}` : '';
  const priceText = params.priceUsd ? `  ·  🏷️ <b>Price:</b> $${params.priceUsd.toFixed(params.priceUsd < 0.01 ? 6 : 4)}` : '';

  const text = `🚨 <b>VERIFIED SMART MONEY ALERT</b> 🚨
<b>${escapeHtml(params.walletLabel)}</b> is ${params.action}ING <b>$${safeSymbol}</b> <code>[${chainName}]</code>
<code>${safeContract}</code>

👤 <b>Wallet:</b> <code>${params.walletAddress.slice(0, 6)}...${params.walletAddress.slice(-4)}</code>
📊 <b>Wallet Win Rate:</b> <b>${params.winRate30d}%</b>  ·  PnL: <b>${pnlFormatted}</b>
📦 <b>Entry Volume:</b> <b>${params.volumeNative.toFixed(2)} ${curr}</b>${mcapText}${priceText}
⚡ <b>Detection:</b> Verified On-Chain Accumulation`;

  const p1 = curr === 'SOL' ? '0.05' : '0.01';
  const p2 = curr === 'SOL' ? '0.1' : '0.05';
  const p3 = curr === 'SOL' ? '0.25' : '0.10';

  const explorerUrl = chainLower === 'solana'
    ? `https://solscan.io/token/${params.contractAddress}`
    : chainLower === 'base'
    ? `https://basescan.org/token/${params.contractAddress}`
    : `https://etherscan.io/token/${params.contractAddress}`;

  const inlineKeyboard: InlineKeyboardButton[][] = [
    [
      { text: '📊 DexScreener', url: `https://dexscreener.com/${chainLower}/${params.contractAddress}` },
      { text: '🔍 Explorer', url: explorerUrl },
    ],
    [
      { text: `⚡ Buy ${p1} ${curr}`, callback_data: `st:${chainCode}:${params.contractAddress}:${p1}` },
      { text: `⚡ Buy ${p2} ${curr}`, callback_data: `st:${chainCode}:${params.contractAddress}:${p2}` },
      { text: `⚡ Buy ${p3} ${curr}`, callback_data: `st:${chainCode}:${params.contractAddress}:${p3}` },
    ],
  ];

  return { text, inlineKeyboard };
}

export function formatAutoTradeStatus(
  config: AutoTradeConfig,
  stats: AutoTradeStats
): string {
  const statusBadge = config.enabled ? '🟢 <b>ACTIVE</b>' : '⏸️ <b>PAUSED</b>';
  const modeBadge = config.mode === 'PAPER' ? '🧪 <b>PAPER</b>' : '⚡ <b>LIVE</b>';
  const cbBadge = stats.circuitBreakerActive ? '🛑 <b>TRIPPED</b>' : '🛡️ <b>SECURE</b>';
  const pnlSign = stats.totalPnlNative >= 0 ? '+' : '';

  return `♞ <b>PREDIQUE AUTO-TRADING STATUS</b> ♞
Status: ${statusBadge}  ·  Mode: ${modeBadge}  ·  Strategy: <b>${config.strategy}</b>
Trade Size: <b>${config.maxTradeAmountNative} Native</b>  ·  Target: <b>+${config.takeProfitPercent}% TP / -${config.stopLossPercent}% SL</b>
Circuit Breaker: ${cbBadge}

📊 <b>PERFORMANCE:</b>
Trades: <b>${stats.totalTrades}</b>  ·  Win Rate: <b>${stats.winRate}%</b> (${stats.winningTrades}W / ${stats.losingTrades}L)
Net PnL: <b>${pnlSign}${stats.totalPnlNative} Native</b>  ·  Peak DD: <b>${stats.peakDrawdownPercent}%</b>`;
}
