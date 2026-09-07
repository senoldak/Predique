import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { WalletService } from '../services/wallet.service.js';
import { TradeService, type Position } from '../services/trade.service.js';
import { generateWebLoginUrl } from '../server/auth.js';
import { maskToken } from '../utils/mask.js';
import {
  formatSignalMessage,
  formatAutoBuyAlert,
  formatAutoTpAlert,
  formatAutoExitAlert,
  formatAutoTradeStatus,
  formatWhaleAlert,
} from './formatters.js';
import type { PublicTokenSignal } from '../services/marketFeed.service.js';
import type { AutoTradeService } from '../services/autoTrade.service.js';
import type { AutoTradeStrategyType } from '../types/autotrade.js';

export interface BotStatus {
  isRunning: boolean;
  botUsername?: string;
  error?: string;
}

export interface ChannelConfig {
  channelId: string;
  autoBroadcast: boolean;
  minTier: 'ALL' | 'TIER_3' | 'TIER_4' | 'TIER_5' | string;
  minLiquidityUsd: number;
  maxTaxPercent: number;
  tokenCooldownMinutes: number;
  maxSignalsPerHour: number;
  muteMicroTpAlerts: boolean;
}

export class BotManager {
  private bot: Bot | null = null;
  private isRunning: boolean = false;
  private botUsername?: string;
  private lastError?: string;
  private currentToken?: string;
  private walletService: WalletService;
  private tradeService: TradeService;
  private autoTradeService?: AutoTradeService;

  private channelId: string = process.env.TELEGRAM_CHANNEL_ID || '@predique';
  private channelAutoBroadcast: boolean = true;
  private minSignalTier: string = 'ALL';
  private minLiquidityUsd: number = 10000;
  private maxTaxPercent: number = 5;
  private tokenCooldownMinutes: number = 15;
  private maxSignalsPerHour: number = 12;
  private muteMicroTpAlerts: boolean = false;

  private lastBroadcastTime: number = 0;
  private readonly minBroadcastIntervalMs: number = 15000;
  private signalQueue: PublicTokenSignal[] = [];
  private isProcessingQueue: boolean = false;
  private queuedTokenAddresses = new Set<string>();
  private autoTradeAlertsConfigured: boolean = false;

  private recentBroadcasts = new Map<string, number>();

  private hourlyBroadcastTimestamps: number[] = [];

