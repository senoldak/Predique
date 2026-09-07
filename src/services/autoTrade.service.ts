import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import { generateClientOrderId, type TradeService } from './trade.service.js';
import type { WalletService } from './wallet.service.js';
import type { LiveMarketFeedService, PublicTokenSignal } from './marketFeed.service.js';
import {
  evaluateSignalForStrategy,
  calculateKellyTradeSize,
  calculateDrawdownModulation,
} from '../engine/strategyEvaluator.js';
import type {
  AutoTradeConfig,
  AutoTradeStats,
  AutoTradePosition,
  AutoTradeHistoryItem,
  AutoTradeEvent,
  AutoTradeEventType,
  AutoTradeBotInstance,
} from '../types/autotrade.js';

export class AutoTradeService {
  private tradeService: TradeService;
  private walletService: WalletService;
  private marketFeedService?: LiveMarketFeedService;

  private config: AutoTradeConfig = {
    enabled: false,
    mode: 'PAPER',
    strategy: 'SWARM_MOMENTUM',
    maxTradeAmountNative: 0.1,
    maxOpenPositions: 3,
    slippagePercent: 5,
    takeProfitPercent: 35,
    stopLossPercent: 12,
    trailingStopPercent: 10,
    dailyMaxDrawdownPercent: 5,
    minLiquidityUsd: 15000,
  };

