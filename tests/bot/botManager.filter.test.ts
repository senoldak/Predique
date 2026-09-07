import { describe, it, expect, beforeEach } from 'vitest';
import { BotManager } from '../../src/bot/botManager.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import type { PublicTokenSignal } from '../../src/engine/strategyEvaluator.js';

describe('BotManager Quality, Spam & Frequency Filters', () => {
  let botManager: BotManager;
  let walletService: WalletService;
  let tradeService: TradeService;

  const validSignal: PublicTokenSignal = {
    chain: 'solana',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    tokenSymbol: 'SOLTEST',
    mcap: 100000,
    liquidity: 25000,
    liqRatio: 25.0,
    ageMinutes: 20,
    rating: 'Tier 4',
    pileInTime: '< 30s',
    smartWalletsCount: 4,
    earlySelling: false,
    security: {
      status: 'clean',
      buyTax: 0,
      sellTax: 0,
      hasBlacklist: false,
      isMintable: false,
    },
  };

  beforeEach(() => {
    walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    tradeService = new TradeService(walletService);
    botManager = new BotManager(walletService, tradeService);
  });

  it('drops signals with liquidity below minLiquidityUsd', () => {
    botManager.setChannelConfig({ minLiquidityUsd: 20000 });
    const lowLiqSignal: PublicTokenSignal = {
      ...validSignal,
      liquidity: 15000,
    };
    expect(botManager.passesQualityGate(lowLiqSignal)).toBe(false);

    const highLiqSignal: PublicTokenSignal = {
      ...validSignal,
      liquidity: 25000,
    };
    expect(botManager.passesQualityGate(highLiqSignal)).toBe(true);
  });

  it('drops signals with tax exceeding maxTaxPercent', () => {
    botManager.setChannelConfig({ maxTaxPercent: 5 });
    const highTaxSignal: PublicTokenSignal = {
      ...validSignal,
      security: {
        status: 'risk',
        buyTax: 6,
        sellTax: 0,
        hasBlacklist: false,
        isMintable: false,
      },
    };
    expect(botManager.passesQualityGate(highTaxSignal)).toBe(false);

    const acceptableTaxSignal: PublicTokenSignal = {
      ...validSignal,
      security: {
        status: 'clean',
        buyTax: 3,
        sellTax: 2,
        hasBlacklist: false,
        isMintable: false,
      },
    };
    expect(botManager.passesQualityGate(acceptableTaxSignal)).toBe(true);
  });

  it('strictly rejects honeypot and blacklisted tokens', () => {
    const honeypotSignal: PublicTokenSignal = {
      ...validSignal,
      security: {
        status: 'honeypot',
        buyTax: 0,
        sellTax: 99,
        hasBlacklist: false,
        isMintable: false,
      },
    };
    expect(botManager.passesQualityGate(honeypotSignal)).toBe(false);

    const blacklistedSignal: PublicTokenSignal = {
      ...validSignal,
      security: {
        status: 'risk',
        buyTax: 0,
        sellTax: 0,
        hasBlacklist: true,
        isMintable: false,
      },
    };
    expect(botManager.passesQualityGate(blacklistedSignal)).toBe(false);
  });

  it('enforces tokenCooldownMinutes and prevents spamming duplicate token', () => {
    botManager.setChannelConfig({ tokenCooldownMinutes: 10 });
    const signal: PublicTokenSignal = { ...validSignal, tokenAddress: 'TokenAddressXYZ123' };

    expect(botManager.passesFrequencyGate(signal)).toBe(true);

    botManager.recordBroadcast(signal);

    expect(botManager.passesFrequencyGate(signal)).toBe(false);
  });

  it('allows toggling muteMicroTpAlerts in channel config', () => {
    botManager.setChannelConfig({ muteMicroTpAlerts: true });
    expect(botManager.getChannelConfig().muteMicroTpAlerts).toBe(true);

    botManager.setChannelConfig({ muteMicroTpAlerts: false });
    expect(botManager.getChannelConfig().muteMicroTpAlerts).toBe(false);
  });
});