  public static getTelegramAdminIds(): string[] {
    return (process.env.TELEGRAM_ADMIN_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  public static isTelegramAdmin(tgId: number | string | undefined): boolean {
    if (tgId === undefined) return false;
    const ids = BotManager.getTelegramAdminIds();
    if (ids.length === 0) return false;
    return ids.includes(String(tgId));
  }

  private smartWalletRegistry?: import('../engine/smartWalletRegistry.js').SmartWalletRegistry;

  constructor(
    walletService: WalletService,
    tradeService: TradeService,
    autoTradeService?: AutoTradeService,
    smartWalletRegistry?: import('../engine/smartWalletRegistry.js').SmartWalletRegistry
  ) {
    this.walletService = walletService;
    this.tradeService = tradeService;
    this.autoTradeService = autoTradeService;
    this.smartWalletRegistry = smartWalletRegistry;
    if (autoTradeService) {
      this.setupAutoTradeAlerts();
    }
  }

  public setSmartWalletRegistry(registry: import('../engine/smartWalletRegistry.js').SmartWalletRegistry): void {
    this.smartWalletRegistry = registry;
  }

  public setAutoTradeService(autoTradeService: AutoTradeService): void {
    this.autoTradeService = autoTradeService;
    this.setupAutoTradeAlerts();
  }

  public getStatus(): BotStatus {
    return {
      isRunning: this.isRunning,
      botUsername: this.botUsername,
      error: this.lastError,
    };
  }

  public getCurrentTokenMasked(): string {
    return this.currentToken ? maskToken(this.currentToken) : 'NOT CONFIGURED';
  }

  public getChannelConfig(): ChannelConfig {
    return {
      channelId: this.channelId,
      autoBroadcast: this.channelAutoBroadcast,
      minTier: this.minSignalTier,
      minLiquidityUsd: this.minLiquidityUsd,
      maxTaxPercent: this.maxTaxPercent,
      tokenCooldownMinutes: this.tokenCooldownMinutes,
      maxSignalsPerHour: this.maxSignalsPerHour,
      muteMicroTpAlerts: this.muteMicroTpAlerts,
    };
  }

  public setChannelConfig(config: {
    channelId?: string;
    autoBroadcast?: boolean;
    minTier?: string;
    minLiquidityUsd?: number;
    maxTaxPercent?: number;
    tokenCooldownMinutes?: number;
    maxSignalsPerHour?: number;
    muteMicroTpAlerts?: boolean;
  }): void {
    if (config.channelId !== undefined) {
      let ch = config.channelId.trim();
      if (ch && !ch.startsWith('@') && !ch.startsWith('-100')) {
        ch = `@${ch}`;
      }
      this.channelId = ch;
    }
    if (config.autoBroadcast !== undefined) {
      this.channelAutoBroadcast = !!config.autoBroadcast;
    }
    if (config.minTier !== undefined) {
      this.minSignalTier = config.minTier;
    }
    if (config.minLiquidityUsd !== undefined && config.minLiquidityUsd >= 0) {
      this.minLiquidityUsd = config.minLiquidityUsd;
    }
    if (config.maxTaxPercent !== undefined && config.maxTaxPercent >= 0) {
      this.maxTaxPercent = config.maxTaxPercent;
    }
    if (config.tokenCooldownMinutes !== undefined && config.tokenCooldownMinutes > 0) {
      this.tokenCooldownMinutes = config.tokenCooldownMinutes;
    }
    if (config.maxSignalsPerHour !== undefined && config.maxSignalsPerHour > 0) {
      this.maxSignalsPerHour = config.maxSignalsPerHour;
    }
    if (config.muteMicroTpAlerts !== undefined) {
      this.muteMicroTpAlerts = !!config.muteMicroTpAlerts;
    }
  }

  public isAutoBroadcastEnabled(): boolean {
    return this.isRunning && this.channelAutoBroadcast && !!this.channelId;
  }

  public async start(token: string): Promise<boolean> {
    if (!token || token.length < 15 || token.startsWith('123456789:ABC')) {
      this.lastError = 'Invalid or default placeholder token';
      this.isRunning = false;
      return false;
    }

    try {
      await this.stop();

      const bot = new Bot(token);
      bot.catch((err) => {
        console.warn('⚠️ Telegram Bot update error:', err.message);
      });
      this.setupHandlers(bot);

      const me = await bot.api.getMe();
      this.botUsername = me.username;
      this.bot = bot;
      this.isRunning = true;
      this.currentToken = token;
      this.lastError = undefined;

      bot.start({
        onStart: (botInfo) => {
          console.log(`♞ Telegram Bot @${botInfo.username} online (${maskToken(token)})`);
        },
      }).catch((err) => {
        console.warn('⚠️ Telegram Bot polling warning:', (err as Error).message);
        this.isRunning = false;
        this.lastError = (err as Error).message;
      });

      this.setupAutoTradeAlerts();

      return true;
    } catch (err: unknown) {
      this.isRunning = false;
      this.lastError = (err as Error).message;
      console.warn('⚠️ Telegram Bot could not be started:', (err as Error).message);
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (this.bot && this.isRunning) {
      try {
        await this.bot.stop();
      } catch {
        // Ignore stop error
      }
    }
    this.bot = null;
    this.isRunning = false;
    this.botUsername = undefined;
  }

  public async restart(newToken: string): Promise<boolean> {
    await this.stop();
    return this.start(newToken);
  }

  private getWebLaunchUrl(userId: string): string {
    const directUrl = generateWebLoginUrl(userId);
    if (directUrl.includes('localhost') || directUrl.includes('127.0.0.1')) {
      return `https://t.me/${this.botUsername || 'predique_bot'}?start=web`;
    }
    return directUrl;
  }

  public async sendTestMessage(
    targetChannel?: string
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    const channel = targetChannel ? (targetChannel.startsWith('@') || targetChannel.startsWith('-100') ? targetChannel : `@${targetChannel}`) : this.channelId;

    if (!this.isRunning || !this.bot) {
      return {
        success: false,
        error: 'Bot is not online. Please configure bot token first.',
      };
    }

    try {
      const testText =
        `♞ <b>PREDIQUE // BROADCAST RADAR LINK</b> ♞\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `♟️ <b>Channel Target:</b> <b>${channel}</b>\n` +
        `✅ <b>Status:</b> High-Speed Tactical Stream Active\n` +
        `⚡ Real-time DEX intelligence, smart money syndicates & quant signals stream directly here.`;

      const keyboard = new InlineKeyboard().url(
        '♞ Predique Terminal',
        this.getWebLaunchUrl('channel_test')
      );

      const res = await this.bot.api.sendMessage(channel, testText, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      return { success: true, messageId: res.message_id };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      let friendlyError = msg;
      if (msg.includes('chat not found')) {
        friendlyError = `Channel '${channel}' not found. Make sure the username is correct or the channel exists.`;
      } else if (
        msg.includes('not a member') ||
        msg.includes('need administrator rights') ||
        msg.includes('rights') ||
        msg.includes('forbidden')
      ) {
        friendlyError = `Bot must be added as an Administrator in ${channel} with "Post Messages" permission.`;
      }
      return { success: false, error: friendlyError };
    }
  }

  public passesTierFilter(signal: PublicTokenSignal): boolean {
    if (this.minSignalTier === 'ALL') return true;

    let rank = 2;
    const r = (signal.rating || '').toUpperCase();
    if (r.includes('PLATINUM') || r.includes('ROYAL') || r.includes('TIER_5') || r.includes('TIER 5')) rank = 5;
    else if (r.includes('GOLD') || r.includes('SWARM') || r.includes('TIER_4') || r.includes('TIER 4')) rank = 4;
    else if (r.includes('SILVER') || r.includes('WORKER') || r.includes('TIER_3') || r.includes('TIER 3')) rank = 3;
    else if (r.includes('★') || r.includes('⭐')) {
      const stars = (r.match(/[★⭐]/g) || []).length;
      if (stars >= 3) rank = 4;
      else if (stars >= 2) rank = 3;
      else rank = 2;
    }

    if (this.minSignalTier === 'TIER_4' || this.minSignalTier === 'TIER_5') {
      return rank >= 4;
    }
    if (this.minSignalTier === 'TIER_3') {
      return rank >= 3;
    }
    return true;
  }

  public passesQualityGate(signal: PublicTokenSignal): boolean {

    if (signal.liquidity !== undefined && signal.liquidity < this.minLiquidityUsd) {
      return false;
    }

    if (signal.security) {
      if (signal.security.status === 'honeypot') {
        return false;
      }
      if (signal.security.hasBlacklist) {
        return false;
      }
      if (signal.security.buyTax > this.maxTaxPercent || signal.security.sellTax > this.maxTaxPercent) {
        return false;
      }
    }

    return this.passesTierFilter(signal);
  }

  public passesFrequencyGate(signal: PublicTokenSignal): boolean {
    const chain = (signal.chain || 'solana').toLowerCase();
    const address = (signal.tokenAddress || '').toLowerCase();
    if (!address) return true;

    const tokenKey = `${chain}:${address}`;
    const now = Date.now();
    const cooldownMs = this.tokenCooldownMinutes * 60 * 1000;

    const lastTokenTime = this.recentBroadcasts.get(tokenKey);
    if (lastTokenTime && (now - lastTokenTime) < cooldownMs) {
      return false;
    }

    const oneHourAgo = now - (60 * 60 * 1000);
    this.hourlyBroadcastTimestamps = this.hourlyBroadcastTimestamps.filter((t) => t > oneHourAgo);
    if (this.hourlyBroadcastTimestamps.length >= this.maxSignalsPerHour) {

      const r = (signal.rating || '').toUpperCase();
      const isRoyal = r.includes('ROYAL') || r.includes('TIER_5') || r.includes('TIER 5');
      if (!isRoyal) return false;
    }

    return true;
  }

  public recordBroadcast(signal: PublicTokenSignal): void {
    const chain = (signal.chain || 'solana').toLowerCase();
    const address = (signal.tokenAddress || '').toLowerCase();
    const tokenKey = `${chain}:${address}`;
    const now = Date.now();
    this.recentBroadcasts.set(tokenKey, now);
    this.hourlyBroadcastTimestamps.push(now);
    this.lastBroadcastTime = now;
  }

  public queueSignal(signal: PublicTokenSignal): void {
    if (!this.channelAutoBroadcast || !this.channelId) return;
    if (!this.passesQualityGate(signal)) return;
    if (!this.passesFrequencyGate(signal)) return;

    const addr = signal.tokenAddress.toLowerCase();
    if (this.queuedTokenAddresses.has(addr)) return;

    this.queuedTokenAddresses.add(addr);
    this.signalQueue.push(signal);
    this.processQueue().catch((err) => {
      console.warn('⚠️ Error in Telegram signal queue:', (err as Error).message);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.signalQueue.length > 0) {
        if (!this.isRunning || !this.bot || !this.channelAutoBroadcast || !this.channelId) {
          break;
        }

        const next = this.signalQueue.shift();
        if (!next) break;
        this.queuedTokenAddresses.delete(next.tokenAddress.toLowerCase());

        await this.broadcastSignalDirect(next);

        await new Promise((resolve) => setTimeout(resolve, this.minBroadcastIntervalMs));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  public async broadcastSignal(
    signal: PublicTokenSignal
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isRunning || !this.bot || !this.channelAutoBroadcast || !this.channelId) {
      return { success: false, error: 'Broadcasting inactive or bot offline' };
    }

    if (!this.passesQualityGate(signal)) {
      return { success: false, error: 'Filtered out by quality gate' };
    }

    if (!this.passesFrequencyGate(signal)) {
      return { success: false, error: 'Filtered out by frequency/cooldown gate' };
    }

    const now = Date.now();
    if (now - this.lastBroadcastTime < this.minBroadcastIntervalMs) {
      this.queueSignal(signal);
      return { success: true, error: 'Queued for rate-limited dispatch' };
    }

    return this.broadcastSignalDirect(signal);
  }

  private async broadcastSignalDirect(
    signal: PublicTokenSignal
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isRunning || !this.bot || !this.channelId) {
      return { success: false, error: 'Bot is offline or channelId not set' };
    }

    try {
      const buys5m = signal.buys5m ?? (Number.parseInt(String(signal.pileInTime).replace(/[^0-9]/g, ''), 10) || 6);
      const sells5m = signal.sells5m ?? 0;
      const { text } = formatSignalMessage({
        chain: signal.chain,
        chainTag: signal.chain.toUpperCase(),
        tokenSymbol: signal.tokenSymbol,
        contractAddress: signal.tokenAddress,
        mcapUsd: signal.mcap,
        liquidityUsd: signal.liquidity,
        liqMcRatio: signal.liqRatio,
        ageText: `${signal.ageMinutes}m`,
        tierStars: signal.rating || 'Tier 4',
        smartWalletsCount: signal.smartWalletsCount || 3,
        totalSpent: 0,
        currency: signal.chain.toLowerCase() === 'solana' ? 'SOL' : 'ETH',
        topWallets: signal.topWallets || [],
        buys5m,
        sells5m,
        pileInText: signal.pileInTime || '< 60s',
        earlySelling: signal.earlySelling,
        security: signal.security,
      });

      let fullText = text;
      if (signal.sponsored) {
        fullText += `\n⚠️ <b>Notice:</b> Sponsored listing — not smart-money tracked (DYOR).`;
      }
      if (signal.reasons && signal.reasons.length > 0) {
        const drivers = signal.reasons
          .slice(0, 2)
          .map((r) => `${r.label}: ${r.value}`)
          .join(' · ');
        fullText += `\n⚡ <b>Catalyst:</b> ${drivers}`;
      }

      const chainLower = signal.chain.toLowerCase();
      const explorerUrl =
        chainLower === 'solana'
          ? `https://solscan.io/token/${signal.tokenAddress}`
          : chainLower === 'base'
          ? `https://basescan.org/token/${signal.tokenAddress}`
          : `https://etherscan.io/token/${signal.tokenAddress}`;

      const botUsername = this.botUsername || 'predique_bot';
      const webLaunchUrl = this.getWebLaunchUrl('channel_signal');

      const grammyKeyboard = new InlineKeyboard()
        .url('📊 Chart', `https://dexscreener.com/${chainLower}/${signal.tokenAddress}`)
        .url('🔍 Explorer', explorerUrl)
        .url('𝕏 Search', `https://x.com/search?q=${encodeURIComponent(signal.tokenAddress)}&f=live`)
        .row()
        .url('♞ Quick Buy in Bot', `https://t.me/${botUsername}?start=buy_${chainLower}_${signal.tokenAddress}`)
        .url('♞ Predique Terminal', webLaunchUrl);

      await this.bot.api.sendMessage(this.channelId, fullText, {
        parse_mode: 'HTML',
        reply_markup: grammyKeyboard,
        link_preview_options: { is_disabled: true },
      });

      console.log(`📢 Channel broadcast sent to ${this.channelId} for $${signal.tokenSymbol} [${signal.chain}]`);
      this.recordBroadcast(signal);
      return { success: true };
    } catch (err: unknown) {
      console.warn(`⚠️ Channel broadcast to ${this.channelId} failed:`, (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  }

  public async broadcastWhaleAlert(params: {
    chain: string;
    tokenSymbol: string;
    contractAddress: string;
    walletLabel: string;
    walletAddress: string;
    winRate30d: number;
    totalPnlUsd: number;
    action: 'BUY' | 'ACCUMULATING';
    volumeNative: number;
    mcapUsd?: number;
    priceUsd?: number;
    targetChatId?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const destId = params.targetChatId || this.channelId;
    if (!this.isRunning || !this.bot || !destId) {
      return { success: false, error: 'Bot is offline or destination chatId not set' };
    }

    try {
      const { text, inlineKeyboard } = formatWhaleAlert(params);
      const grammyKeyboard = new InlineKeyboard();

      for (let rowIdx = 0; rowIdx < inlineKeyboard.length; rowIdx++) {
        const row = inlineKeyboard[rowIdx];
        for (const btn of row) {
          if (btn.url) {
            grammyKeyboard.url(btn.text, btn.url);
          } else if (btn.callback_data) {
            grammyKeyboard.text(btn.text, btn.callback_data);
          }
        }
        if (rowIdx < inlineKeyboard.length - 1) {
          grammyKeyboard.row();
        }
      }

      await this.bot.api.sendMessage(destId, text, {
        parse_mode: 'HTML',
        reply_markup: grammyKeyboard,
        link_preview_options: { is_disabled: true },
      });

      console.log(`🚨 Whale accumulation push sent to ${destId} for $${params.tokenSymbol} (${params.walletLabel})`);
      return { success: true };
    } catch (err: unknown) {
      console.warn(`⚠️ Whale accumulation push failed to ${destId}:`, (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  }

  private setupHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      const match = ctx.match;

      if (match && match.startsWith('buy_')) {
        const parts = match.split('_');
        const chain = parts[1] || 'solana';
        const address = parts.slice(2).join('_');
        const webUrl = this.getWebLaunchUrl(userId);

        const keyboard = new InlineKeyboard()
          .url('♞ Open in Terminal', webUrl)
          .row()
          .text('💳 Check Balance', 'cmd_wallets');

        await ctx.reply(
          `♞ <b>PREDIQUE ALPHA</b> ⬝ <code>[${chain.toUpperCase()}]</code>\n` +
          `<code>${address}</code>\n\n` +
          `Open your Predique Terminal below to execute with custom slippage & Moonbag protection:`,
          { parse_mode: 'HTML', reply_markup: keyboard }
        );
        return;
      }

      const webUrl = this.getWebLaunchUrl(userId);

      const keyboard = new InlineKeyboard()
        .text('💳 Wallets', 'cmd_wallets')
        .text('📊 Positions', 'cmd_positions')
        .row()
        .url('♞ Predique Terminal', webUrl);

      await ctx.reply(
        `♞ <b>PREDIQUE TERMINAL</b>\n` +
        `<i>Multi-chain quantitative intelligence & execution engine.</i>\n\n` +
        `• /wallet — Deposit vaults & balances\n` +
        `• /positions — Active positions & live PnL\n` +
        `• /autotrade — Automated strategies & stats\n` +
        `• /web — Launch Web Terminal\n` +
        `• /help — Command directory & docs`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    });

    bot.command('wallet', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const wallets = await this.walletService.getWallets(userId, 'live');
        const evm = wallets.find((w) => w.chain === 'EVM');
        const sol = wallets.find((w) => w.chain === 'SOLANA');

        const kb = new InlineKeyboard()
          .text('🧹 Sweep EVM', 'cmd_sweep_evm')
          .text('🧹 Sweep Solana', 'cmd_sweep_sol')
          .row()
          .text('🔄 Refresh', 'cmd_wallets');

        await ctx.reply(
          `♞ <b>DEPOSIT VAULTS</b>\n\n` +
          `🔵 <b>EVM (Base / ETH / BNB):</b>\n` +
          `<code>${evm?.address || 'Generating...'}</code>\n` +
          `Balance: <b>${evm ? evm.balance.toFixed(4) : '0.0000'} ETH</b>\n\n` +
          `🟣 <b>SOLANA:</b>\n` +
          `<code>${sol?.address || 'Generating...'}</code>\n` +
          `Balance: <b>${sol ? sol.balance.toFixed(4) : '0.0000'} SOL</b>`,
          { parse_mode: 'HTML', reply_markup: kb }
        );
      } catch (err: unknown) {
        await ctx.reply(`❌ Failed to fetch wallets: ${(err as Error).message}`);
      }
    });

    bot.command('sweep', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      const text = ctx.message?.text || '';
      const parts = text.trim().split(/\s+/).slice(1);

      if (parts.length < 2) {
        await ctx.reply(
          `🧹 <b>SWEEP & REBALANCE CONTROLLER</b>\n\n` +
          `Usage:\n` +
          `<code>/sweep &lt;EVM|SOLANA&gt; &lt;vault_address&gt; [reserve_amount] [sweep_amount]</code>\n\n` +
          `Examples:\n` +
          `• <code>/sweep EVM 0x1234...abcd 0.1</code> (sweep all EVM above 0.1 ETH reserve)\n` +
          `• <code>/sweep SOLANA 5YNm...234 1.0 2.5</code> (sweep exact 2.5 SOL leaving >= 1.0 reserve)\n\n` +
          `<i>Note: In Paper mode, balance is credited to your secure paper vault. In Live mode, requires ALLOW_LIVE_TRADING=true.</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const chainInput = parts[0].toUpperCase();
      const vaultAddress = parts[1];
      const reserveAmount = parts[2] ? parseFloat(parts[2]) : 0;
      const sweepAmount = parts[3] ? parseFloat(parts[3]) : undefined;

      if (chainInput !== 'EVM' && chainInput !== 'SOLANA') {
        await ctx.reply('❌ Invalid chain. Must be EVM or SOLANA.');
        return;
      }

      const isLiveRequested = process.env.ALLOW_LIVE_TRADING === 'true' && this.autoTradeService?.getConfig()?.mode === 'LIVE';
      const mode = isLiveRequested ? 'live' : 'paper';

      try {
        await ctx.reply(`⏳ Initiating balance sweep on ${chainInput} (${mode.toUpperCase()} mode)...`);
        const result = await this.walletService.sweepBalances(userId, {
          chain: chainInput,
          vaultAddress,
          reserveAmount,
          sweepAmount,
          mode,
        });

        if (result.status === 'SUCCESS') {
          const unit = chainInput === 'EVM' ? 'ETH' : 'SOL';
          await ctx.reply(
            `✅ <b>SWEEP SUCCESSFUL [${mode.toUpperCase()}]</b>\n\n` +
            `• Chain: <b>${chainInput}</b>\n` +
            `• Swept: <b>${result.sweptAmount} ${unit}</b>\n` +
            `• Remaining: <b>${result.remainingBalance} ${unit}</b>\n` +
            `• Vault Destination: <code>${vaultAddress}</code>\n` +
            (result.txHash ? `• Tx/Ref: <code>${result.txHash}</code>` : ''),
            { parse_mode: 'HTML' }
          );
        } else if (result.status === 'SKIPPED') {
          await ctx.reply(`⚠️ <b>Sweep Skipped:</b> ${result.reason || 'Threshold not met'}`);
        } else {
          await ctx.reply(`❌ <b>Sweep Failed:</b> ${result.reason || 'Unknown error'}`);
        }
      } catch (err: unknown) {
        await ctx.reply(`❌ Error executing sweep: ${(err as Error).message}`);
      }
    });

    const renderPositionsHandler = async (ctx: { from?: { id: number }; reply: (text: string, other?: object) => Promise<unknown> }) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {

        const [userPos, allPositions] = await Promise.all([
          this.tradeService.getAllPositions(userId),
          this.tradeService.getAllPositions(),
        ]);

        const livePositionsMap = new Map<string, Position>();
        for (const p of [...userPos.live, ...allPositions.live]) {
          livePositionsMap.set(p.id, p);
        }

        const paperPositionsMap = new Map<string, Position>();
        for (const p of [...userPos.paper, ...allPositions.paper]) {
          paperPositionsMap.set(p.id, p);
        }

        const livePositions = Array.from(livePositionsMap.values());
        const paperPositions = Array.from(paperPositionsMap.values());

        const autoPositions = this.autoTradeService ? this.autoTradeService.getAutoPositions() : [];
        const totalCount = livePositions.length + paperPositions.length + autoPositions.length;

        if (totalCount === 0) {
          await ctx.reply(
            `♞ <b>ACTIVE POSITIONS</b>\n\nNo active positions found in vault or automated engines.`
          );
          return;
        }

        const lines: string[] = [];
        const kb = new InlineKeyboard();

        for (const p of livePositions) {
          const pnlSign = p.pnlPercent >= 0 ? '+' : '';
          lines.push(`• ⚡ <b>$${p.tokenSymbol}</b> [${p.chain.toUpperCase()}]: <b>${pnlSign}${p.pnlPercent}%</b> (${p.amountIn})`);
          kb.text(`❌ Close $${p.tokenSymbol} (${pnlSign}${p.pnlPercent}%)`, `cb_pos_close_manual:${p.id}:live:${p.userId || userId}`).row();
        }

        for (const p of paperPositions) {
          const pnlSign = p.pnlPercent >= 0 ? '+' : '';
          lines.push(`• 🧪 [PAPER] <b>$${p.tokenSymbol}</b> [${p.chain.toUpperCase()}]: <b>${pnlSign}${p.pnlPercent}%</b> (${p.amountIn})`);
          kb.text(`❌ Close $${p.tokenSymbol} (${pnlSign}${p.pnlPercent}%)`, `cb_pos_close_manual:${p.id}:paper:${p.userId || userId}`).row();
        }

        for (const ap of autoPositions) {
          const botTag = ap.botName ? ` ⬝ <i>${ap.botName}</i>` : '';
          const modeTag = ap.isPaper ? '🧪 [PAPER]' : '⚡ [LIVE]';
          const pnlSign = ap.pnlPercent >= 0 ? '+' : '';
          lines.push(`• 🤖 ${modeTag} <b>$${ap.tokenSymbol}</b> [${ap.chain.toUpperCase()}]${botTag}: <b>${pnlSign}${ap.pnlPercent}%</b> ($${ap.entryPriceUsd?.toFixed(4)})`);
          kb.text(`❌ Close $${ap.tokenSymbol} (${pnlSign}${ap.pnlPercent}%)`, `cb_pos_close:${ap.id}`).row();
        }

        kb.url('♞ Open Terminal', this.getWebLaunchUrl(userId));

        await ctx.reply(
          `♞ <b>ACTIVE POSITIONS</b> (${totalCount})\n\n${lines.join('\n')}`,
          { parse_mode: 'HTML', reply_markup: kb }
        );
      } catch (err: unknown) {
        await ctx.reply(`❌ Failed to fetch positions: ${(err as Error).message}`);
      }
    };

    bot.command('positions', renderPositionsHandler);
    bot.command('position', renderPositionsHandler);

    const renderHistoryHandler = async (ctx: { from?: { id: number }; reply: (text: string, other?: object) => Promise<unknown> }) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const [liveHistory, paperHistory] = await Promise.all([
          this.tradeService.getTradeHistory(userId, false),
          this.tradeService.getTradeHistory(userId, true),
        ]);

        const allHistory = [...liveHistory, ...paperHistory];
        if (allHistory.length === 0) {
          await ctx.reply(
            `♞ <b>CLOSED TRADES HISTORY</b>\n\nNo closed trades recorded yet in your vault session.`
          );
          return;
        }

        const totalTrades = allHistory.length;
        const wins = allHistory.filter((t) => t.pnlPercent > 0).length;
        const losses = allHistory.filter((t) => t.pnlPercent < 0).length;
        const winRate = ((wins / totalTrades) * 100).toFixed(1);
        const totalPnl = allHistory.reduce((acc, t) => acc + t.pnlPercent, 0).toFixed(1);

        const lines: string[] = [
          `♞ <b>CLOSED TRADES ARCHIVE</b> (${totalTrades} Trades)`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `📊 <b>Win Rate:</b> ${winRate}% (${wins}W / ${losses}L)`,
          `💰 <b>Realized PnL:</b> ${Number(totalPnl) >= 0 ? '+' : ''}${totalPnl}%`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ];

        const recent = allHistory.slice(0, 5);
        for (const t of recent) {
          const modeTag = t.isPaper ? '🧪 [PAPER]' : '⚡ [LIVE]';
          const pnlSign = t.pnlPercent >= 0 ? '+' : '';
          lines.push(`• ${modeTag} <b>$${t.tokenSymbol}</b> [${t.chain.toUpperCase()}]: <b>${pnlSign}${t.pnlPercent.toFixed(1)}%</b> (${t.holdDurationSeconds}s)`);
        }

        const kb = new InlineKeyboard()
          .url('♞ View Full History in Terminal', this.getWebLaunchUrl(userId));

        await ctx.reply(lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: kb,
        });
      } catch (err: unknown) {
        await ctx.reply(`❌ Failed to fetch trade history: ${(err as Error).message}`);
      }
    };

    bot.command('history', renderHistoryHandler);
    bot.command('trades', renderHistoryHandler);

    bot.command('export', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const [liveHistory, paperHistory] = await Promise.all([
          this.tradeService.getTradeHistory(userId, false),
          this.tradeService.getTradeHistory(userId, true),
        ]);
        const allHistory = [...liveHistory, ...paperHistory];

        if (allHistory.length === 0) {
          await ctx.reply(`♞ <b>TRADE REPORT EXPORT</b>\n\nNo trade records found to export.`);
          return;
        }

        const headers = 'Trade ID,Token,Chain,Mode,Amount,Entry Price,Exit Price,PnL %,Duration (s),Timestamp';
        const rows = allHistory.map((t) =>
          `"${t.id}","${t.tokenSymbol}","${t.chain}","${t.isPaper ? 'PAPER' : 'LIVE'}",${t.amountIn},${t.entryPriceUsd ?? 'N/A'},${t.exitPriceUsd ?? 'N/A'},${t.pnlPercent},${t.holdDurationSeconds},"${new Date(t.closeTimestamp).toISOString()}"`
        );
        const csv = `${headers}\n${rows.join('\n')}`;

        await ctx.replyWithDocument(
          new InputFile(Buffer.from(csv, 'utf-8'), `predique_trades_${userId}.csv`),
          {
            caption: `♞ <b>Predique Trade Ledger Export</b>\nTotal Trades: <b>${allHistory.length}</b>\nAudit & Tax Ledger generated.`,
            parse_mode: 'HTML',
          }
        );
      } catch (err: unknown) {
        await ctx.reply(`❌ Failed to export trades: ${(err as Error).message}`);
      }
    });

    const renderSmartWalletsHandler = async (ctx: { reply: (text: string, other?: object) => Promise<unknown> }) => {
      if (!this.smartWalletRegistry) {
        await ctx.reply(`♞ <b>SMART WALLETS REGISTRY</b>\n\nRegistry offline or not initialized in bot.`);
        return;
      }
      const wallets = this.smartWalletRegistry.getAllWallets();
      if (wallets.length === 0) {
        await ctx.reply(`♞ <b>SMART WALLETS REGISTRY</b>\n\nNo alpha wallets registered.`);
        return;
      }

      const lines: string[] = [
        `♞ <b>VERIFIED SMART MONEY REGISTRY</b> (${wallets.length} Wallets)`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ];

      for (const w of wallets.slice(0, 8)) {
        const chainIcon = w.chain === 'SOLANA' ? '🟣' : '🔵';
        lines.push(`${chainIcon} <b>${w.label}</b> [<code>${w.tag}</code>]`);
        lines.push(`• Win-Rate (30d): <b>${w.winRate30d}%</b> | PnL: <b>+$${(w.totalPnlUsd / 1000).toFixed(0)}k</b>`);
        lines.push(`• Address: <code>${w.address.slice(0, 6)}...${w.address.slice(-4)}</code>\n`);
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    };

    bot.command('alpha', renderSmartWalletsHandler);
    bot.command('smartwallets', renderSmartWalletsHandler);

    bot.command('web', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      const url = generateWebLoginUrl(userId);
      const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
      await ctx.reply(
        `♞ <b>WEB TERMINAL</b>\n\n` +
        `${isLocal ? `Direct Web Session:\n<code>${url}</code>\n\n(Open in your browser)` : `<a href="${url}">👉 Open Live Terminal</a>`}`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(
        `♞ <b>COMMAND DIRECTORY</b>\n\n` +
        `• /wallet — Vault addresses & balances\n` +
        `• /sweep — Automated/manual profit harvest to cold vault\n` +
        `• /positions — Active positions & live PnL\n` +
        `• /history — Closed trades & win-rate metrics\n` +
        `• /alpha — Tracked on-chain smart wallets\n` +
        `• /autotrade — Quant trading engine\n` +
        `• /web — Launch Web Terminal\n` +
        `• /help — Show this manual\n\n` +
        `<i>Add @${this.botUsername || 'predique_bot'} as channel admin to stream real-time tactical signals.</i>`,
        { parse_mode: 'HTML' }
      );
    });

    bot.callbackQuery('cmd_wallets', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const wallets = await this.walletService.getWallets(userId, 'live');
        const evm = wallets.find((w) => w.chain === 'EVM');
        const sol = wallets.find((w) => w.chain === 'SOLANA');
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `♞ <b>PREDIQUE // VAULT BALANCES:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔵 EVM: <code>${evm?.address}</code> (${evm?.balance.toFixed(4)} ETH)\n🟣 Solana: <code>${sol?.address}</code> (${sol?.balance.toFixed(4)} SOL)`,
          { parse_mode: 'HTML' }
        );
      } catch (e: unknown) {
        await ctx.answerCallbackQuery({ text: (e as Error).message });
      }
    });

    bot.callbackQuery('cmd_sweep_evm', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      await ctx.answerCallbackQuery();
      const vault = this.autoTradeService?.getConfig()?.vaultAddress || '0x0000000000000000000000000000000000000000';
      await ctx.reply(
        `🧹 <b>SWEEP EVM SURPLUS</b>\n\n` +
        `To sweep your EVM profit to your vault, send:\n` +
        `<code>/sweep EVM &lt;vault_address&gt; [reserve_eth]</code>\n\n` +
        `Example:\n` +
        `<code>/sweep EVM ${vault} 0.2</code>`,
        { parse_mode: 'HTML' }
      );
    });

    bot.callbackQuery('cmd_sweep_sol', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `🧹 <b>SWEEP SOLANA SURPLUS</b>\n\n` +
        `To sweep your Solana profit to your vault, send:\n` +
        `<code>/sweep SOLANA &lt;vault_address&gt; [reserve_sol]</code>\n\n` +
        `Example:\n` +
        `<code>/sweep SOLANA 5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CmPEwKgV4Gv 1.0</code>`,
        { parse_mode: 'HTML' }
      );
    });

    bot.callbackQuery('cmd_positions', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const positions = await this.tradeService.getPositions(userId, false);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `♞ <b>PREDIQUE // OPEN POSITIONS:</b> ${positions.length} active`,
          { parse_mode: 'HTML' }
        );
      } catch (e: unknown) {
        await ctx.answerCallbackQuery({ text: (e as Error).message });
      }
    });