  private stats: AutoTradeStats = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnlNative: 0,
    profitFactor: 1.0,
    peakDrawdownPercent: 0,
    currentDailyDrawdownPercent: 0,
    circuitBreakerActive: false,
    activeAutoPositionsCount: 0,
  };

  private bots: Map<string, AutoTradeBotInstance> = new Map();
  private static readonly BOTS_KEY = 'predique:autotrade:bots';

  private activePositions: Map<string, AutoTradePosition> = new Map();
  private tradeHistory: AutoTradeHistoryItem[] = [];
  private eventListeners: ((event: AutoTradeEvent) => void)[] = [];
  private lastExitAt: Map<string, number> = new Map();
  private static readonly REENTRY_COOLDOWN_MS = 3600000;

  private dailyStartingEquityNative: number = 10.0;
  private dailyRealizedPnlNative: number = 0;
  private peakEquityNative: number = 10.0;
  private equityDayKey: string = AutoTradeService.utcDay();
  private grossProfitNative: number = 0;
  private grossLossNative: number = 0;

  private exitMonitorTimer: NodeJS.Timeout | null = null;
  private exitIntervalMs: number;
  private isEvaluatingExits: boolean = false;
  private redis: Redis | null = null;
  private static readonly POS_KEY = 'predique:autotrade:positions';
  private static readonly HIST_KEY = 'predique:autotrade:history';

  private postgres?: import('../database/postgres.adapter.js').PostgresStorageAdapter | null = null;

  constructor(
    tradeService: TradeService,
    walletService: WalletService,
    marketFeedService?: LiveMarketFeedService,
    exitIntervalMs: number = 4000,
    redis?: Redis | null,
    postgres?: import('../database/postgres.adapter.js').PostgresStorageAdapter | null
  ) {
    this.tradeService = tradeService;
    this.walletService = walletService;
    this.marketFeedService = marketFeedService;
    this.exitIntervalMs = exitIntervalMs;
    this.postgres = postgres;

    this.initDefaultBot();

    if (redis || postgres) {
      if (redis) this.redis = redis;
      void this.loadPersistedState();
    }

    if (this.marketFeedService) {
      this.marketFeedService.onNewSignal((signal) => {
        this.processSignal(signal).catch((err) => {
          console.warn('⚠️ AutoTrade signal processing error:', (err as Error).message);
        });
      });
    }

    this.startExitMonitor();
  }

  private initDefaultBot(): void {
    const defaultBot: AutoTradeBotInstance = {
      id: 'bot_default',
      name: 'Default Swarm Bot',
      enabled: this.config.enabled,
      mode: this.config.mode,
      strategy: this.config.strategy,
      chain: 'ALL',
      maxTradeAmountNative: this.config.maxTradeAmountNative,
      maxOpenPositions: this.config.maxOpenPositions,
      slippagePercent: this.config.slippagePercent,
      takeProfitPercent: this.config.takeProfitPercent,
      stopLossPercent: this.config.stopLossPercent,
      trailingStopPercent: this.config.trailingStopPercent,
      dailyMaxDrawdownPercent: this.config.dailyMaxDrawdownPercent,
      minLiquidityUsd: this.config.minLiquidityUsd,
      createdAt: Date.now(),
      stats: { ...this.stats },
    };
    this.bots.set(defaultBot.id, defaultBot);
  }

  public getBots(): AutoTradeBotInstance[] {
    return Array.from(this.bots.values());
  }

  public getBot(id: string): AutoTradeBotInstance | undefined {
    return this.bots.get(id);
  }

  public async createBot(params: Omit<AutoTradeBotInstance, 'id' | 'createdAt' | 'stats'>): Promise<AutoTradeBotInstance> {
    const id = `bot_${crypto.randomBytes(4).toString('hex')}`;
    const bot: AutoTradeBotInstance = {
      ...params,
      id,
      createdAt: Date.now(),
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnlNative: 0,
        profitFactor: 1.0,
        peakDrawdownPercent: 0,
        currentDailyDrawdownPercent: 0,
        circuitBreakerActive: false,
        activeAutoPositionsCount: 0,
      },
    };
    this.bots.set(id, bot);
    void this.savePersistedState();
    this.emitEvent('AUTOTRADE_STATE', { bots: this.getBots(), stats: this.stats });
    return bot;
  }

  public async updateBot(id: string, partial: Partial<AutoTradeBotInstance>): Promise<AutoTradeBotInstance | undefined> {
    const bot = this.bots.get(id);
    if (!bot) return undefined;
    const updated = {
      ...bot,
      ...partial,
      id: bot.id,
      createdAt: bot.createdAt,
    };
    this.bots.set(id, updated);
    void this.savePersistedState();
    this.emitEvent('AUTOTRADE_STATE', { bots: this.getBots(), stats: this.stats });
    return updated;
  }

  public async toggleBot(id: string, enabled?: boolean): Promise<AutoTradeBotInstance | undefined> {
    const bot = this.bots.get(id);
    if (!bot) return undefined;
    bot.enabled = enabled !== undefined ? enabled : !bot.enabled;
    this.bots.set(id, bot);
    void this.savePersistedState();
    this.emitEvent('AUTOTRADE_STATE', { bots: this.getBots(), stats: this.stats });
    return bot;
  }

  public async deleteBot(id: string): Promise<boolean> {
    if (id === 'bot_default' && this.bots.size === 1) {

      const b = this.bots.get(id);
      if (b) b.enabled = false;
      return true;
    }
    const res = this.bots.delete(id);
    if (res) {
      if (this.postgres) {
        void this.postgres.deleteBot(id).catch((err) => {
          console.warn('AutoTrade Postgres deleteBot failed:', (err as Error).message);
        });
      }
      void this.savePersistedState();
      this.emitEvent('AUTOTRADE_STATE', { bots: this.getBots(), stats: this.stats });
    }
    return res;
  }

  public async pauseAllBots(): Promise<void> {
    this.config.enabled = false;
    for (const bot of this.bots.values()) {
      bot.enabled = false;
    }
    void this.savePersistedState();
    this.emitEvent('AUTOTRADE_STATE', { bots: this.getBots(), stats: this.stats });
  }

  public getConfig(): AutoTradeConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<AutoTradeConfig>): AutoTradeConfig {
    this.config = {
      ...this.config,
      ...partial,
    };

    const defaultBot = this.bots.get('bot_default');
    if (defaultBot) {
      defaultBot.enabled = this.config.enabled;
      defaultBot.mode = this.config.mode;
      defaultBot.strategy = this.config.strategy;
      defaultBot.maxTradeAmountNative = this.config.maxTradeAmountNative;
      defaultBot.maxOpenPositions = this.config.maxOpenPositions;
      defaultBot.slippagePercent = this.config.slippagePercent;
      defaultBot.takeProfitPercent = this.config.takeProfitPercent;
      defaultBot.stopLossPercent = this.config.stopLossPercent;
      defaultBot.trailingStopPercent = this.config.trailingStopPercent;
      defaultBot.dailyMaxDrawdownPercent = this.config.dailyMaxDrawdownPercent;
      defaultBot.minLiquidityUsd = this.config.minLiquidityUsd;
    }
    this.emitEvent('AUTOTRADE_STATE', { config: this.config, bots: this.getBots(), stats: this.stats });
    return this.getConfig();
  }

  public toggle(enabled?: boolean): boolean {
    this.config.enabled = enabled !== undefined ? enabled : !this.config.enabled;
    const defaultBot = this.bots.get('bot_default');
    if (defaultBot) defaultBot.enabled = this.config.enabled;
    this.emitEvent('AUTOTRADE_STATE', { config: this.config, bots: this.getBots(), stats: this.stats });
    return this.config.enabled;
  }

  public getStats(): AutoTradeStats {
    return {
      ...this.stats,
      activeAutoPositionsCount: this.activePositions.size,
    };
  }

  public getAutoPositions(): AutoTradePosition[] {
    return Array.from(this.activePositions.values());
  }

  public getTradeHistory(): AutoTradeHistoryItem[] {
    return [...this.tradeHistory];
  }

  public onTradeEvent(cb: (event: AutoTradeEvent) => void): void {
    this.eventListeners.push(cb);
  }

  private emitEvent(type: AutoTradeEventType, data: Record<string, unknown>): void {
    const event: AutoTradeEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('AutoTrade event listener error:', err);
      }
    }
  }

  public setRedis(redis: Redis | null): void {
    this.redis = redis;
    if (redis) void this.loadPersistedState();
  }

  public setPostgresAdapter(postgres: import('../database/postgres.adapter.js').PostgresStorageAdapter | null): void {
    this.postgres = postgres;
  }

  private async loadPersistedState(): Promise<void> {
    let loadedFromRedis = false;
    if (this.redis) {
      try {
        const [posRaw, histRaw, botsRaw] = await Promise.all([
          this.redis.get(AutoTradeService.POS_KEY),
          this.redis.get(AutoTradeService.HIST_KEY),
          this.redis.get(AutoTradeService.BOTS_KEY),
        ]);
        if (botsRaw) {
          const arr = JSON.parse(botsRaw) as AutoTradeBotInstance[];
          if (Array.isArray(arr) && arr.length > 0) {
            this.bots = new Map(arr.map(b => [b.id, b]));
            loadedFromRedis = true;
          }
        }
        if (posRaw) {
          const arr = JSON.parse(posRaw) as AutoTradePosition[];
          if (Array.isArray(arr)) {
            this.activePositions = new Map(arr.map(p => [p.id, p]));
          }
        }
        if (histRaw) {
          const h = JSON.parse(histRaw) as AutoTradeHistoryItem[];
          if (Array.isArray(h)) this.tradeHistory = h.slice(0, 50);
        }
      } catch (err) {
        console.warn('AutoTrade Redis load failed:', (err as Error).message);
      }
    }

    if (!loadedFromRedis && this.postgres) {
      try {
        const pgBots = await this.postgres.getBots();
        if (Array.isArray(pgBots) && pgBots.length > 0) {
          this.bots = new Map(pgBots.map(b => [b.id, b]));
          if (this.redis) {
            await this.redis.set(AutoTradeService.BOTS_KEY, JSON.stringify(Array.from(this.bots.values()))).catch(() => undefined);
          }
        }
      } catch (err) {
        console.warn('AutoTrade Postgres load failed:', (err as Error).message);
      }
    }
  }

  private async savePersistedState(): Promise<void> {
    if (this.redis) {
      try {
        await Promise.all([
          this.redis.set(AutoTradeService.BOTS_KEY, JSON.stringify(Array.from(this.bots.values()))),
          this.redis.set(AutoTradeService.POS_KEY, JSON.stringify(Array.from(this.activePositions.values()))),
          this.redis.set(AutoTradeService.HIST_KEY, JSON.stringify(this.tradeHistory.slice(0, 50)))
        ]);
      } catch (err) {
        console.warn('AutoTrade Redis save failed:', (err as Error).message);
      }
    }

    if (this.postgres) {
      try {
        for (const bot of this.bots.values()) {
          await this.postgres.saveBot(bot);
        }
      } catch (err) {
        console.warn('AutoTrade Postgres save failed:', (err as Error).message);
      }
    }
  }

  public async processSignal(signal: PublicTokenSignal): Promise<boolean> {
    const activeBots = Array.from(this.bots.values()).filter((b) => b.enabled);
    if (activeBots.length === 0) return false;
    if (this.stats.circuitBreakerActive) return false;

    if (!signal.priceUsd || signal.priceUsd <= 0) {
      console.warn(`AutoTrade skipped ${signal.tokenSymbol}: missing priceUsd`);
      return false;
    }

    const MAX_SIGNAL_AGE_MS = 90_000;
    if (signal.timestamp && Date.now() - signal.timestamp > MAX_SIGNAL_AGE_MS) {
      console.warn(`[DeadManSwitch] Skipped stale signal for ${signal.tokenSymbol} (age: ${Math.round((Date.now() - signal.timestamp) / 1000)}s > 90s)`);
      return false;
    }

    const normalizedAddress = signal.tokenAddress.toLowerCase();

    const lastExit = this.lastExitAt.get(normalizedAddress);
    if (lastExit && Date.now() - lastExit < AutoTradeService.REENTRY_COOLDOWN_MS) {
      return false;
    }

    let anyTriggered = false;

    for (const bot of activeBots) {

      if (bot.chain !== 'ALL') {
        const signalChain = signal.chain.toUpperCase();
        if (bot.chain !== signalChain && !(bot.chain === 'ETH' && signalChain === 'EVM')) {
          continue;
        }
      }

      const botPositions = Array.from(this.activePositions.values()).filter((p) => p.botId === bot.id);
      if (botPositions.length >= bot.maxOpenPositions) {
        continue;
      }

      if (botPositions.some((p) => p.tokenAddress.toLowerCase() === normalizedAddress)) {
        continue;
      }

      const evaluation = evaluateSignalForStrategy(signal, bot.strategy, bot as unknown as AutoTradeConfig);
      if (!evaluation.shouldEnter) {
        continue;
      }

      const currentDdFraction = (bot.stats?.currentDailyDrawdownPercent ?? this.stats.currentDailyDrawdownPercent) / 100;
      const maxDdFraction = bot.dailyMaxDrawdownPercent / 100;
      const modulationMultiplier = calculateDrawdownModulation(currentDdFraction, maxDdFraction);

      if (modulationMultiplier <= 0) {
        this.tripCircuitBreaker(`Drawdown limit reached for ${bot.name}`);
        continue;
      }

      const isPaper = bot.mode === 'PAPER';
      const chainType = signal.chain.toUpperCase() === 'SOLANA' ? 'SOLANA' : 'EVM';
      const defaultUserId = isPaper ? 'trader_paper_auto' : 'trader_live_auto';

      let availableBalance = 1.0;
      try {
        if (isPaper) {
          const paperBal = await this.walletService.getOrCreatePaperBalancesAsync(defaultUserId);
          availableBalance = chainType === 'SOLANA' ? paperBal.solana : paperBal.evm;
        } else {
          const wallets = await this.walletService.getWallets(defaultUserId, 'live');
          const targetWallet = wallets.find((w) => w.chain === chainType);
          if (targetWallet && targetWallet.balance > 0) {
            availableBalance = targetWallet.balance;
          }
        }
      } catch {
        // Fallback
      }

      const totalBotTrades = bot.stats?.totalTrades ?? this.stats.totalTrades;
      const provenEdge = totalBotTrades >= 20;
      const estimatedWinRate = provenEdge ? (bot.stats?.winRate ?? this.stats.winRate) / 100 : 0.65;
      const estimatedProfitFactor = provenEdge && (bot.stats?.profitFactor ?? this.stats.profitFactor) > 0
        ? (bot.stats?.profitFactor ?? this.stats.profitFactor)
        : 2.0;

      let tradeSize = calculateKellyTradeSize(
        availableBalance,
        estimatedWinRate,
        estimatedProfitFactor,
        bot.maxTradeAmountNative
      );

      tradeSize = Math.floor(tradeSize * modulationMultiplier * 10000) / 10000;
      if (totalBotTrades < 20) {
        tradeSize = Math.min(tradeSize, bot.maxTradeAmountNative * 0.25);
      }
      if (tradeSize <= 0) {
        tradeSize = Math.min(bot.maxTradeAmountNative, 0.05);
      }

      const entryPriceUsd = signal.priceUsd;
      const rawChain = signal.chain.toUpperCase();
      const chain = (rawChain === 'BSC' ? 'BNB' : rawChain) as 'SOLANA' | 'BASE' | 'ETH' | 'BNB' | 'ROBINHOOD';
      const clientOrderId = generateClientOrderId(defaultUserId, signal.tokenAddress, bot.id);

      try {
        const buyResult = await this.tradeService.executeQuickBuy({
          userId: defaultUserId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.tokenSymbol,
          chain,
          amountIn: tradeSize,
          slippagePercent: bot.slippagePercent,
          enableMoonbagAutoTp: true,
          entryMcap: signal.mcap,
          isPaper,
          entryPriceUsd,
          clientOrderId,
        });

        if (buyResult.status === 'SUCCESS') {
          const hardStopPrice = entryPriceUsd * (1 - bot.stopLossPercent / 100);

          const autoPos: AutoTradePosition = {
            id: buyResult.positionId,
            botId: bot.id,
            botName: bot.name,
            userId: defaultUserId,
            tokenAddress: signal.tokenAddress,
            tokenSymbol: signal.tokenSymbol,
            chain: signal.chain,
            amountIn: tradeSize,
            entryMcap: signal.mcap,
            currentMcap: signal.mcap,
            entryPriceUsd,
            currentPriceUsd: entryPriceUsd,
            pnlPercent: 0,
            moonbagActive: true,
            timestamp: Date.now(),
            isPaper,
            strategy: bot.strategy,
            highestPriceUsd: entryPriceUsd,
            tp1Hit: false,
            stopLossPriceUsd: hardStopPrice,
            entryTimestamp: Date.now(),
            originalAmountIn: tradeSize,
          };

          this.activePositions.set(autoPos.id, autoPos);
          anyTriggered = true;
          void this.savePersistedState();
          this.emitEvent('AUTOTRADE_BUY', { position: autoPos, rationale: evaluation.reason, botId: bot.id, botName: bot.name });
        }
      } catch (err) {
        console.warn(`⚠️ AutoTrade execution error for bot ${bot.name}:`, (err as Error).message);
      }
    }

    return anyTriggered;
  }

  public async evaluateActivePositions(externalPriceMap?: Map<string, number>): Promise<void> {
    if (this.isEvaluatingExits || this.activePositions.size === 0) return;
    this.isEvaluatingExits = true;

    try {
      let priceMap = externalPriceMap;

      if (!priceMap && this.marketFeedService) {
        const signals = this.marketFeedService.getSignals();
        priceMap = new Map();
        for (const sig of signals) {
          if (sig.priceUsd) {
            priceMap.set(sig.tokenAddress.toLowerCase(), sig.priceUsd);
          }
        }
      }

      if (!priceMap) {
        this.isEvaluatingExits = false;
        return;
      }

      for (const [posId, pos] of Array.from(this.activePositions.entries())) {
        const currentPrice =
          priceMap.get(pos.tokenAddress.toLowerCase()) ?? priceMap.get(pos.tokenAddress);

        if (!currentPrice || currentPrice <= 0) continue;

        pos.currentPriceUsd = currentPrice;
        if (currentPrice > pos.highestPriceUsd) {
          pos.highestPriceUsd = currentPrice;
        }

        const bot = pos.botId ? this.bots.get(pos.botId) : undefined;
        const tpPercent = bot ? bot.takeProfitPercent : this.config.takeProfitPercent;
        const trailingPercent = bot ? bot.trailingStopPercent : this.config.trailingStopPercent;

        const entryPrice = pos.entryPriceUsd || currentPrice;
        const currentPnlPercent = parseFloat((((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2));
        pos.pnlPercent = currentPnlPercent;

        if (!pos.tp1Hit && currentPnlPercent >= tpPercent) {
          try {
            const soldHalf = parseFloat((pos.amountIn * 0.5).toFixed(8));
            const tp1Result = await this.tradeService.closePosition(pos.userId, pos.id, 50, pos.isPaper, currentPrice);
            pos.amountIn = parseFloat((pos.amountIn * 0.5).toFixed(8));
            pos.tp1Hit = true;

            const tp1Returned = tp1Result.returnedAmount
              ?? parseFloat((soldHalf * (currentPrice / entryPrice)).toFixed(8));
            pos.tp1PnlNative = parseFloat((tp1Returned - soldHalf).toFixed(8));
            void this.savePersistedState();

            pos.stopLossPriceUsd = entryPrice;

            this.emitEvent('AUTOTRADE_TP1', {
              position: pos,
              pnlPercent: currentPnlPercent,
              priceUsd: currentPrice,
            });
          } catch (err) {
            console.warn(`Failed to execute TP1 for ${pos.tokenSymbol}:`, (err as Error).message);
            if ((err as Error).message.includes('not found')) {

              this.activePositions.delete(posId);
              void this.savePersistedState();
            }
          }
        }

        const trailingThreshold = pos.highestPriceUsd * (1 - trailingPercent / 100);
        const hitTrailingStop = pos.tp1Hit && currentPrice <= trailingThreshold;
        const hitHardStop = currentPrice <= pos.stopLossPriceUsd;

        if (hitTrailingStop || hitHardStop) {
          const exitReason = hitTrailingStop ? 'TRAILING_STOP' : 'HARD_STOP';
          try {
            const closeResult = await this.tradeService.closePosition(
              pos.userId,
              pos.id,
              100,
              pos.isPaper,
              currentPrice
            );

            this.activePositions.delete(posId);
            this.lastExitAt.set(pos.tokenAddress.toLowerCase(), Date.now());

            const secondHalfPnl = closeResult.returnedAmount
              ? parseFloat((closeResult.returnedAmount - pos.amountIn).toFixed(8))
              : parseFloat((pos.amountIn * (currentPnlPercent / 100)).toFixed(8));
            const pnlNative = parseFloat(((pos.tp1PnlNative || 0) + secondHalfPnl).toFixed(8));

            const historyItem: AutoTradeHistoryItem = {
              id: `hist_${crypto.randomBytes(6).toString('hex')}`,
              botId: pos.botId,
              botName: pos.botName,
              positionId: pos.id,
              tokenAddress: pos.tokenAddress,
              tokenSymbol: pos.tokenSymbol,
              chain: pos.chain,
              strategy: pos.strategy,
              mode: pos.isPaper ? 'PAPER' : 'LIVE',
              entryPriceUsd: entryPrice,
              exitPriceUsd: currentPrice,
              amountIn: pos.originalAmountIn ?? pos.amountIn,
              pnlPercent: currentPnlPercent,
              pnlNative,
              exitReason,
              timestamp: Date.now(),
            };

            this.tradeHistory.unshift(historyItem);
            if (this.tradeHistory.length > 50) this.tradeHistory.pop();

            this.recordTradePerformance(pnlNative, currentPnlPercent >= 0);
            void this.savePersistedState();

            this.emitEvent('AUTOTRADE_EXIT', {
              historyItem,
              exitReason,
            });

            if (pnlNative > 0) {
              await this.triggerAutoSweepIfNeeded(pos.userId, pos.chain, pos.isPaper ? 'paper' : 'live');
            }
          } catch (err) {
            console.warn(`Failed to close position ${pos.tokenSymbol}:`, (err as Error).message);
            if ((err as Error).message.includes('not found')) {
              this.activePositions.delete(posId);
              void this.savePersistedState();
            }
          }
        }
      }
    } finally {
      this.isEvaluatingExits = false;
    }
  }

  public async manualExitPosition(positionId: string): Promise<boolean> {
    const pos = this.activePositions.get(positionId);
    if (!pos) return false;

    try {
      const priceNow = pos.currentPriceUsd || pos.entryPriceUsd || 1.0;
      const closeResult = await this.tradeService.closePosition(pos.userId, pos.id, 100, pos.isPaper, priceNow);
      this.activePositions.delete(positionId);
      this.lastExitAt.set(pos.tokenAddress.toLowerCase(), Date.now());

      const secondHalfPnl = closeResult.returnedAmount
        ? parseFloat((closeResult.returnedAmount - pos.amountIn).toFixed(8))
        : 0;
      const pnlNative = parseFloat(((pos.tp1PnlNative || 0) + secondHalfPnl).toFixed(8));

      const historyItem: AutoTradeHistoryItem = {
        id: `hist_${crypto.randomBytes(6).toString('hex')}`,
        botId: pos.botId,
        botName: pos.botName,
        positionId: pos.id,
        tokenAddress: pos.tokenAddress,
        tokenSymbol: pos.tokenSymbol,
        chain: pos.chain,
        strategy: pos.strategy,
        mode: pos.isPaper ? 'PAPER' : 'LIVE',
        entryPriceUsd: pos.entryPriceUsd || priceNow,
        exitPriceUsd: priceNow,
        amountIn: pos.originalAmountIn ?? pos.amountIn,
        pnlPercent: pos.pnlPercent,
        pnlNative,
        exitReason: 'MANUAL',
        timestamp: Date.now(),
      };

      this.tradeHistory.unshift(historyItem);
      this.recordTradePerformance(pnlNative, pos.pnlPercent >= 0);
      void this.savePersistedState();
      this.emitEvent('AUTOTRADE_EXIT', { historyItem, exitReason: 'MANUAL' });
      if (pnlNative > 0) {
        void this.triggerAutoSweepIfNeeded(pos.userId, pos.chain, pos.isPaper ? 'paper' : 'live');
      }
      return true;
    } catch (err) {
      console.warn('Manual exit failed:', (err as Error).message);
      return false;
    }
  }

  public async triggerAutoSweepIfNeeded(userId: string, chainStr: string, mode: 'paper' | 'live'): Promise<void> {
    if (!this.config.autoSweepEnabled || !this.config.vaultAddress) {
      return;
    }

    const chain: 'EVM' | 'SOLANA' = chainStr.toUpperCase() === 'SOLANA' ? 'SOLANA' : 'EVM';
    const threshold = this.config.autoSweepThresholdNative ?? 0;
    const reserve = this.config.autoSweepReserveNative ?? 0;

    try {
      let currentBalance = 0;
      if (mode === 'paper') {
        const paperBal = await this.walletService.getOrCreatePaperBalancesAsync(userId);
        currentBalance = chain === 'EVM' ? paperBal.evm : paperBal.solana;
      } else {
        const wallets = await this.walletService.getWallets(userId, 'live');
        const w = wallets.find((item) => item.chain === chain);
        currentBalance = w ? w.balance : 0;
      }

      if (currentBalance >= threshold && currentBalance > reserve) {
        const sweepRes = await this.walletService.sweepBalances(userId, {
          chain,
          vaultAddress: this.config.vaultAddress,
          reserveAmount: reserve,
          mode,
        });

        if (sweepRes.status === 'SUCCESS') {
          this.emitEvent('AUTOTRADE_SWEEP', {
            userId,
            chain,
            sweptAmount: sweepRes.sweptAmount,
            remainingBalance: sweepRes.remainingBalance,
            vaultAddress: this.config.vaultAddress,
            txHash: sweepRes.txHash,
            mode,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ AutoSweep check failed for user ${userId}:`, (err as Error).message);
    }
  }

  private static utcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private rollDayIfNeeded(): void {
    const today = AutoTradeService.utcDay();
    if (this.equityDayKey === today) return;
    this.equityDayKey = today;
    this.dailyStartingEquityNative = this.peakEquityNative;
    this.dailyRealizedPnlNative = 0;
    this.stats.currentDailyDrawdownPercent = 0;
  }

  private recordTradePerformance(pnlNative: number, isWin: boolean): void {
    this.rollDayIfNeeded();
    this.stats.totalTrades += 1;
    if (isWin) {
      this.stats.winningTrades += 1;
    } else {
      this.stats.losingTrades += 1;
    }

    this.stats.winRate = parseFloat(
      ((this.stats.winningTrades / this.stats.totalTrades) * 100).toFixed(1)
    );
    this.stats.totalPnlNative = parseFloat((this.stats.totalPnlNative + pnlNative).toFixed(8));
    this.dailyRealizedPnlNative = parseFloat((this.dailyRealizedPnlNative + pnlNative).toFixed(8));

    if (pnlNative >= 0) {
      this.grossProfitNative = parseFloat((this.grossProfitNative + pnlNative).toFixed(8));
    } else {
      this.grossLossNative = parseFloat((this.grossLossNative + Math.abs(pnlNative)).toFixed(8));
    }
    this.stats.profitFactor = this.grossLossNative > 0
      ? parseFloat((this.grossProfitNative / this.grossLossNative).toFixed(3))
      : (this.grossProfitNative > 0 ? 2.0 : 1.0);

    const currentEquity = this.dailyStartingEquityNative + this.dailyRealizedPnlNative;
    if (currentEquity > this.peakEquityNative) {
      this.peakEquityNative = currentEquity;
    }

    const currentDrawdownPct =
      this.peakEquityNative > 0
        ? parseFloat((((this.peakEquityNative - currentEquity) / this.peakEquityNative) * 100).toFixed(2))
        : 0;

    this.stats.currentDailyDrawdownPercent = currentDrawdownPct;
    if (currentDrawdownPct > this.stats.peakDrawdownPercent) {
      this.stats.peakDrawdownPercent = currentDrawdownPct;
    }

    if (currentDrawdownPct >= this.config.dailyMaxDrawdownPercent) {
      this.tripCircuitBreaker(`Daily drawdown exceeded ${this.config.dailyMaxDrawdownPercent}%`);
    }

    this.emitEvent('AUTOTRADE_STATE', { stats: this.getStats(), config: this.config });
  }

  public recordSimulatedPnl(pnlNative: number, startingEquity: number = 1.0): void {
    this.equityDayKey = AutoTradeService.utcDay();
    this.dailyStartingEquityNative = startingEquity;
    this.peakEquityNative = startingEquity;
    this.recordTradePerformance(pnlNative, pnlNative >= 0);
  }

  private tripCircuitBreaker(reason: string): void {
    this.stats.circuitBreakerActive = true;
    this.config.enabled = false;
    console.warn(`🛑 AUTO-TRADING CIRCUIT BREAKER TRIPPED: ${reason}`);
    this.emitEvent('CIRCUIT_BREAKER_TRIPPED', { reason, stats: this.stats });
  }

  public resetCircuitBreaker(): void {
    this.stats.circuitBreakerActive = false;
    this.equityDayKey = AutoTradeService.utcDay();
    this.dailyRealizedPnlNative = 0;
    this.stats.currentDailyDrawdownPercent = 0;
    this.emitEvent('AUTOTRADE_STATE', { stats: this.stats, config: this.config });
  }

  private startExitMonitor(): void {
    if (this.exitMonitorTimer) return;
    this.exitMonitorTimer = setInterval(() => {
      this.evaluateActivePositions().catch((err) => {
        console.warn('⚠️ Exit monitor loop error:', (err as Error).message);
      });
    }, this.exitIntervalMs);
  }

  public destroy(): void {
    if (this.exitMonitorTimer) {
      clearInterval(this.exitMonitorTimer);
      this.exitMonitorTimer = null;
    }
  }
}
