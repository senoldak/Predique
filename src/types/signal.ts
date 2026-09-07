export type SignalTier =
  | 'PLATINUM'
  | 'GOLD'
  | 'SILVER'
  | 'NEUTRAL'
  | 'ROYAL_HONEY'
  | 'SWARM_INBOUND'
  | 'WORKER_HONEY';

export interface ScoringParams {
  ageMinutes: number;
  liqMcRatio: number;
  smartWalletsCount: number;
  earlySelling: boolean;
  hasHoneypot?: boolean;
}

export interface SignalTierResult {
  tier: SignalTier;
  stars: string;
  tag: string;
}