    bot.command('autotrade', async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      if (!this.autoTradeService) {
        await ctx.reply('⚠️ Auto-trading engine is not enabled in this instance.');
        return;
      }

      const match = (ctx.match || '').trim();
      const parts = match.split(/\s+/).filter(Boolean);

      if (parts[0]?.toLowerCase() === 'off') {
        if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
          console.warn(`security blocked: tg=${ctx.from?.id} cmd=/autotrade off reason=no-admin`);
          await ctx.reply('⛔ Operator only. Ask the channel admin to pause trading.');
          return;
        }
        this.autoTradeService.toggle(false);
        await ctx.reply('⏸️ <b>PREDIQUE QUANT:</b> Auto-Trading paused.', { parse_mode: 'HTML' });
        return;
      }

      const parseStrategy = (raw?: string): AutoTradeStrategyType | null => {
        if (!raw) return null;
        const s = raw.trim().toUpperCase().replace(/[-\s]/g, '_');
        if (s === 'SWARM' || s === 'SWARM_MOMENTUM') return 'SWARM_MOMENTUM';
        if (s === 'MEAN_REV' || s === 'MEAN_REVERSION' || s === 'DIP') return 'MEAN_REVERSION';
        if (s === 'ENSEMBLE' || s === 'HYBRID') return 'ENSEMBLE';
        if (s === 'BREAKOUT' || s === 'BREAKOUT_SURGE' || s === 'SURGE') return 'BREAKOUT_SURGE';
        if (s === 'SNIPER' || s === 'SNIPER_ALPHA') return 'SNIPER_ALPHA';
        return null;
      };

