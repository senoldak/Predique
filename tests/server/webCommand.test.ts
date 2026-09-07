import { describe, it, expect } from 'vitest';
import { generateWebLoginUrl, redeemOneTimeToken } from '../../src/server/auth';

describe('Telegram /web Command Integration', () => {
  it('generates a valid web login URL with one-time token', () => {
    const userId = 'tg_12345678';
    const baseUrl = 'https://predique.trade';
    const loginUrl = generateWebLoginUrl(userId, baseUrl);

    expect(loginUrl).toMatch(/^https:\/\/predique\.trade\/\?token=ott_[a-f0-9]{48}$/);

    const token = new URL(loginUrl).searchParams.get('token');
    expect(token).toBeDefined();

    const redeemedUserId = redeemOneTimeToken(token!);
    expect(redeemedUserId).toBe('tg_12345678');

    const reused = redeemOneTimeToken(token!);
    expect(reused).toBeNull();
  });
});
