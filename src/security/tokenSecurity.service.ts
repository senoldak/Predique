export type TokenSecurityStatus = 'clean' | 'risk' | 'honeypot' | 'unknown';

export interface TokenSecurityResult {
  status: TokenSecurityStatus;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  hasBlacklist: boolean;
  lpLocked: boolean | null;
  source: 'goplus' | 'rugcheck' | 'unknown';
  checkedAt: number;
}

export const SECURITY_CACHE_TTL_MS = 10 * 60 * 1000;
export const SECURITY_UNKNOWN_TTL_MS = 2 * 60 * 1000;
export const SECURITY_TAX_RISK_PERCENT = 10;
const FETCH_TIMEOUT_MS = 4000;

const GOPLUS_CHAIN_IDS: Record<string, string> = { base: '8453', ethereum: '1', eth: '1', bnb: '56', bsc: '56' };

const cache = new Map<string, { result: TokenSecurityResult; expiresAt: number }>();

function cacheKey(chain: string, address: string): string {
  return `${chain.toLowerCase()}:${address.toLowerCase()}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function unknownResult(): TokenSecurityResult {
  return { status: 'unknown', isHoneypot: false, buyTax: 0, sellTax: 0, hasBlacklist: false, lpLocked: null, source: 'unknown', checkedAt: Date.now() };
}

function fromGoPlus(chain: string, address: string, data: any): TokenSecurityResult {
  const entry = data?.result?.[address.toLowerCase()];
  if (!entry || typeof entry !== 'object') return unknownResult();
  const isHoneypot = String(entry.is_honeypot) === '1';
  const buyTax = Number.parseFloat(String(entry.buy_tax ?? '0')) || 0;
  const sellTax = Number.parseFloat(String(entry.sell_tax ?? '0')) || 0;
  const hasBlacklist = String(entry.is_blacklisted) === '1';
  if (isHoneypot) {
    return { status: 'honeypot', isHoneypot: true, buyTax, sellTax, hasBlacklist, lpLocked: null, source: 'goplus', checkedAt: Date.now() };
  }
  if (hasBlacklist || buyTax > SECURITY_TAX_RISK_PERCENT || sellTax > SECURITY_TAX_RISK_PERCENT) {
    return { status: 'risk', isHoneypot: false, buyTax, sellTax, hasBlacklist, lpLocked: null, source: 'goplus', checkedAt: Date.now() };
  }
  return { status: 'clean', isHoneypot: false, buyTax, sellTax, hasBlacklist, lpLocked: null, source: 'goplus', checkedAt: Date.now() };
}

function fromRugCheck(data: any): TokenSecurityResult {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).risks)) return unknownResult();
  const risks = (data as any).risks as Array<{ name?: string; level?: string }>;
  const names = risks.map((r) => String(r?.name ?? '').toLowerCase());
  if (names.some((n) => n.includes('honeypot'))) {
    return { status: 'honeypot', isHoneypot: true, buyTax: 0, sellTax: 0, hasBlacklist: false, lpLocked: null, source: 'rugcheck', checkedAt: Date.now() };
  }
  const dangerous = risks.some((r) => ['danger', 'warn'].includes(String(r?.level ?? '').toLowerCase()));
  const authority = names.some((n) => n.includes('mint authority') || n.includes('freeze authority') || n.includes('mutable'));
  if (dangerous || authority) {
    return { status: 'risk', isHoneypot: false, buyTax: 0, sellTax: 0, hasBlacklist: false, lpLocked: null, source: 'rugcheck', checkedAt: Date.now() };
  }
  return { status: 'clean', isHoneypot: false, buyTax: 0, sellTax: 0, hasBlacklist: false, lpLocked: null, source: 'rugcheck', checkedAt: Date.now() };
}

export async function checkTokenSecurity(chain: string, tokenAddress: string): Promise<TokenSecurityResult> {
  const key = cacheKey(chain, tokenAddress);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.result;
  const lower = chain.toLowerCase();
  try {
    if (lower === 'solana' || lower === 'sol') {
      const data = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`);
      const result = fromRugCheck(data);
      cache.set(key, { result, expiresAt: Date.now() + (result.status === 'unknown' ? SECURITY_UNKNOWN_TTL_MS : SECURITY_CACHE_TTL_MS) });
      return result;
    }
    const chainId = GOPLUS_CHAIN_IDS[lower];
    if (!chainId) return unknownResult();
    const data = await fetchJson(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`);
    const result = fromGoPlus(chain, tokenAddress, data);
    cache.set(key, { result, expiresAt: Date.now() + (result.status === 'unknown' ? SECURITY_UNKNOWN_TTL_MS : SECURITY_CACHE_TTL_MS) });
    return result;
  } catch {
    const result = unknownResult();
    cache.set(key, { result, expiresAt: Date.now() + SECURITY_UNKNOWN_TTL_MS });
    return result;
  }
}

export function clearTokenSecurityCache(): void {
  cache.clear();
}