      if (parts[0]?.toLowerCase() === 'strategy' || parts[0]?.toLowerCase() === 'strat') {
        if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
          console.warn(`security blocked: tg=${ctx.from?.id} cmd=/autotrade strategy reason=no-admin`);
          await ctx.reply('⛔ Operator only. Ask the channel admin to change strategy.');
          return;
        }

        const chosenStrategy = parseStrategy(parts[1]);
        if (!chosenStrategy) {
          const stratKb = new InlineKeyboard()
            .text('🌊 Cluster Momentum', 'cb_strat_SWARM_MOMENTUM')
            .text('📈 Mean Reversion', 'cb_strat_MEAN_REVERSION')
            .row()
            .text('⚡ Ensemble', 'cb_strat_ENSEMBLE')
            .text('🚀 Breakout Surge', 'cb_strat_BREAKOUT_SURGE')
            .row()
            .text('🎯 Sniper Alpha', 'cb_strat_SNIPER_ALPHA');

          await ctx.reply(
            '🎯 <b>SELECT QUANT STRATEGY:</b>\n\n' +
            '• <b>SWARM_MOMENTUM:</b> Smart wallet cluster & OFI (>0.65)\n' +
            '• <b>MEAN_REVERSION:</b> Mature oversold dip buyer (Z <= -2)\n' +
            '• <b>ENSEMBLE:</b> Dual Swarm + Mean Reversion hybrid\n' +
            '• <b>BREAKOUT_SURGE:</b> Volume surge (>3.5x) & price breakout\n' +
            '• <b>SNIPER_ALPHA:</b> Fresh pools (<45m) with early accumulation\n\n' +
            'Choose from buttons below or use:\n<code>/autotrade strategy &lt;name&gt;</code>',
            { parse_mode: 'HTML', reply_markup: stratKb }
          );
          return;
        }

