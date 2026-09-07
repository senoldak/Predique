import { describe, it, expect, vi } from 'vitest';
import {
  JITO_TIP_ACCOUNTS,
  getRandomJitoTipAccount,
  getProtectedEvmRpc,
  sendJitoBundle,
} from '../../src/trade/execution/mev.js';

describe('MEV Protection - Jito & Flashbots Routing', () => {
  it('provides official Jito tip accounts and random picker', () => {
    expect(JITO_TIP_ACCOUNTS.length).toBeGreaterThanOrEqual(5);
    const picked = getRandomJitoTipAccount();
    expect(JITO_TIP_ACCOUNTS).toContain(picked);
  });

  it('resolves Flashbots protected RPC for Ethereum and Base', () => {
    const ethRpc = getProtectedEvmRpc('ETH');
    expect(ethRpc).toContain('flashbots');

    const baseRpc = getProtectedEvmRpc('BASE');
    expect(baseRpc).toBeDefined();
  });

  it('posts bundles to Jito block engine endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'bundle_12345' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const bundleId = await sendJitoBundle(['base64_serialized_tx_1']);
    expect(bundleId).toBe('bundle_12345');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('jito.wtf'),
      expect.objectContaining({ method: 'POST' })
    );

    vi.unstubAllGlobals();
  });
});
