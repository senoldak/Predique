import { isAddress } from 'viem';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isValidEvmAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return isAddress(address.trim());
}

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return BASE58_REGEX.test(address.trim());
}

export function validateTradeAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}
