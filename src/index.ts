import 'dotenv/config';
import { Bot } from 'grammy';
import { loadConfig, requireJwtSecret, requireMasterKey } from './config/index.js';
import { calculateSignalTier } from './engine/scoring.js';
import { recordWalletBuy, recordWalletSell, getTokenState } from './engine/stateMachine.js';
import { formatSignalMessage } from './bot/formatters.js';
import { buildQuickBuyPayload, getRouterForChain } from './trade/router.js';
import { encryptKey, decryptKey, decryptWithRotation, isExampleMasterKey } from './security/crypto.js';
import { escapeHtml, isValidEvmAddress, isValidSolanaAddress, validateTradeAmount } from './utils/sanitize.js';

export {
  loadConfig,
  requireJwtSecret,
  requireMasterKey,
  calculateSignalTier,
  recordWalletBuy,
  recordWalletSell,
  getTokenState,
  formatSignalMessage,
  buildQuickBuyPayload,
  getRouterForChain,
  encryptKey,
  decryptKey,
  decryptWithRotation,
  isExampleMasterKey,
  escapeHtml,
  isValidEvmAddress,
  isValidSolanaAddress,
  validateTradeAmount
};

import { createServerApp } from './server/app.js';
import { WalletService } from './services/wallet.service.js';
import { TradeService } from './services/trade.service.js';
import { LiveMarketFeedService } from './services/marketFeed.service.js';
import { AutoTradeService } from './services/autoTrade.service.js';
import { BotManager } from './bot/botManager.js';

import { SmartWalletRegistry } from './engine/smartWalletRegistry.js';
import { SwarmDetector } from './engine/swarmDetector.js';
import { MultiChainStreamListener } from './engine/streamListener.js';
import { PostgresStorageAdapter } from './database/postgres.adapter.js';

export {
  createServerApp,
  WalletService,
  TradeService,
  LiveMarketFeedService,
  AutoTradeService,
  BotManager,
  SmartWalletRegistry,
  SwarmDetector,
  MultiChainStreamListener,
  PostgresStorageAdapter
};


export async function startBot(env: Record<string, string | undefined> = process.env) {
  const config = loadConfig(env);
  const bot = new Bot(config.botToken);

  bot.command('start', async (ctx) => {
    const welcomeText = `♞ <b>Predique</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Multi-chain trading & token alerts (Solana, Base, Ethereum, BNB).

<b>Commands:</b>
/start - Main menu
/wallet - Deposit addresses & balances
/web - Web Dashboard
/settings - Slippage & auto-buy settings
/positions - Active positions
/help - Help`;

    await ctx.reply(welcomeText, { parse_mode: 'HTML' });
  });

  bot.command('wallet', async (ctx) => {
    await ctx.reply(`💳 <b>Wallets:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 <b>EVM (Base / ETH / BNB):</b>
<code>Generating or connecting wallet...</code>

🟣 <b>Solana:</b>
<code>Generating or connecting wallet...</code>`, { parse_mode: 'HTML' });
  });

  bot.command('web', async (ctx) => {
    const userId = ctx.from?.id ? `tg_${ctx.from.id}` : 'tg_anonymous';
    const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
    const loginUrl = `${webAppUrl}/?token=ott_demo_token`;

    await ctx.reply(`♞ <b>Predique Web Dashboard</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<a href="${loginUrl}">Open Web Dashboard</a>`, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(`📖 <b>Help:</b>
- Multi-wallet cluster detection
- Real-time token alerts
- 1-click buy execution`, { parse_mode: 'HTML' });
  });

  return bot;
}

export async function startApp(env: Record<string, string | undefined> = process.env) {
  const config = loadConfig(env);
  const jwtSecret = requireJwtSecret(config.jwtSecret ?? env.JWT_SECRET);
  const masterKeyHex = requireMasterKey(config.masterKeyHex, env.NODE_ENV);

  let redis: import('ioredis').Redis | null = null;
  if (env.NODE_ENV !== 'test') {
    try {
      const mod = await import('ioredis');
      const RedisCtor = (mod as unknown as { default: new (url: string, opts?: object) => import('ioredis').Redis }).default;
      const client = new RedisCtor(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
      client.on('error', () => {});
      try {
        await client.connect();
        await client.ping();
        redis = client as unknown as import('ioredis').Redis;
        console.log('Redis custody store connected');
      } catch {
        try { client.disconnect(); } catch {}
        redis = null;
        console.warn('Running with in-memory custody store (Redis unavailable)');
      }
    } catch {
      redis = null;
      console.warn('Running with in-memory custody store (Redis unavailable)');
    }
  }

  const postgres = config.databaseUrl ? new PostgresStorageAdapter() : null;
  const walletService = new WalletService(masterKeyHex, redis, config.previousMasterKeyHex ?? null, postgres);
  const tradeService = new TradeService(walletService, redis, postgres);
  const smartWalletRegistry = new SmartWalletRegistry(true, postgres);
  if (postgres) {
    smartWalletRegistry.loadFromPostgres().catch(() => undefined);
  }
  const swarmDetector = redis ? new SwarmDetector(redis, smartWalletRegistry) : undefined;
  const marketFeedService = new LiveMarketFeedService(15000, swarmDetector);
  const autoTradeService = new AutoTradeService(tradeService, walletService, marketFeedService, 4000, redis, postgres);
  const botManager = new BotManager(walletService, tradeService, autoTradeService, smartWalletRegistry);

  const serverInstance = createServerApp({
    walletService,
    tradeService,
    marketFeedService,
    autoTradeService,
    botManager,
    jwtSecret,
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  serverInstance.server.listen(port, () => {
    console.log(`\n=================================================`);
    console.log(`PREDIQUE SERVER READY`);
    console.log(`Web: http://localhost:${port}`);
    console.log(`WebSocket: ws://localhost:${port}/ws`);
    console.log(`API: http://localhost:${port}/api`);
    console.log(`=================================================\n`);
  });

  if (config.botToken && !config.botToken.includes('your_telegram_bot_token_here') && !config.botToken.startsWith('123456789:ABC')) {
    try {
      const started = await botManager.start(config.botToken);
      if (started) {
        console.log(`🤖 Telegram Bot online & connected to channel ${botManager.getChannelConfig().channelId}`);
      }
    } catch (err) {
      console.warn('⚠️ Telegram Bot could not be started:', (err as Error).message);
    }
  } else {
    console.log('ℹ️ Telegram Bot inactive (configure valid BOT_TOKEN via Settings or .env)');
  }

  serverInstance.marketFeedService.start();

  return {
    server: serverInstance.server,
    botManager,
    walletService,
    tradeService,
    marketFeedService: serverInstance.marketFeedService,
    autoTradeService,
  };
}

if (process.env.NODE_ENV !== 'test') {
  startApp().catch((err) => {
    console.error('Failed to start Predique application:', err);
  });
}
