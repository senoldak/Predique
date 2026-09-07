import { ScoringParams, SignalTierResult } from '../types/signal.js';

export function calculateSignalTier(params: ScoringParams): SignalTierResult {
  const { ageMinutes, liqMcRatio, smartWalletsCount, earlySelling, hasHoneypot } = params;

  if (hasHoneypot) {
    return {
      tier: 'NEUTRAL',
      stars: '⚠️ HONEYPOT TRAP',
      tag: '🚫 Danger'
    };
  }

  if (earlySelling && ageMinutes < 30) {
    return {
      tier: 'NEUTRAL',
      stars: '⚪ Neutral',
      tag: '⚠️ early selling'
    };
  }

  if (!earlySelling && ageMinutes >= 74 && liqMcRatio >= 10.0 && liqMcRatio <= 75.0) {
    return {
      tier: 'PLATINUM',
      stars: '★★★',
      tag: '🔒 no early exit'
    };
  }

  if (ageMinutes >= 60 || smartWalletsCount >= 6) {
    return {
      tier: 'GOLD',
      stars: '★★☆',
      tag: earlySelling ? '⚠️ early selling' : '🔒 no early exit'
    };
  }

  return {
    tier: 'SILVER',
    stars: '★☆☆',
    tag: earlySelling ? '⚠️ early selling' : '🔒 no early exit'
  };
}
