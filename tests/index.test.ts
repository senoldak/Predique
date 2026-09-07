import { describe, it, expect } from 'vitest';
import {
  startBot,
  calculateSignalTier,
  formatSignalMessage,
  buildQuickBuyPayload,
  encryptKey,
  decryptKey,
  escapeHtml
} from '../src/index.js';

describe('Predique Entrypoint & Exports', () => {
  it('exports all core functions correctly', () => {
    expect(typeof calculateSignalTier).toBe('function');
    expect(typeof formatSignalMessage).toBe('function');
    expect(typeof buildQuickBuyPayload).toBe('function');
    expect(typeof encryptKey).toBe('function');
    expect(typeof decryptKey).toBe('function');
    expect(typeof escapeHtml).toBe('function');
  });

  it('initializes Bot instance with valid config', async () => {
    const env = {
      BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/predique',
      PREDIQUE_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    };

    const bot = await startBot(env);
    expect(bot).toBeDefined();
    expect(typeof bot.command).toBe('function');
  });
});
