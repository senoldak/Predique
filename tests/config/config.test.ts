import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('Config Loader', () => {
  it('throws error when required env variables are missing', () => {
    expect(() => loadConfig({})).toThrow(/Missing required environment variable/);
  });

  it('successfully loads and validates complete config', () => {
    const validEnv = {
      BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/predique',
      PREDIQUE_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    };
    const cfg = loadConfig(validEnv);
    expect(cfg.botToken).toBe(validEnv.BOT_TOKEN);
    expect(cfg.redisUrl).toBe(validEnv.REDIS_URL);
    expect(cfg.masterKeyHex).toHaveLength(64);
  });
});
