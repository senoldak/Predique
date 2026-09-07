import { describe, it, expect } from 'vitest';
import {
  formatSignalMessage,
  formatAutoBuyAlert,
  formatAutoExitAlert,
  formatAutoTpAlert,
  formatWhaleAlert,
} from '../../src/bot/formatters.js';

describe('Telegram Alert Formatters (Compact English)', () => {
  const sampleSignalPayload = {
    chain: 'solana',
    chainTag: 'SOL',
    tokenSymbol: 'PEPE',
    contractAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    mcapUsd: 250000,
    liquidityUsd: 50000,
    liqMcRatio: 20.0,
    ageText: '15m',
    tierStars: 'Tier 4',
    smartWalletsCount: 3,
    totalSpent: 0,
    currency: 'SOL',
    topWallets: [],
    buys5m: 18,
    sells5m: 3,
    pileInText: 'Coordinated Inflow < 45s',
    earlySelling: false,
    security: {
      status: 'clean' as const,
      buyTax: 0,
      sellTax: 0,
      hasBlacklist: false,
      isMintable: false,
    },
  };

  it('formats public signal in compact English and preserves all 7 inline buttons', () => {
    const { text, inlineKeyboard } = formatSignalMessage(sampleSignalPayload);

    expect(text).toContain('PREDIQUE ALPHA');
    expect(text).toContain('$PEPE');
    expect(text).toContain('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    expect(text).toContain('MCap:');
    expect(text).toContain('Liq:');
    expect(text).toContain('Tax:');
    expect(text).toContain('Flow (5m):');
    expect(text).toContain('18 Buys / 3 Sells');

    expect(text).not.toContain('Alım');
    expect(text).not.toContain('Satım');
    expect(text).not.toContain('Temiz');

    expect(inlineKeyboard).toBeDefined();
    expect(inlineKeyboard.length).toBe(2);
    expect(inlineKeyboard[0].length).toBe(4);
    expect(inlineKeyboard[1].length).toBe(4);

    expect(inlineKeyboard[0][0].text).toContain('Chart');
    expect(inlineKeyboard[0][1].text).toMatch(/Photon|BullX/);
    expect(inlineKeyboard[0][2].text).toContain('Explorer');
    expect(inlineKeyboard[0][3].text).toContain('𝕏 Search');
    expect(inlineKeyboard[1][3].text).toContain('Moonbag');
  });


  it('formats auto-buy alerts concisely in English', () => {
    const alert = formatAutoBuyAlert(
      {
        id: 'pos_1',
        tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        tokenSymbol: 'PEPE',
        chain: 'solana',
        amountIn: 0.5,
        entryPriceUsd: 0.0025,
        currentPriceUsd: 0.0025,
        peakPriceUsd: 0.0025,
        stopLossPriceUsd: 0.0022,
        takeProfit1PriceUsd: 0.003375,
        tp1Hit: false,
        tokensHeld: '200000',
        strategy: 'MOMENTUM_BREAKOUT',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      'High volume spike 4.5x with 3 smart buyers',
      'PAPER'
    );

    expect(alert).toContain('AUTO-BUY EXECUTED');
    expect(alert).toContain('PAPER');
    expect(alert).toContain('Size:');
    expect(alert).toContain('Entry:');
    expect(alert).toContain('SL:');
    expect(alert).toContain('TP1:');
    expect(alert).toContain('Catalyst:');
  });

  it('formats position closed alerts in English', () => {
    const exitAlert = formatAutoExitAlert({
      id: 'trade_1',
      tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      tokenSymbol: 'PEPE',
      chain: 'solana',
      entryPriceUsd: 0.0025,
      exitPriceUsd: 0.0035,
      pnlPercent: 40.0,
      pnlNative: 0.2,
      exitReason: 'TAKE_PROFIT_1',
      timestamp: Date.now(),
      strategy: 'MOMENTUM_BREAKOUT',
    });

    expect(exitAlert).toContain('POSITION CLOSED');
    expect(exitAlert).toContain('+40.0%');
    expect(exitAlert).toContain('<b>Reason:</b> TAKE PROFIT 1');
    expect(exitAlert).toContain('Entry:');
    expect(exitAlert).toContain('Exit:');
  });

  it('formats verified whale accumulation alert with inline quick-buy buttons and wallet win-rate', () => {
    const { text, inlineKeyboard } = formatWhaleAlert({
      chain: 'solana',
      tokenSymbol: 'NECTAR',
      contractAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      walletLabel: 'Whale Alpha 01',
      walletAddress: '0x1234567890123456789012345678901234567890',
      winRate30d: 91.5,
      totalPnlUsd: 420000,
      action: 'BUY',
      volumeNative: 15.5,
      mcapUsd: 350000,
      priceUsd: 0.045,
    });

    expect(text).toContain('VERIFIED SMART MONEY ALERT');
    expect(text).toContain('Whale Alpha 01');
    expect(text).toContain('BUYING');
    expect(text).toContain('$NECTAR');
    expect(text).toContain('91.5%');
    expect(text).toContain('+$420k');
    expect(text).toContain('15.50 SOL');

    expect(inlineKeyboard).toBeDefined();
    expect(inlineKeyboard.length).toBe(2);
    expect(inlineKeyboard[0][0].text).toContain('DexScreener');
    expect(inlineKeyboard[0][1].text).toContain('Explorer');
    expect(inlineKeyboard[1][0].text).toContain('Buy 0.05 SOL');
    expect(inlineKeyboard[1][1].text).toContain('Buy 0.1 SOL');
  });
});
