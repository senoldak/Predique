import http from 'node:http';
import path from 'node:path';
import express, { Express } from 'express';
import { WalletService } from '../services/wallet.service.js';
import { TradeService } from '../services/trade.service.js';
import { LiveMarketFeedService } from '../services/marketFeed.service.js';
import { AutoTradeService } from '../services/autoTrade.service.js';
import { BotManager } from '../bot/botManager.js';
import { createApiRouter } from './routes.js';
import { createWebSocketServer, WebSocketManager } from './ws.js';

export interface ServerAppOptions {
  walletService: WalletService;
  tradeService: TradeService;
  marketFeedService?: LiveMarketFeedService;
  autoTradeService?: AutoTradeService;
  botManager?: BotManager;
  jwtSecret?: string;
  staticDir?: string;
}

export interface ServerAppInstance {
  app: Express;
  server: http.Server;
  wsManager: WebSocketManager;
  marketFeedService: LiveMarketFeedService;
  broadcastSignal: (signal: unknown) => void;
  broadcastTrade: (trade: unknown) => void;
}

export function createServerApp(options: ServerAppOptions): ServerAppInstance {
  const app = express();
  const server = http.createServer(app);
  if (!options.jwtSecret || options.jwtSecret.length < 16) {
    throw new Error('Missing jwtSecret: pass an explicit >=32 character secret (no fallback)');
  }
  const jwtSecret = options.jwtSecret;
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  app.use((_req, res, next) => {
    const origin = _req.headers.origin as string | undefined;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10kb' }));

  const wsManager = createWebSocketServer(server);

  const broadcastSignal = (signal: unknown) => {
    wsManager.broadcast('SWARM_SIGNAL_NEW', signal);
  };

  const broadcastTrade = (trade: unknown) => {
    wsManager.broadcast('TRADE_EXECUTED', trade);
  };

  const marketFeedService = options.marketFeedService || new LiveMarketFeedService(15000);
  marketFeedService.onNewSignal((sig) => {
    broadcastSignal(sig);
    if (sig.priceUsd) {
      options.tradeService.updatePositionsPrice(new Map([[sig.tokenAddress.toLowerCase(), sig.priceUsd]]));
    }
    if (options.botManager) {
      options.botManager.queueSignal(sig);
    }
  });

  if (options.autoTradeService) {
    options.autoTradeService.onTradeEvent((event) => {
      wsManager.broadcast(event.type, event.data);
    });
  }

  const apiRouter = createApiRouter({
    walletService: options.walletService,
    tradeService: options.tradeService,
    marketFeedService,
    autoTradeService: options.autoTradeService,
    botManager: options.botManager,
    jwtSecret,
    onTradeExecuted: broadcastTrade,
  });

  app.use('/api', apiRouter);

  const staticPath = options.staticDir || path.resolve(process.cwd(), 'web/dist');
  app.use(express.static(staticPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(path.join(staticPath, 'index.html'), (err) => {
      if (err) {
        res.status(200).send('<!DOCTYPE html><html><body><h1>Predique</h1><p>Loading...</p></body></html>');
      }
    });
  });

  return {
    app,
    server,
    wsManager,
    marketFeedService,
    broadcastSignal,
    broadcastTrade,
  };
}
