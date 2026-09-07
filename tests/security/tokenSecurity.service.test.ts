import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkTokenSecurity, clearTokenSecurityCache } from '../../src/security/tokenSecurity.service.js';

const EVM_ADDR = '0xabf4f0999be267d8eaae658fb1f426f5a8568771';
const SOL_MINT = 'HpWnGa2UtSTmy5VU87XGm8yPKZc93P7F927LwjQ5pump';

function goplusResult(overrides: Record<string, string> = {}) {
  return {
    code: 1,
    message: 'OK',
    result: {
      [EVM_ADDR.toLowerCase()]: {
        is_honeypot: '0',
        buy_tax: '2',
        sell_tax: '3',
        is_blacklisted: '0',
        ...overrides,
      },
    },
  };
}

describe('checkTokenSecurity', () => {
  beforeEach(() => {
    clearTokenSecurityCache();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('api.gopluslabs.io')) {
        return { ok: true, json: async () => goplusResult() } as unknown as Response;
      }
      return { ok: true, json: async () => ({ risks: [], score: 0 }) } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns clean for a safe EVM token', async () => {
    const r = await checkTokenSecurity('base', EVM_ADDR);
    expect(r.status).toBe('clean');
    expect(r.isHoneypot).toBe(false);
    expect(r.buyTax).toBe(2);
    expect(r.source).toBe('goplus');
  });

  it('flags honeypot when GoPlus says so', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async () => {
      return { ok: true, json: async () => goplusResult({ is_honeypot: '1' }) } as unknown as Response;
    });
    const r = await checkTokenSecurity('base', EVM_ADDR);
    expect(r.status).toBe('honeypot');
    expect(r.isHoneypot).toBe(true);
  });

  it('flags risk on high tax or blacklist', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async () => {
      return { ok: true, json: async () => goplusResult({ sell_tax: '25' }) } as unknown as Response;
    });
    const r = await checkTokenSecurity('bnb', EVM_ADDR);
    expect(r.status).toBe('risk');
  });

  it('returns unknown on API failure and still resolves', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async () => {
      return { ok: false, status: 429 } as unknown as Response;
    });
    const r = await checkTokenSecurity('base', EVM_ADDR);
    expect(r.status).toBe('unknown');
    expect(r.isHoneypot).toBe(false);
  });

  it('caches clean results (no second fetch)', async () => {
    const spy = vi.fn(async () => {
      return { ok: true, json: async () => goplusResult() } as unknown as Response;
    });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', spy);
    await checkTokenSecurity('ethereum', EVM_ADDR);
    await checkTokenSecurity('ethereum', EVM_ADDR);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
