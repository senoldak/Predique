export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface StoredWalletRow {
  user_id: string;
  chain: string;
  address: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: Date;
}

export interface StoredTradeRow {
  id: string;
  position_id: string;
  user_id: string;
  token_address: string;
  token_symbol: string;
  chain: string;
  amount_in: number;
  entry_price_usd?: number;
  exit_price_usd?: number;
  entry_mcap: number;
  exit_mcap: number;
  pnl_percent: number;
  percentage_sold: number;
  open_timestamp: number;
  close_timestamp: number;
  hold_duration_seconds: number;
  tx_hash: string;
  is_paper: boolean;
  created_at: Date;
}

export class PostgresStorageAdapter {
  private db?: DatabaseClient;

  constructor(db?: DatabaseClient) {
    this.db = db;
  }

  public setClient(db: DatabaseClient): void {
    this.db = db;
  }

  public isConnected(): boolean {
    return !!this.db;
  }

  public async initSchema(): Promise<void> {
    if (!this.db) return;

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS user_wallets (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        chain VARCHAR(16) NOT NULL,
        address VARCHAR(128) NOT NULL,
        ciphertext TEXT NOT NULL,
        iv VARCHAR(64) NOT NULL,
        auth_tag VARCHAR(64) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, chain, address)
      );
    `);

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS trade_history (
        id VARCHAR(128) PRIMARY KEY,
        position_id VARCHAR(128) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        token_address VARCHAR(128) NOT NULL,
        token_symbol VARCHAR(32) NOT NULL,
        chain VARCHAR(16) NOT NULL,
        amount_in NUMERIC(18, 8) NOT NULL,
        entry_price_usd NUMERIC(24, 8),
        exit_price_usd NUMERIC(24, 8),
        entry_mcap NUMERIC(24, 2) NOT NULL,
        exit_mcap NUMERIC(24, 2) NOT NULL,
        pnl_percent NUMERIC(10, 2) NOT NULL,
        percentage_sold NUMERIC(5, 2) NOT NULL,
        open_timestamp BIGINT NOT NULL,
        close_timestamp BIGINT NOT NULL,
        hold_duration_seconds INT NOT NULL,
        tx_hash VARCHAR(128) NOT NULL,
        is_paper BOOLEAN NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_trade_history_user ON trade_history(user_id, is_paper);
    `);

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS smart_wallets (
        address VARCHAR(128) PRIMARY KEY,
        chain VARCHAR(16) NOT NULL,
        label VARCHAR(64) NOT NULL,
        tag VARCHAR(32) NOT NULL,
        win_rate_30d NUMERIC(5, 2) NOT NULL,
        total_pnl_usd NUMERIC(18, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS autotrade_bots (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(64) NOT NULL,
        enabled BOOLEAN NOT NULL,
        mode VARCHAR(16) NOT NULL,
        strategy VARCHAR(32) NOT NULL,
        chain VARCHAR(16) NOT NULL,
        config_json TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async saveWallet(
    userId: string,
    wallet: {
      address: string;
      chain: string;
      ciphertext: string;
      iv: string;
      authTag: string;
    }
  ): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      `
      INSERT INTO user_wallets (user_id, chain, address, ciphertext, iv, auth_tag)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, chain, address)
      DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag
    `,
      [userId, wallet.chain, wallet.address, wallet.ciphertext, wallet.iv, wallet.authTag]
    );
  }

  public async getWallets(userId: string): Promise<Array<{
    address: string;
    chain: 'EVM' | 'SOLANA';
    ciphertext: string;
    iv: string;
    authTag: string;
  }>> {
    if (!this.db) return [];
    const res = await this.db.query(
      `SELECT chain, address, ciphertext, iv, auth_tag FROM user_wallets WHERE user_id = $1 ORDER BY id ASC`,
      [userId]
    );
    return res.rows.map((r: any) => ({
      chain: r.chain as 'EVM' | 'SOLANA',
      address: r.address,
      ciphertext: r.ciphertext,
      iv: r.iv,
      authTag: r.auth_tag,
    }));
  }

  public async saveTrade(trade: {
    id: string;
    positionId: string;
    userId: string;
    tokenAddress: string;
    tokenSymbol: string;
    chain: string;
    amountIn: number;
    entryPriceUsd?: number;
    exitPriceUsd?: number;
    entryMcap: number;
    exitMcap: number;
    pnlPercent: number;
    percentageSold: number;
    openTimestamp: number;
    closeTimestamp: number;
    holdDurationSeconds: number;
    txHash: string;
    isPaper: boolean;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      `
      INSERT INTO trade_history (
        id, position_id, user_id, token_address, token_symbol, chain,
        amount_in, entry_price_usd, exit_price_usd, entry_mcap, exit_mcap,
        pnl_percent, percentage_sold, open_timestamp, close_timestamp,
        hold_duration_seconds, tx_hash, is_paper
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO NOTHING
    `,
      [
        trade.id,
        trade.positionId,
        trade.userId,
        trade.tokenAddress,
        trade.tokenSymbol,
        trade.chain,
        trade.amountIn,
        trade.entryPriceUsd || null,
        trade.exitPriceUsd || null,
        trade.entryMcap,
        trade.exitMcap,
        trade.pnlPercent,
        trade.percentageSold,
        trade.openTimestamp,
        trade.closeTimestamp,
        trade.holdDurationSeconds,
        trade.txHash,
        trade.isPaper,
      ]
    );
  }

  public async getTrades(userId: string, isPaper: boolean): Promise<any[]> {
    if (!this.db) return [];
    const res = await this.db.query(
      `
      SELECT id, position_id, user_id, token_address, token_symbol, chain,
             amount_in, entry_price_usd, exit_price_usd, entry_mcap, exit_mcap,
             pnl_percent, percentage_sold, open_timestamp, close_timestamp,
             hold_duration_seconds, tx_hash, is_paper
      FROM trade_history
      WHERE user_id = $1 AND is_paper = $2
      ORDER BY close_timestamp DESC
      LIMIT 100
    `,
      [userId, isPaper]
    );

    return res.rows.map((r: any) => ({
      id: r.id,
      positionId: r.position_id,
      userId: r.user_id,
      tokenAddress: r.token_address,
      tokenSymbol: r.token_symbol,
      chain: r.chain,
      amountIn: Number(r.amount_in),
      entryPriceUsd: r.entry_price_usd ? Number(r.entry_price_usd) : undefined,
      exitPriceUsd: r.exit_price_usd ? Number(r.exit_price_usd) : undefined,
      entryMcap: Number(r.entry_mcap),
      exitMcap: Number(r.exit_mcap),
      pnlPercent: Number(r.pnl_percent),
      percentageSold: Number(r.percentage_sold),
      openTimestamp: Number(r.open_timestamp),
      closeTimestamp: Number(r.close_timestamp),
      holdDurationSeconds: Number(r.hold_duration_seconds),
      txHash: r.tx_hash,
      isPaper: Boolean(r.is_paper),
    }));
  }

  public async saveSmartWallet(wallet: {
    address: string;
    chain: string;
    label: string;
    tag: string;
    winRate30d: number;
    totalPnlUsd: number;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      `
      INSERT INTO smart_wallets (address, chain, label, tag, win_rate_30d, total_pnl_usd)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address) DO UPDATE
      SET label = EXCLUDED.label,
          tag = EXCLUDED.tag,
          win_rate_30d = EXCLUDED.win_rate_30d,
          total_pnl_usd = EXCLUDED.total_pnl_usd
    `,
      [
        wallet.address.toLowerCase(),
        wallet.chain,
        wallet.label,
        wallet.tag,
        wallet.winRate30d,
        wallet.totalPnlUsd,
      ]
    );
  }

  public async getSmartWallets(): Promise<any[]> {
    if (!this.db) return [];
    const res = await this.db.query(
      `
      SELECT address, chain, label, tag, win_rate_30d, total_pnl_usd
      FROM smart_wallets
      ORDER BY win_rate_30d DESC
    `
    );

    return res.rows.map((r: any) => ({
      address: r.address,
      chain: r.chain,
      label: r.label,
      tag: r.tag,
      winRate30d: Number(r.win_rate_30d),
      totalPnlUsd: Number(r.total_pnl_usd),
    }));
  }

  public async saveBot(bot: {
    id: string;
    name: string;
    enabled: boolean;
    mode: string;
    strategy: string;
    chain: string;
    [key: string]: any;
  }): Promise<void> {
    if (!this.db) return;
    const configJson = JSON.stringify(bot);
    await this.db.query(
      `
      INSERT INTO autotrade_bots (id, name, enabled, mode, strategy, chain, config_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          enabled = EXCLUDED.enabled,
          mode = EXCLUDED.mode,
          strategy = EXCLUDED.strategy,
          chain = EXCLUDED.chain,
          config_json = EXCLUDED.config_json
    `,
      [bot.id, bot.name, bot.enabled, bot.mode, bot.strategy, bot.chain, configJson]
    );
  }

  public async deleteBot(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.query(`DELETE FROM autotrade_bots WHERE id = $1`, [id]);
  }

  public async getBots(): Promise<any[]> {
    if (!this.db) return [];
    const res = await this.db.query(
      `SELECT id, name, enabled, mode, strategy, chain, config_json FROM autotrade_bots ORDER BY created_at ASC`
    );

    return res.rows.map((r: any) => {
      try {
        const parsed = JSON.parse(r.config_json);
        return {
          ...parsed,
          id: r.id,
          name: r.name,
          enabled: Boolean(r.enabled),
          mode: r.mode,
          strategy: r.strategy,
          chain: r.chain,
        };
      } catch {
        return {
          id: r.id,
          name: r.name,
          enabled: Boolean(r.enabled),
          mode: r.mode,
          strategy: r.strategy,
          chain: r.chain,
        };
      }
    });
  }
}
