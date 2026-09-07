import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { recordWalletBuy } from '../engine/stateMachine.js';
import { calculateSignalTier } from '../engine/scoring.js';
import { formatSignalMessage } from '../bot/formatters.js';
import { buildQuickBuyPayload } from '../trade/router.js';

async function runLiveSimulation() {
  console.log('♞ ========================================');
  console.log('♞ PREDIQUE ALPHA INTELLIGENCE SIMULATOR');
  console.log('♞ ========================================\n');

  const redis = new (RedisMock as unknown as typeof Redis)();
  const token = '0xabf4f0999be267d8eaae658fb1f426f5a8568771';
  const chain = 'base';
  const tokenKey = `${chain}:${token}`;

  console.log('📡 [1/4] Blockchain Listener Active: Streaming Base & Solana events...');

  console.log('👀 [Tx 1] Smart Wallet 1 (0x87a...): Bought 0.25 ETH');
  await recordWalletBuy(redis, tokenKey, '0x87a1', 0.25, Date.now());

  console.log('👀 [Tx 2] Smart Wallet 2 (0x34b...): Bought 0.45 ETH');
  await recordWalletBuy(redis, tokenKey, '0x34b2', 0.45, Date.now() + 15000);

  console.log('🚨 [Tx 3] Smart Wallet 3 (0x91c...): Bought 0.50 ETH');
  const trigger = await recordWalletBuy(redis, tokenKey, '0x91c3', 0.50, Date.now() + 25000);

  if (trigger.shouldTriggerBuy) {
    console.log(`\n🔥 WALLET CLUSTER DETECTED! (${trigger.walletCount} Smart Wallets / ${trigger.pileInText})`);

    const score = calculateSignalTier({
      ageMinutes: 92,
      liqMcRatio: 38.5,
      smartWalletsCount: trigger.walletCount,
      earlySelling: false,
      hasHoneypot: false
    });

    console.log(`🎯 Quality Rating: ${score.stars} (${score.tag})`);

    const message = formatSignalMessage({
      chain: 'Base',
      chainTag: '#Base',
      tokenSymbol: 'ALPHA',
      contractAddress: token,
      mcapUsd: 24500,
      liquidityUsd: 9430,
      liqMcRatio: 38.5,
      ageText: '1h 32m',
      tierStars: score.stars,
      smartWalletsCount: trigger.walletCount,
      totalSpent: trigger.totalVolume,
      currency: 'ETH',
      topWallets: [
        { label: 'Wallet #1 (86% Win-Rate)', winRate: 86, volume: 0.25 },
        { label: 'Wallet #2 (Top Momentum Hunter)', winRate: 82, volume: 0.45 },
        { label: 'Wallet #3 (Early Whale)', winRate: 79, volume: 0.50 }
      ],
      buys5m: 3, sells5m: 0,
      pileInText: trigger.pileInText,
      earlySelling: false
    });

    console.log('\n📱 --- TELEGRAM ALERT OUTPUT ---');
    console.log(message.text.replace(/<[^>]+>/g, ''));
    console.log('------------------------------------');
    console.log('🔘 Buttons:');
    message.inlineKeyboard.forEach((row, idx) => {
      console.log(`  Row ${idx + 1}: [ ${row.map(b => b.text).join(' ]  [ ')} ]`);
    });

    console.log('\n⚡ [User Action] User tapped "⚡ 0.01 ETH" Quick-Buy button!');
    const quickBuy = buildQuickBuyPayload({
      userTelegramId: 99887766,
      chain: 'base',
      tokenAddress: token,
      amountInNative: 0.01,
      slippageBps: 500,
      enableMoonbag: true
    });

    console.log(`🚀 Swap Router: ${quickBuy.router.type}`);
    console.log(`💰 Amount: ${quickBuy.amountInNative} ETH`);
    console.log(`🌙 Moonbag Protection: ${quickBuy.enableMoonbag ? 'ENABLED (Take 50% profit at 2X)' : 'DISABLED'}`);
    console.log('\n✅ SIMULATION COMPLETED SUCCESSFULLY!');
  }
}

runLiveSimulation();
