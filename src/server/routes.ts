import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { WalletService } from '../services/wallet.service.js';
import { TradeService } from '../services/trade.service.js';
import { LiveMarketFeedService } from '../services/marketFeed.service.js';
import { AutoTradeService } from '../services/autoTrade.service.js';
import { BotManager } from '../bot/botManager.js';
import { maskToken } from '../utils/mask.js';
import {
  redeemOneTimeToken,
  signJwt,
  createAuthMiddleware,
  AuthenticatedRequest,
} from './auth.js';

const OTT_RE = /^ott_[a-f0-9]{48}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_HITS = 60;

function getClientIp(req: { ip?: string; headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  if (req.ip) return req.ip;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hitAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > AUTH_MAX_HITS;
}

export function resetAuthRateLimits(): void {
  authAttempts.clear();
}

export function isTelegramOperator(userId: string | undefined): boolean {
  if (!userId) return false;
  const tgId = userId.startsWith('tg_') ? userId.slice(3) : userId;
  if (!tgId) return false;
  const ids = BotManager.getTelegramAdminIds();
  if (ids.length === 0) return false;
  return ids.includes(tgId);
}

function isAdminAuthorized(req: AuthenticatedRequest): boolean {
  if (req.isAdmin === true) return true;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 32) return false;
  const provided = req.headers['x-admin-token'];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(adminToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface RouteDependencies {
  walletService: WalletService;
  tradeService: TradeService;
  marketFeedService?: LiveMarketFeedService;
  autoTradeService?: AutoTradeService;
  botManager?: BotManager;
  jwtSecret: string;
  onTradeExecuted?: (trade: unknown) => void;
}

export function createApiRouter(deps: RouteDependencies): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(deps.jwtSecret);

  router.post('/auth/token', (req, res: Response) => {
    const ip = getClientIp(req);
    if (hitAuthRateLimit(ip)) {
      console.warn(`auth rate-limited: ip=${ip} endpoint=/auth/token`);
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    const parsed = z.object({ token: z.string().regex(OTT_RE) }).safeParse(req.body || {});
    if (!parsed.success) {
      console.warn(`auth failed: ip=${ip} reason=bad-ott-format`);
      res.status(400).json({ error: 'Token parameter is required' });
      return;
    }

    const userId = redeemOneTimeToken(parsed.data.token);
    if (!userId) {
      console.warn(`auth failed: ip=${ip} reason=invalid-ott`);
      res.status(401).json({ error: 'Invalid or expired one-time token' });
      return;
    }

    const isAdmin = isTelegramOperator(userId);
    const jwtToken = signJwt(userId, deps.jwtSecret, isAdmin);
    res.json({
      jwt: jwtToken,
      userId,
      isAdmin,
    });
  });

  router.post('/auth/demo', (req, res: Response) => {
    const ip = getClientIp(req);
    if (hitAuthRateLimit(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    if (process.env.ALLOW_DEMO_AUTH !== 'true') {
      console.warn(`auth blocked: ip=${ip} endpoint=/auth/demo reason=demo-disabled`);
      res.status(403).json({ error: 'Demo auth disabled' });
      return;
    }
    const parsed = z.object({ userId: z.string().regex(USER_ID_RE).optional() }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid userId format' });
      return;
    }
    const guestId = parsed.data.userId || 'trader_guest';
    const jwtToken = signJwt(guestId, deps.jwtSecret, false);
    res.json({
      jwt: jwtToken,
      userId: guestId,
      isAdmin: false,
    });
  });

  interface UserTradeSettings {
    defaultSlippage: number;
    defaultAmount: number;
    moonbagDefault: boolean;
  }
  const userSettings = new Map<string, UserTradeSettings>();

  router.get('/settings', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userPref = (req.userId && userSettings.get(req.userId)) || {
      defaultSlippage: 5,
      defaultAmount: 0.1,
      moonbagDefault: true,
    };
    const status = deps.botManager?.getStatus() || { isRunning: false };
    const tokenMasked = deps.botManager?.getCurrentTokenMasked() || maskToken(process.env.BOT_TOKEN || '');
    const chConfig = deps.botManager?.getChannelConfig() || {
      channelId: process.env.TELEGRAM_CHANNEL_ID || '@predique',
      autoBroadcast: true,
      minTier: 'ALL',
      minLiquidityUsd: 10000,
      maxTaxPercent: 5,
      tokenCooldownMinutes: 15,
      maxSignalsPerHour: 12,
      muteMicroTpAlerts: false,
    };

    res.json({
      botStatus: status.isRunning ? 'ONLINE' : 'OFFLINE',
      botUsername: status.botUsername,
      botError: status.error,
      botTokenMasked: tokenMasked,
      defaultSlippage: userPref.defaultSlippage,
      defaultAmount: userPref.defaultAmount,
      moonbagDefault: userPref.moonbagDefault,
      channelId: chConfig.channelId,
      channelAutoBroadcast: chConfig.autoBroadcast,
      minSignalTier: chConfig.minTier,
      minLiquidityUsd: chConfig.minLiquidityUsd,
      maxTaxPercent: chConfig.maxTaxPercent,
      tokenCooldownMinutes: chConfig.tokenCooldownMinutes,
      maxSignalsPerHour: chConfig.maxSignalsPerHour,
      muteMicroTpAlerts: chConfig.muteMicroTpAlerts,
    });
  });

  router.post('/settings', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({
      botToken: z.string().trim().min(15).max(200).optional(),
      defaultSlippage: z.number().finite().min(0.1).max(50).optional(),
      defaultAmount: z.number().finite().gt(0).max(10).optional(),
      moonbagDefault: z.boolean().optional(),
      channelId: z.string().trim().min(2).max(64).optional(),
      channelAutoBroadcast: z.boolean().optional(),
      minSignalTier: z.string().trim().min(2).max(16).optional(),
      minLiquidityUsd: z.number().finite().min(0).max(1_000_000).optional(),
      maxTaxPercent: z.number().finite().min(0).max(50).optional(),
      tokenCooldownMinutes: z.number().finite().min(1).max(1440).optional(),
      maxSignalsPerHour: z.number().finite().min(1).max(60).optional(),
      muteMicroTpAlerts: z.boolean().optional(),
    }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings payload' });
      return;
    }
    const {
      botToken,
      defaultSlippage,
      defaultAmount,
      moonbagDefault,
      channelId,
      channelAutoBroadcast,
      minSignalTier,
      minLiquidityUsd,
      maxTaxPercent,
      tokenCooldownMinutes,
      maxSignalsPerHour,
      muteMicroTpAlerts,
    } = parsed.data;
    const userId = req.userId || 'trader_guest';

    const current = userSettings.get(userId) || {
      defaultSlippage: 5,
      defaultAmount: 0.1,
      moonbagDefault: true,
    };

    if (defaultSlippage !== undefined) current.defaultSlippage = defaultSlippage;
    if (defaultAmount !== undefined) current.defaultAmount = defaultAmount;
    if (moonbagDefault !== undefined) current.moonbagDefault = moonbagDefault;

    userSettings.set(userId, current);

    if (
      deps.botManager &&
      (channelId !== undefined ||
        channelAutoBroadcast !== undefined ||
        minSignalTier !== undefined ||
        minLiquidityUsd !== undefined ||
        maxTaxPercent !== undefined ||
        tokenCooldownMinutes !== undefined ||
        maxSignalsPerHour !== undefined ||
        muteMicroTpAlerts !== undefined)
    ) {
      deps.botManager.setChannelConfig({
        channelId,
        autoBroadcast: channelAutoBroadcast,
        minTier: minSignalTier,
        minLiquidityUsd,
        maxTaxPercent,
        tokenCooldownMinutes,
        maxSignalsPerHour,
        muteMicroTpAlerts,
      });
      // NOTE: in-memory only. Set TELEGRAM_CHANNEL_ID via environment/ops to persist.
    }

    let botRestarted = false;
    if (botToken !== undefined) {
      if (!isAdminAuthorized(req)) {
        console.warn(`security blocked: user=${userId} endpoint=/settings reason=botToken-without-admin`);
        res.status(403).json({ error: 'BOT_TOKEN rotation requires admin authorization' });
        return;
      }
      const cleanToken = botToken.trim();
      process.env.BOT_TOKEN = cleanToken;
      if (deps.botManager) {
        botRestarted = await deps.botManager.restart(cleanToken);
      }
      console.warn(`security event: user=${userId} rotated BOT_TOKEN via admin API`);
    }

    const status = deps.botManager?.getStatus() || { isRunning: false };
    const chConfig = deps.botManager?.getChannelConfig() || {
      channelId: channelId || '@predique',
      autoBroadcast: channelAutoBroadcast ?? true,
      minTier: minSignalTier || 'ALL',
    };

    res.json({
      status: 'SUCCESS',
      settings: current,
      channelConfig: chConfig,
      botStatus: status.isRunning ? 'ONLINE' : 'OFFLINE',
      botUsername: status.botUsername,
      botRestarted,
    });
  });

  router.post('/settings/test-channel', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({ channelId: z.string().trim().min(2).max(64).optional() }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid channelId' });
      return;
    }
    if (!deps.botManager) {
      res.json({ success: false, error: 'Bot manager not available' });
      return;
    }
    const result = await deps.botManager.sendTestMessage(parsed.data.channelId);
    res.json(result);
  });

  router.get('/user/profile', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userPref = (req.userId && userSettings.get(req.userId)) || {
      defaultSlippage: 5,
      defaultAmount: 0.1,
      moonbagDefault: true,
    };
    res.json({
      userId: req.userId,
      settings: userPref,
    });
  });

  router.get('/wallet/list', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mode = (req.query.mode as string)?.toLowerCase() === 'paper' ? 'paper' : 'live';

      await deps.walletService.getOrGenerateWallet(req.userId!, 'EVM');
      await deps.walletService.getOrGenerateWallet(req.userId!, 'SOLANA');

      const wallets = await deps.walletService.getWallets(req.userId!, mode);
      res.json({ wallets, mode });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/api/wallet/reset-paper', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const wallets = await deps.walletService.resetPaperBalance(req.userId!);
      deps.tradeService.clearPaperPositions(req.userId!);
      res.json({ status: 'SUCCESS', wallets });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/wallet/reset-paper', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const wallets = await deps.walletService.resetPaperBalance(req.userId!);
      deps.tradeService.clearPaperPositions(req.userId!);
      res.json({ status: 'SUCCESS', wallets });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/wallet/generate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const { chain } = req.body || {};
    if (chain !== 'EVM' && chain !== 'SOLANA') {
      res.status(400).json({ error: 'Chain must be EVM or SOLANA' });
      return;
    }

    try {
      const wallet = await deps.walletService.getOrGenerateWallet(req.userId!, chain);
      res.json({ wallet });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const handleSweep = async (req: AuthenticatedRequest, res: Response) => {
    const { chain, vaultAddress, reserveAmount, sweepAmount, mode } = req.body || {};
    if (!chain || (chain !== 'EVM' && chain !== 'SOLANA')) {
      res.status(400).json({ error: 'Chain must be EVM or SOLANA' });
      return;
    }
    if (!vaultAddress || typeof vaultAddress !== 'string') {
      res.status(400).json({ error: 'Valid vaultAddress is required' });
      return;
    }

    try {
      const result = await deps.walletService.sweepBalances(req.userId!, {
        chain,
        vaultAddress,
        reserveAmount: typeof reserveAmount === 'number' ? reserveAmount : undefined,
        sweepAmount: typeof sweepAmount === 'number' ? sweepAmount : undefined,
        mode: mode === 'live' ? 'live' : 'paper',
      });
      res.json({ result });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  };

  const handleGetVault = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const vaultBalances = await deps.walletService.getVaultBalances(req.userId!);
      res.json({ vaultBalances });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  };

  router.post('/wallet/sweep', authMiddleware, handleSweep);
  router.post('/api/wallet/sweep', authMiddleware, handleSweep);
  router.get('/wallet/vault', authMiddleware, handleGetVault);
  router.get('/api/wallet/vault', authMiddleware, handleGetVault);

  router.get('/signals', async (_req, res: Response) => {
    try {
      if (deps.marketFeedService) {
        let signals = deps.marketFeedService.getSignals();
        if (signals.length === 0) {
          signals = await deps.marketFeedService.fetchLiveMarketData();
        }
        res.json({ signals });
        return;
      }
      res.json({ signals: [] });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/trade/quick-buy', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const { tokenAddress, tokenSymbol, chain, amountIn, slippagePercent, enableMoonbagAutoTp, isPaper, entryPriceUsd } =
      req.body || {};

    if (!tokenAddress || !chain || !amountIn) {
      res.status(400).json({ error: 'tokenAddress, chain, and amountIn are required' });
      return;
    }

    try {
      const result = await deps.tradeService.executeQuickBuy({
        userId: req.userId!,
        tokenAddress,
        tokenSymbol: tokenSymbol || 'TOKEN',
        chain,
        amountIn: Number(amountIn),
        slippagePercent: Number(slippagePercent) || 5,
        enableMoonbagAutoTp: !!enableMoonbagAutoTp,
        isPaper: !!isPaper,
        entryPriceUsd: entryPriceUsd ? Number(entryPriceUsd) : undefined,
      });

      if (deps.onTradeExecuted) {
        deps.onTradeExecuted({
          userId: req.userId,
          tokenSymbol,
          isPaper: !!isPaper,
          ...result,
        });
      }

      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/trade/sell', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const { positionId, percentage, isPaper, currentPriceUsd } = req.body || {};
    if (!positionId) {
      res.status(400).json({ error: 'positionId is required' });
      return;
    }

    try {
      const result = await deps.tradeService.closePosition(
        req.userId!,
        positionId,
        percentage ? Number(percentage) : 100,
        !!isPaper,
        currentPriceUsd ? Number(currentPriceUsd) : undefined
      );
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/positions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isPaper = (req.query.mode as string)?.toLowerCase() === 'paper';
      const positions = await deps.tradeService.getPositions(req.userId!, isPaper);
      res.json({ positions, mode: isPaper ? 'paper' : 'live' });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/trade/history', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isPaper = (req.query.mode as string)?.toLowerCase() === 'paper';
      const history = await deps.tradeService.getTradeHistory(req.userId!, isPaper);

      const totalTrades = history.length;
      const winningTrades = history.filter((t) => t.pnlPercent > 0).length;
      const losingTrades = history.filter((t) => t.pnlPercent < 0).length;
      const winRate = totalTrades > 0 ? parseFloat(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;
      const totalRealizedPnlPercent = history.reduce((acc, t) => acc + t.pnlPercent, 0);

      res.json({
        history,
        summary: {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate,
          totalRealizedPnlPercent: parseFloat(totalRealizedPnlPercent.toFixed(2)),
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/trade/history/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isPaper = (req.query.mode as string)?.toLowerCase() === 'paper';
      const format = (req.query.format as string)?.toLowerCase() === 'csv' ? 'csv' : 'json';
      const history = await deps.tradeService.getTradeHistory(req.userId!, isPaper);

      if (format === 'csv') {
        const headers = [
          'Trade ID',
          'Position ID',
          'Token Symbol',
          'Token Address',
          'Chain',
          'Mode',
          'Amount In (Native)',
          'Entry Price (USD)',
          'Exit Price (USD)',
          'Entry Market Cap',
          'Exit Market Cap',
          'PnL %',
          '% Sold',
          'Hold Duration (sec)',
          'Opened At (ISO)',
          'Closed At (ISO)',
          'Transaction Hash',
        ];

        const rows = history.map((t) => [
          `"${t.id}"`,
          `"${t.positionId}"`,
          `"${t.tokenSymbol}"`,
          `"${t.tokenAddress}"`,
          `"${t.chain}"`,
          `"${t.isPaper ? 'PAPER' : 'LIVE'}"`,
          t.amountIn,
          t.entryPriceUsd ?? 'N/A',
          t.exitPriceUsd ?? 'N/A',
          t.entryMcap,
          t.exitMcap,
          t.pnlPercent,
          t.percentageSold,
          t.holdDurationSeconds,
          `"${new Date(t.openTimestamp).toISOString()}"`,
          `"${new Date(t.closeTimestamp).toISOString()}"`,
          `"${t.txHash}"`,
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const filename = `predique_trade_history_${req.userId}_${isPaper ? 'paper' : 'live'}_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
        return;
      }

      res.json({
        userId: req.userId,
        mode: isPaper ? 'paper' : 'live',
        exportedAt: new Date().toISOString(),
        totalCount: history.length,
        trades: history,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });


  router.get('/autotrade/config', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    res.json({
      config: deps.autoTradeService.getConfig(),
      stats: deps.autoTradeService.getStats(),
    });
  });

  router.post('/autotrade/config', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    const currentConfig = deps.autoTradeService.getConfig();
    const isLiveAttempt = (req.body && req.body.mode === 'LIVE') || currentConfig.mode === 'LIVE';

    if (isLiveAttempt && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/config reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade config requires admin authorization' });
      return;
    }

    const parsed = z.object({
      enabled: z.boolean().optional(),
      mode: z.enum(['PAPER', 'LIVE']).optional(),
      strategy: z.enum(['SWARM_MOMENTUM', 'MEAN_REVERSION', 'ENSEMBLE', 'BREAKOUT_SURGE', 'SNIPER_ALPHA']).optional(),
      maxTradeAmountNative: z.number().finite().gt(0).max(10).optional(),
      maxOpenPositions: z.number().int().min(1).max(10).optional(),
      slippagePercent: z.number().finite().min(0.1).max(50).optional(),
      takeProfitPercent: z.number().finite().min(1).max(500).optional(),
      stopLossPercent: z.number().finite().min(1).max(90).optional(),
      trailingStopPercent: z.number().finite().min(1).max(90).optional(),
      dailyMaxDrawdownPercent: z.number().finite().min(1).max(50).optional(),
      minLiquidityUsd: z.number().finite().min(0).max(100000000).optional()
    }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid autotrade config payload' });
      return;
    }
    const updated = deps.autoTradeService.updateConfig(parsed.data);
    res.json({
      status: 'SUCCESS',
      config: updated,
      stats: deps.autoTradeService.getStats(),
    });
  });

  router.post('/autotrade/toggle', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    const currentConfig = deps.autoTradeService.getConfig();
    if (currentConfig.mode === 'LIVE' && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/toggle reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade toggle requires admin authorization' });
      return;
    }
    const parsed = z.object({ enabled: z.boolean().optional() }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid toggle payload' });
      return;
    }
    const state = deps.autoTradeService.toggle(parsed.data.enabled);
    res.json({
      status: 'SUCCESS',
      enabled: state,
      config: deps.autoTradeService.getConfig(),
      stats: deps.autoTradeService.getStats(),
    });
  });

  router.get('/autotrade/stats', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    res.json({
      stats: deps.autoTradeService.getStats(),
    });
  });

  router.get('/autotrade/positions', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    res.json({
      positions: deps.autoTradeService.getAutoPositions(),
    });
  });

  router.get('/autotrade/history', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    res.json({
      history: deps.autoTradeService.getTradeHistory(),
    });
  });

  router.post('/autotrade/close', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    const currentConfig = deps.autoTradeService.getConfig();
    if (currentConfig.mode === 'LIVE' && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/close reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade close requires admin authorization' });
      return;
    }
    const parsed = z.object({ positionId: z.string().min(1).max(128) }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'positionId is required' });
      return;
    }
    const success = await deps.autoTradeService.manualExitPosition(parsed.data.positionId);
    res.json({
      status: success ? 'SUCCESS' : 'FAILED',
      positions: deps.autoTradeService.getAutoPositions(),
    });
  });

  router.post('/autotrade/reset-circuit-breaker', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    const currentConfig = deps.autoTradeService.getConfig();
    if (currentConfig.mode === 'LIVE' && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/reset-circuit-breaker reason=no-admin-for-live`);
      res.status(403).json({ error: 'Reset requires admin authorization' });
      return;
    }
    deps.autoTradeService.resetCircuitBreaker();
    res.json({
      status: 'SUCCESS',
      stats: deps.autoTradeService.getStats(),
    });
  });

  router.get('/autotrade/bots', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }
    res.json({
      bots: deps.autoTradeService.getBots(),
    });
  });

  router.post('/autotrade/bots', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }

    const isLiveAttempt = req.body && req.body.mode === 'LIVE';
    if (isLiveAttempt && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/bots reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade bot creation requires admin authorization' });
      return;
    }

    const schema = z.object({
      name: z.string().min(1).max(64),
      enabled: z.boolean().default(true),
      mode: z.enum(['PAPER', 'LIVE']).default('PAPER'),
      strategy: z.enum(['SWARM_MOMENTUM', 'MEAN_REVERSION', 'ENSEMBLE', 'BREAKOUT_SURGE', 'SNIPER_ALPHA']).default('SWARM_MOMENTUM'),
      chain: z.enum(['ALL', 'SOLANA', 'BASE', 'ETH']).default('ALL'),
      maxTradeAmountNative: z.number().finite().gt(0).max(10).default(0.1),
      maxOpenPositions: z.number().int().min(1).max(10).default(3),
      slippagePercent: z.number().finite().min(0.1).max(50).default(5),
      takeProfitPercent: z.number().finite().min(1).max(500).default(35),
      stopLossPercent: z.number().finite().min(1).max(90).default(12),
      trailingStopPercent: z.number().finite().min(1).max(90).default(10),
      dailyMaxDrawdownPercent: z.number().finite().min(1).max(50).default(5),
      minLiquidityUsd: z.number().finite().min(0).max(100000000).default(15000),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bot creation payload', details: parsed.error.issues });
      return;
    }

    const createdBot = await deps.autoTradeService.createBot(parsed.data);
    res.status(201).json({
      status: 'SUCCESS',
      bot: createdBot,
    });
  });

  router.put('/autotrade/bots/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }

    const isLiveAttempt = req.body && req.body.mode === 'LIVE';
    if (isLiveAttempt && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/bots/:id reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade bot update requires admin authorization' });
      return;
    }

    const schema = z.object({
      name: z.string().min(1).max(64).optional(),
      enabled: z.boolean().optional(),
      mode: z.enum(['PAPER', 'LIVE']).optional(),
      strategy: z.enum(['SWARM_MOMENTUM', 'MEAN_REVERSION', 'ENSEMBLE', 'BREAKOUT_SURGE', 'SNIPER_ALPHA']).optional(),
      chain: z.enum(['ALL', 'SOLANA', 'BASE', 'ETH']).optional(),
      maxTradeAmountNative: z.number().finite().gt(0).max(10).optional(),
      maxOpenPositions: z.number().int().min(1).max(10).optional(),
      slippagePercent: z.number().finite().min(0.1).max(50).optional(),
      takeProfitPercent: z.number().finite().min(1).max(500).optional(),
      stopLossPercent: z.number().finite().min(1).max(90).optional(),
      trailingStopPercent: z.number().finite().min(1).max(90).optional(),
      dailyMaxDrawdownPercent: z.number().finite().min(1).max(50).optional(),
      minLiquidityUsd: z.number().finite().min(0).max(100000000).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bot update payload' });
      return;
    }

    const botId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await deps.autoTradeService.updateBot(botId, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({
      status: 'SUCCESS',
      bot: updated,
    });
  });

  router.post('/autotrade/bots/:id/toggle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }

    const botId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetBot = deps.autoTradeService.getBot(botId);
    if (targetBot && targetBot.mode === 'LIVE' && !isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/autotrade/bots/:id/toggle reason=no-admin-for-live`);
      res.status(403).json({ error: 'LIVE AutoTrade toggle requires admin authorization' });
      return;
    }

    const parsed = z.object({ enabled: z.boolean().optional() }).safeParse(req.body || {});
    const updated = await deps.autoTradeService.toggleBot(botId, parsed.success ? parsed.data.enabled : undefined);
    if (!updated) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({
      status: 'SUCCESS',
      bot: updated,
    });
  });

  router.delete('/autotrade/bots/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }

    const botId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const success = await deps.autoTradeService.deleteBot(botId);
    res.json({
      success,
    });
  });

  router.post('/autotrade/pause-all', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    if (!deps.autoTradeService) {
      res.status(503).json({ error: 'AutoTradeService not initialized' });
      return;
    }

    await deps.autoTradeService.pauseAllBots();
    res.json({
      status: 'SUCCESS',
      bots: deps.autoTradeService.getBots(),
    });
  });

  router.post('/feed/ingest-swap', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!deps.marketFeedService) {
      res.status(503).json({ error: 'MarketFeedService not initialized' });
      return;
    }

    const swapSchema = z.object({
      walletAddress: z.string().min(10).max(64),
      chain: z.enum(['SOLANA', 'BASE', 'ETH', 'BNB', 'ROBINHOOD']),
      tokenAddress: z.string().min(10).max(64),
      tokenSymbol: z.string().min(1).max(32),
      amountUsd: z.number().positive(),
      txHash: z.string().min(10).max(128),
      timestamp: z.number().optional(),
      marketCap: z.number().optional(),
      liquidityUsd: z.number().optional(),
      isSell: z.boolean().optional(),
    });

    const parsed = swapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid swap payload', details: parsed.error.issues });
      return;
    }

    const event = {
      ...parsed.data,
      timestamp: parsed.data.timestamp || Date.now(),
    };

    const signal = await deps.marketFeedService.ingestSwap(event);

    res.json({
      status: 'SUCCESS',
      signalTriggered: !!signal,
      signal: signal || null,
    });
  });

  router.get('/smart-wallets', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
    const registry = deps.marketFeedService?.getSwarmDetector()?.getRegistry();
    if (!registry) {
      res.json({
        wallets: [],
        total: 0,
      });
      return;
    }

    const wallets = registry.getAllWallets();
    res.json({
      wallets,
      total: wallets.length,
    });
  });

  router.post('/smart-wallets', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    if (!isAdminAuthorized(req)) {
      console.warn(`security blocked: user=${req.userId} endpoint=/smart-wallets reason=no-admin`);
      res.status(403).json({ error: 'Admin authorization required to register alpha wallets' });
      return;
    }

    const registry = deps.marketFeedService?.getSwarmDetector()?.getRegistry();
    if (!registry) {
      res.status(503).json({ error: 'SmartWalletRegistry is unavailable (SwarmDetector offline)' });
      return;
    }

    const newWalletSchema = z.object({
      address: z.string().min(10).max(64),
      chain: z.enum(['SOLANA', 'EVM']),
      label: z.string().min(2).max(64),
      tag: z.enum(['ALPHA_SNIPER', 'WHALE', 'KOL', 'INSIDER']),
      winRate30d: z.number().min(0).max(100),
      totalPnlUsd: z.number(),
    });

    const parsed = newWalletSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid wallet payload', details: parsed.error.issues });
      return;
    }

    registry.registerWallet(parsed.data);

    res.json({
      status: 'SUCCESS',
      wallet: parsed.data,
      total: registry.getAllWallets().length,
    });
  });

  return router;
}
