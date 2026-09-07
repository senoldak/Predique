import { describe, it, expect, afterEach } from 'vitest';
import { BotManager } from '../../src/bot/botManager.js';

describe('BotManager Telegram admin gate', () => {
  const prev = process.env.TELEGRAM_ADMIN_IDS;

  afterEach(() => {
    if (prev === undefined) delete process.env.TELEGRAM_ADMIN_IDS;
    else process.env.TELEGRAM_ADMIN_IDS = prev;
  });

  it('recognizes listed ids and blocks everyone else (fail-closed when empty)', () => {
    process.env.TELEGRAM_ADMIN_IDS = '111, 222';
    expect(BotManager.isTelegramAdmin(111)).toBe(true);
    expect(BotManager.isTelegramAdmin('222')).toBe(true);
    expect(BotManager.isTelegramAdmin(333)).toBe(false);
    expect(BotManager.isTelegramAdmin(undefined)).toBe(false);

    delete process.env.TELEGRAM_ADMIN_IDS;
    expect(BotManager.isTelegramAdmin(111)).toBe(false);
  });
});
