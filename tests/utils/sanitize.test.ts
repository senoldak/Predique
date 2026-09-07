import { describe, it, expect } from 'vitest';
import { escapeHtml, isValidEvmAddress, isValidSolanaAddress, validateTradeAmount } from '../../src/utils/sanitize.js';

describe('Security & Sanitization Utilities', () => {
  it('escapes HTML special characters for Telegram safe parsing', () => {
    expect(escapeHtml('PEPE<BUY> & $DOGE')).toBe('PEPE&lt;BUY&gt; &amp; $DOGE');
    expect(escapeHtml('<script>alert("hack")</script>')).toBe('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;');
  });

  it('validates EVM addresses accurately', () => {
    expect(isValidEvmAddress('0xabf4f0999be267d8eaae658fb1f426f5a8568771')).toBe(true);
    expect(isValidEvmAddress('0xInvalid')).toBe(false);
    expect(isValidEvmAddress('HpWnGa2UtSTmy5VU87XGm8yPKZc93P7F927LwjQ5pump')).toBe(false);
  });

  it('validates Solana base58 addresses accurately', () => {
    expect(isValidSolanaAddress('HpWnGa2UtSTmy5VU87XGm8yPKZc93P7F927LwjQ5pump')).toBe(true);
    expect(isValidSolanaAddress('0xabf4f0999be267d8eaae658fb1f426f5a8568771')).toBe(false);
    expect(isValidSolanaAddress('short')).toBe(false);
  });

  it('rejects invalid, negative, NaN or zero trade amounts', () => {
    expect(validateTradeAmount(0.01)).toBe(true);
    expect(validateTradeAmount(0)).toBe(false);
    expect(validateTradeAmount(-1)).toBe(false);
    expect(validateTradeAmount(NaN)).toBe(false);
    expect(validateTradeAmount(Infinity)).toBe(false);
  });
});
