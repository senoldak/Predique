import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresStorageAdapter, type DatabaseClient } from '../../src/database/postgres.adapter.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';

describe('PostgresStorageAdapter - Relational Persistence Layer', () => {
  let mockDb: DatabaseClient;
  let queries: Array<{ sql: string; params?: unknown[] }>;
  let adapter: PostgresStorageAdapter;

  beforeEach(() => {
    queries = [];
    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT chain, address, ciphertext')) {
          return {
            rows: [
              {
                chain: 'EVM',
                address: '0x1111111111111111111111111111111111111111',
                ciphertext: 'cipher_hex',
                iv: 'iv_hex',
                auth_tag: 'tag_hex',
              },
            ],
          };
        }
        if (sql.includes('SELECT id, position_id')) {
          return {
            rows: [
              {
                id: 'trade_1',
                position_id: 'pos_1',
                user_id: 'u_1',
                token_address: '0xtoken',
                token_symbol: 'TEST',
                chain: 'BASE',
                amount_in: '0.5',
                entry_price_usd: '1.25',
                exit_price_usd: '2.50',
                entry_mcap: '100000',
                exit_mcap: '200000',
                pnl_percent: '100.0',
                percentage_sold: '100.0',
                open_timestamp: '1700000000000',
                close_timestamp: '1700000060000',
                hold_duration_seconds: 60,
                tx_hash: '0xhash',
                is_paper: true,
              },
            ],
          };
        }
        if (sql.includes('SELECT address, chain, label, tag')) {
          return {
            rows: [
              {
                address: '0x9999999999999999999999999999999999999999',
                chain: 'EVM',
                label: 'Alpha Whale Recovered',
                tag: 'ALPHA_SNIPER',
                win_rate_30d: '88.5',
                total_pnl_usd: '500000',
              },
            ],
          };
        }
        if (sql.includes('FROM autotrade_bots')) {
          const storedBots: any[] = [];
          for (const q of queries) {
            if (q.sql.includes('INSERT INTO autotrade_bots') && q.params) {
              storedBots.push({
                id: q.params[0],
                name: q.params[1],
                enabled: q.params[2],
                mode: q.params[3],
                strategy: q.params[4],
                chain: q.params[5],
                config_json: q.params[6],
              });
            }
          }
          // Filter out deleted bots
          const deletedIds = queries
            .filter((q) => q.sql.includes('DELETE FROM autotrade_bots') && q.params)
            .map((q) => q.params![0]);
          return { rows: storedBots.filter((b) => !deletedIds.includes(b.id)) };
        }
        return { rows: [] };
      }),
    };
    adapter = new PostgresStorageAdapter(mockDb);
  });

  it('initializes tables with proper schema and indexes', async () => {
    await adapter.initSchema();
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries[0].sql).toContain('CREATE TABLE IF NOT EXISTS user_wallets');
    expect(queries[1].sql).toContain('CREATE TABLE IF NOT EXISTS trade_history');
  });

  it('saves and loads wallets with AES ciphertext and authTag', async () => {
    await adapter.saveWallet('u_1', {
      address: '0x1111111111111111111111111111111111111111',
      chain: 'EVM',
      ciphertext: 'cipher_hex',
      iv: 'iv_hex',
      authTag: 'tag_hex',
    });

    expect(queries.some((q) => q.sql.includes('INSERT INTO user_wallets'))).toBe(true);

    const wallets = await adapter.getWallets('u_1');
    expect(wallets).toHaveLength(1);
    expect(wallets[0].address).toBe('0x1111111111111111111111111111111111111111');
    expect(wallets[0].ciphertext).toBe('cipher_hex');
  });

  it('saves and retrieves closed trade records', async () => {
    await adapter.saveTrade({
      id: 'trade_1',
      positionId: 'pos_1',
      userId: 'u_1',
      tokenAddress: '0xtoken',
      tokenSymbol: 'TEST',
      chain: 'BASE',
      amountIn: 0.5,
      entryPriceUsd: 1.25,
      exitPriceUsd: 2.5,
      entryMcap: 100000,
      exitMcap: 200000,
      pnlPercent: 100,
      percentageSold: 100,
      openTimestamp: 1700000000000,
      closeTimestamp: 1700000060000,
      holdDurationSeconds: 60,
      txHash: '0xhash',
      isPaper: true,
    });

    expect(queries.some((q) => q.sql.includes('INSERT INTO trade_history'))).toBe(true);

    const trades = await adapter.getTrades('u_1', true);
    expect(trades).toHaveLength(1);
    expect(trades[0].tokenSymbol).toBe('TEST');
    expect(trades[0].pnlPercent).toBe(100);
    expect(trades[0].amountIn).toBe(0.5);
  });

  it('restores wallets through WalletService when Redis is absent', async () => {
    const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const ws = new WalletService(masterKey, null, null, adapter);

    const loaded = await ws.loadWallets('u_1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].address).toBe('0x1111111111111111111111111111111111111111');
    expect(loaded[0].chain).toBe('EVM');
  });

  it('restores trade history through TradeService when Redis is absent', async () => {
    const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const ws = new WalletService(masterKey, null, null, adapter);
    const ts = new TradeService(ws, null, adapter);

    const history = await ts.getTradeHistory('u_1', true);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('trade_1');
    expect(history[0].tokenSymbol).toBe('TEST');
    expect(history[0].pnlPercent).toBe(100);
  });

  it('saves and retrieves smart wallets from Postgres', async () => {
    await adapter.saveSmartWallet({
      address: '0x9999999999999999999999999999999999999999',
      chain: 'EVM',
      label: 'Alpha Whale Recovered',
      tag: 'ALPHA_SNIPER',
      winRate30d: 88.5,
      totalPnlUsd: 500000,
    });

    expect(queries.some((q) => q.sql.includes('INSERT INTO smart_wallets'))).toBe(true);

    const wallets = await adapter.getSmartWallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0].label).toBe('Alpha Whale Recovered');
    expect(wallets[0].winRate30d).toBe(88.5);
  });

  it('restores smart wallets into SmartWalletRegistry on cold start via loadFromPostgres', async () => {
    const { SmartWalletRegistry } = await import('../../src/engine/smartWalletRegistry.js');
    const registry = new SmartWalletRegistry(false, adapter);

    const count = await registry.loadFromPostgres();
    expect(count).toBe(1);
    expect(registry.isSmartWallet('0x9999999999999999999999999999999999999999')).toBe(true);
    const w = registry.getWallet('0x9999999999999999999999999999999999999999');
    expect(w?.label).toBe('Alpha Whale Recovered');
    expect(w?.winRate30d).toBe(88.5);
  });

  it('persists and retrieves autotrade bots in postgres', async () => {
    const bot = {
      id: 'bot_test_pg',
      name: 'Postgres Swarm Runner',
      enabled: true,
      mode: 'PAPER' as const,
      strategy: 'SWARM_MOMENTUM' as const,
      chain: 'ETH' as const,
      maxTradeAmountNative: 0.5,
      maxOpenPositions: 4,
      slippagePercent: 3.5,
      takeProfitPercent: 40,
      stopLossPercent: 10,
      trailingStopPercent: 8,
      dailyMaxDrawdownPercent: 6,
      minLiquidityUsd: 25000,
      totalTrades: 12,
      winRate: 75.0,
      totalPnlNative: 1.85,
    };

    await adapter.saveBot(bot);
    const bots = await adapter.getBots();
    const found = bots.find(b => b.id === 'bot_test_pg');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Postgres Swarm Runner');
    expect(found?.slippagePercent).toBe(3.5);
    expect(found?.totalTrades).toBe(12);

    await adapter.deleteBot('bot_test_pg');
    const afterDelete = await adapter.getBots();
    expect(afterDelete.find(b => b.id === 'bot_test_pg')).toBeUndefined();
  });

  it('restores bot instances into AutoTradeService on cold start when Redis is absent', async () => {
    const bot = {
      id: 'bot_cold_recovery',
      name: 'Cold Recovery Bot',
      enabled: true,
      mode: 'PAPER' as const,
      strategy: 'SWARM_MOMENTUM' as const,
      chain: 'ALL' as const,
      maxTradeAmountNative: 0.25,
      maxOpenPositions: 3,
      slippagePercent: 4,
      takeProfitPercent: 30,
      stopLossPercent: 15,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
      totalTrades: 5,
      winRate: 80,
      totalPnlNative: 0.45,
    };
    await adapter.saveBot(bot);

    const { AutoTradeService } = await import('../../src/services/autoTrade.service.js');
    const mockTradeService = {} as any;
    const mockWalletService = {} as any;

    const autoService = new AutoTradeService(
      mockTradeService,
      mockWalletService,
      undefined,
      4000,
      null,
      adapter
    );

    // Wait a tick for async loadPersistedState to complete
    await new Promise(res => setTimeout(res, 50));

    const restoredBots = autoService.getBots();
    const recovered = restoredBots.find(b => b.id === 'bot_cold_recovery');
    expect(recovered).toBeDefined();
    expect(recovered?.name).toBe('Cold Recovery Bot');
    expect(recovered?.maxTradeAmountNative).toBe(0.25);

    autoService.destroy();
  });
});


