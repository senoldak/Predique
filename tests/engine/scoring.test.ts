import { describe, it, expect } from 'vitest';
import { calculateSignalTier } from '../../src/engine/scoring.js';

describe('Swarm Quality Scoring Engine', () => {
  it('assigns NEUTRAL (0 stars) when early selling detected on young tokens', () => {
    const res = calculateSignalTier({
      ageMinutes: 10,
      liqMcRatio: 72.0,
      smartWalletsCount: 3,
      earlySelling: true,
      hasHoneypot: false
    });
    expect(res.tier).toBe('NEUTRAL');
    expect(res.stars).toBe('⚪ Neutral');
    expect(res.tag).toContain('early selling');
  });

  it('assigns SILVER (★☆☆) when age < 60m even with no early exit', () => {
    const res = calculateSignalTier({
      ageMinutes: 2,
      liqMcRatio: 78.0,
      smartWalletsCount: 3,
      earlySelling: false,
      hasHoneypot: false
    });
    expect(res.tier).toBe('SILVER');
    expect(res.stars).toBe('★☆☆');
    expect(res.tag).toContain('no early exit');
  });

  it('assigns GOLD (★★☆) for mature tokens with early selling', () => {
    const res = calculateSignalTier({
      ageMinutes: 120,
      liqMcRatio: 35.0,
      smartWalletsCount: 6,
      earlySelling: true,
      hasHoneypot: false
    });
    expect(res.tier).toBe('GOLD');
    expect(res.stars).toBe('★★☆');
    expect(res.tag).toContain('early selling');
  });

  it('assigns PLATINUM (★★★) strictly when age >= 74m, liq ratio healthy, and 0 early selling', () => {
    const res = calculateSignalTier({
      ageMinutes: 90, // 1h 30m
      liqMcRatio: 29.5,
      smartWalletsCount: 4,
      earlySelling: false,
      hasHoneypot: false
    });
    expect(res.tier).toBe('PLATINUM');
    expect(res.stars).toBe('★★★');
    expect(res.tag).toContain('🔒 no early exit');
  });

  it('immediately flags honeypot trap with zero stars and danger warning', () => {
    const res = calculateSignalTier({
      ageMinutes: 100,
      liqMcRatio: 40.0,
      smartWalletsCount: 5,
      earlySelling: false,
      hasHoneypot: true
    });
    expect(res.tier).toBe('NEUTRAL');
    expect(res.stars).toContain('HONEYPOT');
  });

  it.each([
    [{ ageMinutes: 74, liqMcRatio: 10.0, tier: 'PLATINUM' }],
    [{ ageMinutes: 74, liqMcRatio: 75.0, tier: 'PLATINUM' }],
    [{ ageMinutes: 73, liqMcRatio: 20.0, tier: 'GOLD' }],
    [{ ageMinutes: 60, liqMcRatio: 20.0, tier: 'GOLD' }],
    [{ ageMinutes: 59, liqMcRatio: 20.0, tier: 'SILVER' }],
    [{ ageMinutes: 90, liqMcRatio: 9.9, tier: 'GOLD' }],
    [{ ageMinutes: 90, liqMcRatio: 75.1, tier: 'GOLD' }],
  ])('boundary age=$ageMinutes ratio=$liqMcRatio → $tier', ({ ageMinutes, liqMcRatio, tier }) => {
    const res = calculateSignalTier({
      ageMinutes,
      liqMcRatio,
      smartWalletsCount: 4,
      earlySelling: false,
      hasHoneypot: false
    });
    expect(res.tier).toBe(tier);
  });

  it.each([
    [{ wallets: 6, age: 5, tier: 'GOLD' }],
    [{ wallets: 5, age: 5, tier: 'SILVER' }],
  ])('wallets=$wallets age=$age → $tier', ({ wallets, age, tier }) => {
    const res = calculateSignalTier({
      ageMinutes: age,
      liqMcRatio: 30.0,
      smartWalletsCount: wallets,
      earlySelling: false,
      hasHoneypot: false
    });
    expect(res.tier).toBe(tier);
  });
});