        this.autoTradeService.updateConfig({ strategy: chosenStrategy });
        await ctx.reply(
          `🎯 <b>PREDIQUE QUANT STRATEGY UPDATED:</b>\nActive Strategy: <b>${chosenStrategy}</b>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (parts[0]?.toLowerCase() === 'on') {
        if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
          console.warn(`security blocked: tg=${ctx.from?.id} cmd=/autotrade on reason=no-admin`);
          await ctx.reply('⛔ Operator only. Ask the channel admin to start trading.');
          return;
        }
        const mode = parts[1]?.toLowerCase() === 'live' ? 'LIVE' : 'PAPER';
        const parsedStrat = parseStrategy(parts[2]);
        const strategy = parsedStrat || this.autoTradeService.getConfig().strategy || 'SWARM_MOMENTUM';
        this.autoTradeService.updateConfig({ mode, strategy, enabled: true });
        await ctx.reply(
          `🟢 <b>PREDIQUE QUANT:</b> Auto-Trading ACTIVE\nMode: <b>${mode}</b>\nStrategy: <b>${strategy}</b>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (parts[0]?.toLowerCase() === 'stats') {
        const stats = this.autoTradeService.getStats();
        const config = this.autoTradeService.getConfig();
        const text = formatAutoTradeStatus(config, stats);
        await ctx.reply(text, { parse_mode: 'HTML' });
        return;
      }

      const config = this.autoTradeService.getConfig();
      const stats = this.autoTradeService.getStats();
      const text = formatAutoTradeStatus(config, stats);

      const kb = new InlineKeyboard();
      if (config.enabled) {
        kb.text('⏸️ Pause AutoTrade', 'cb_autotrade_off');
      } else {
        kb.text('🧪 Start Paper', 'cb_autotrade_on_paper').text('⚡ Start Live', 'cb_autotrade_on_live');
      }
      kb.row()
        .text('🎯 Change Strategy', 'cb_autotrade_choose_strat')
        .text('📊 Refresh Stats', 'cb_autotrade_stats');
      kb.row()
        .url('♞ Open Terminal', this.getWebLaunchUrl(userId));

      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.callbackQuery('cb_autotrade_choose_strat', async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      await ctx.answerCallbackQuery();
      const currentStrat = this.autoTradeService?.getConfig().strategy;
      const stratKb = new InlineKeyboard()
        .text(`${currentStrat === 'SWARM_MOMENTUM' ? '✓ ' : ''}🌊 Cluster Momentum`, 'cb_strat_SWARM_MOMENTUM')
        .text(`${currentStrat === 'MEAN_REVERSION' ? '✓ ' : ''}📈 Mean Reversion`, 'cb_strat_MEAN_REVERSION')
        .row()
        .text(`${currentStrat === 'ENSEMBLE' ? '✓ ' : ''}⚡ Ensemble`, 'cb_strat_ENSEMBLE')
        .text(`${currentStrat === 'BREAKOUT_SURGE' ? '✓ ' : ''}🚀 Breakout Surge`, 'cb_strat_BREAKOUT_SURGE')
        .row()
        .text(`${currentStrat === 'SNIPER_ALPHA' ? '✓ ' : ''}🎯 Sniper Alpha`, 'cb_strat_SNIPER_ALPHA');

      await ctx.reply(
        '🎯 <b>SELECT QUANT STRATEGY:</b>\n\n' +
        'Tap a strategy below to switch engine model immediately:',
        { parse_mode: 'HTML', reply_markup: stratKb }
      );
    });

    bot.callbackQuery(/^cb_strat_/, async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
      const strat = data.replace('cb_strat_', '') as AutoTradeStrategyType;

      if (this.autoTradeService) {
        this.autoTradeService.updateConfig({ strategy: strat });
        await ctx.answerCallbackQuery({ text: `Strategy updated to ${strat}!` });
        const text = formatAutoTradeStatus(this.autoTradeService.getConfig(), this.autoTradeService.getStats());
        await ctx.reply(`✅ <b>QUANT STRATEGY CHANGED:</b> <b>${strat}</b>\n\n${text}`, { parse_mode: 'HTML' });
      }
    });

    bot.callbackQuery('cb_autotrade_on_paper', async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      if (this.autoTradeService) {
        this.autoTradeService.updateConfig({ mode: 'PAPER', enabled: true });
        await ctx.answerCallbackQuery({ text: 'Auto-Trade started in Paper Mode!' });
        await ctx.reply('🧪 <b>PREDIQUE QUANT:</b> Auto-Trading started in <b>PAPER SANDBOX</b> mode.', {
          parse_mode: 'HTML',
        });
      }
    });

    bot.callbackQuery('cb_autotrade_on_live', async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      if (this.autoTradeService) {
        this.autoTradeService.updateConfig({ mode: 'LIVE', enabled: true });
        await ctx.answerCallbackQuery({ text: 'Auto-Trade started in LIVE Mode!' });
        await ctx.reply('⚡ <b>PREDIQUE QUANT:</b> Auto-Trading started in <b>LIVE ON-CHAIN</b> mode.', {
          parse_mode: 'HTML',
        });
      }
    });

    bot.callbackQuery('cb_autotrade_off', async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      if (this.autoTradeService) {
        this.autoTradeService.toggle(false);
        await ctx.answerCallbackQuery({ text: 'Auto-Trade paused!' });
        await ctx.reply('⏸️ <b>PREDIQUE QUANT:</b> Auto-Trading paused.', { parse_mode: 'HTML' });
      }
    });

    bot.callbackQuery('cb_autotrade_stats', async (ctx) => {
      if (this.autoTradeService) {
        await ctx.answerCallbackQuery();
        const text = formatAutoTradeStatus(this.autoTradeService.getConfig(), this.autoTradeService.getStats());
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    });

    bot.callbackQuery(/^st:/, async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
        const [, chainCode = '', tokenAddress = '', amountRaw = ''] = data.split(':');
        const chain = chainCode === 'sol' ? 'SOLANA' : chainCode === 'base' ? 'BASE' : 'ETH';
        const amountIn = Number(amountRaw);
        if (!tokenAddress || !Number.isFinite(amountIn) || amountIn <= 0) {
          await ctx.answerCallbackQuery({ text: 'Invalid quick-buy payload.' });
          return;
        }
        const isLiveRequested = process.env.ALLOW_LIVE_TRADING === 'true' && this.autoTradeService?.getConfig()?.mode === 'LIVE';
        const isPaper = !isLiveRequested;

        const result = await this.tradeService.executeQuickBuy({
          userId,
          tokenAddress,
          tokenSymbol: `${tokenAddress.slice(0, 6)}…`,
          chain: chain as 'SOLANA' | 'BASE' | 'ETH',
          amountIn,
          slippagePercent: 5,
          enableMoonbagAutoTp: false,
          isPaper,
        });

        const explorerUrl = chain === 'SOLANA'
          ? `https://solscan.io/tx/${result.txHash}`
          : chain === 'BASE'
          ? `https://basescan.org/tx/${result.txHash}`
          : `https://etherscan.io/tx/${result.txHash}`;

        if (isPaper) {
          await ctx.answerCallbackQuery({ text: 'Paper buy executed!' });
          await ctx.reply(
            `🧪 <b>PAPER BUY:</b> ${amountIn} ${chain} → <code>${tokenAddress.slice(0, 10)}…</code>\nTx: <code>${result.txHash.slice(0, 18)}…</code> (simulated, no on-chain fill)`,
            { parse_mode: 'HTML' }
          );
        } else {
          await ctx.answerCallbackQuery({ text: '⚡ LIVE BUY SUBMITTED!' });
          await ctx.reply(
            `⚡ <b>LIVE ON-CHAIN BUY:</b> ${amountIn} ${chain} → <code>${tokenAddress.slice(0, 10)}…</code>\nTx: <a href="${explorerUrl}">${result.txHash.slice(0, 18)}…</a>`,
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
          );
        }
      } catch (e: unknown) {
        await ctx.answerCallbackQuery({ text: (e as Error).message });
      }
    });


    bot.callbackQuery(/^mb:/, async (ctx) => {
      const userId = `tg_${ctx.from?.id || 'anon'}`;
      try {
        const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
        const [, , tokenAddress = ''] = data.split(':');
        if (!tokenAddress) {
          await ctx.answerCallbackQuery({ text: 'Invalid moonbag payload.' });
          return;
        }
        const norm = tokenAddress.toLowerCase();
        let armed = false;
        for (const isPaper of [true, false]) {
          const positions = await this.tradeService.getPositions(userId, isPaper);
          const pos = positions.find((p) => p.tokenAddress.toLowerCase() === norm);
          if (pos && await this.tradeService.setMoonbagActive(userId, pos.id, true, isPaper)) {
            armed = true;
          }
        }
        await ctx.answerCallbackQuery({ text: armed ? 'Moonbag armed!' : 'No open position.' });
        await ctx.reply(
          armed
            ? `🌙 <b>MOONBAG ARMED</b> on <code>${tokenAddress.slice(0, 10)}…</code> — TP protection active.`
            : `🌙 No open position for <code>${tokenAddress.slice(0, 10)}…</code>. Open one via the terminal first.`,
          { parse_mode: 'HTML' }
        );
      } catch (e: unknown) {
        await ctx.answerCallbackQuery({ text: (e as Error).message });
      }
    });

    bot.callbackQuery(/^cb_pos_close:/, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
      const positionId = data.replace('cb_pos_close:', '').trim();

      if (!this.autoTradeService || !positionId) {
        await ctx.answerCallbackQuery({ text: 'Auto-trading service unavailable or missing position.' });
        return;
      }

      try {
        const success = await this.autoTradeService.manualExitPosition(positionId);
        if (success) {
          await ctx.answerCallbackQuery({ text: 'Position closed successfully!' });
          await ctx.reply(`✅ <b>POSITION CLOSED:</b> Position <code>${positionId}</code> exited and balance updated.`, {
            parse_mode: 'HTML',
          });
        } else {
          await ctx.answerCallbackQuery({ text: 'Position not found or already closed.' });
        }
      } catch (err) {
        await ctx.answerCallbackQuery({ text: `Failed to close: ${(err as Error).message}` });
      }
    });

    bot.callbackQuery(/^cb_pos_close_manual:/, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
      const parts = data.replace('cb_pos_close_manual:', '').split(':');
      const positionId = parts[0];
      const isPaper = parts[1] === 'paper';
      const posOwnerUserId = parts[2] || `tg_${ctx.from?.id || 'anon'}`;

      if (!positionId) {
        await ctx.answerCallbackQuery({ text: 'Missing position ID.' });
        return;
      }

      try {
        const result = await this.tradeService.closePosition(posOwnerUserId, positionId, 100, isPaper);
        await ctx.answerCallbackQuery({ text: 'Position closed successfully!' });
        await ctx.reply(
          `✅ <b>POSITION CLOSED:</b> <code>${positionId}</code> (${result.percentageSold}%) exited.`,
          { parse_mode: 'HTML' }
        );
      } catch (err: unknown) {
        await ctx.answerCallbackQuery({ text: `Failed to close: ${(err as Error).message}` });
      }
    });

    bot.callbackQuery(/^cb_bot_toggle:/, async (ctx) => {
      if (!BotManager.isTelegramAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Operator only.' });
        return;
      }
      const data = (ctx.callbackQuery as { data?: string } | undefined)?.data || '';
      const botId = data.replace('cb_bot_toggle:', '').trim();
      if (!this.autoTradeService || !botId) {
        await ctx.answerCallbackQuery({ text: 'Bot not found.' });
        return;
      }
      const updated = await this.autoTradeService.toggleBot(botId);
      if (updated) {
        await ctx.answerCallbackQuery({ text: `${updated.name} ${updated.enabled ? 'started' : 'paused'}!` });
        await ctx.reply(
          `🤖 <b>${updated.name}:</b> ${updated.enabled ? '🟢 ACTIVE' : '⏸️ PAUSED'}`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.answerCallbackQuery({ text: 'Bot not found.' });
      }
    });
  }

  public setupAutoTradeAlerts(): void {
    if (!this.autoTradeService || this.autoTradeAlertsConfigured) return;
    this.autoTradeAlertsConfigured = true;

    this.autoTradeService.onTradeEvent(async (event) => {
      if (!this.isRunning || !this.bot || !this.channelId) return;

      try {
        if (event.type === 'AUTOTRADE_BUY') {
          const { position, rationale } = event.data as any;
          if (position) {
            const text = formatAutoBuyAlert(
              position,
              rationale || 'Swarm Cluster',
              position.isPaper ? 'PAPER' : 'LIVE'
            );
            const chainLower = position.chain.toLowerCase();
            const kb = new InlineKeyboard()
              .url('📊 Chart', `https://dexscreener.com/${chainLower}/${position.tokenAddress}`)
              .url('♞ Open Terminal', this.getWebLaunchUrl('autotrade_alert'));
            await this.bot.api.sendMessage(this.channelId, text, {
              parse_mode: 'HTML',
              reply_markup: kb,
              link_preview_options: { is_disabled: true },
            });
          }
        } else if (event.type === 'AUTOTRADE_TP1') {
          if (!this.muteMicroTpAlerts) {
            const { position, pnlPercent, priceUsd } = event.data as any;
            if (position) {
              const text = formatAutoTpAlert(
                position,
                pnlPercent || 35,
                priceUsd || position.entryPriceUsd
              );
              await this.bot.api.sendMessage(this.channelId, text, { parse_mode: 'HTML' });
            }
          }
        } else if (event.type === 'AUTOTRADE_EXIT') {
          const { historyItem } = event.data as any;
          if (historyItem) {
            const text = formatAutoExitAlert(historyItem);
            await this.bot.api.sendMessage(this.channelId, text, { parse_mode: 'HTML' });
          }
        } else if (event.type === 'CIRCUIT_BREAKER_TRIPPED') {
          const { reason } = event.data as any;
          await this.bot.api.sendMessage(
            this.channelId,
            `🛑 <b>PREDIQUE QUANT: CIRCUIT BREAKER TRIGGERED</b>\n\n${reason || 'Daily drawdown limit reached.'}\nNew automated entries paused to preserve portfolio capital.`,
            { parse_mode: 'HTML' }
          );
        }
      } catch (err) {
        console.warn('⚠️ AutoTrade Telegram alert broadcast error:', (err as Error).message);
      }
    });
  }
}
