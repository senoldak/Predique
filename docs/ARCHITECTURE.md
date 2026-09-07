# Predique Architecture & Mathematical Foundations

## Overview
**Predique** is a high-performance, multi-chain Telegram alpha and trading bot designed to detect, evaluate, and execute trades on decentralized liquidity pools across **Solana, Base, Ethereum, BNB Chain, and Robinhood Chain**.

Unlike simple copy-trading scripts, Predique employs **Swarm Intelligence**: tracking cluster buy patterns where multiple high-win-rate "Smart Wallets" accumulate a token within a compressed timeframe, scoring token viability, and offering single-tap or automated trade execution.

> **Signal-source honesty (live feed):** the production `LiveMarketFeedService` currently
> sources candidates from the DexScreener **paid boost list** (`token-boosts/latest`),
> not from tracked on-chain smart-wallet fills. `smartWalletsCount` is an **estimate**
> derived from 5-minute buy flow (`buys5m`, flagged `smartWalletsInferred`), wallet
> win-rates in broadcasts are **not measured**, and **no honeypot/contract audit**
> is performed (`HONEYPOT_UNCHECKED`). Treat every broadcast as sponsored flow
> until a real wallet-tracking source replaces the boost feed.

---

## 1. System Architecture

```
                    ┌────────────────────────────────────────┐
                    │         Multi-Chain Streamers          │
                    │ (Solana WebSocket + EVM viem Streams)  │
                    └───────────────────┬────────────────────┘
                                        │ (Raw Swap Events)
                                        ▼
                    ┌────────────────────────────────────────┐
                    │      Swarm Signal Engine (Core)        │
                    │   - Cluster Detector (>= 3 Wallets)    │
                    │   - Pile-in Velocity Calculator        │
                    │   - Early Exit Monitor                 │
                    │   - Mathematical Quality Scoring       │
                    └───────────────────┬────────────────────┘
                                        │
                                        ▼
                    ┌────────────────────────────────────────┐
                    │       Unified Core Service Bus         │
                    │    (WalletService & TradeService)      │
                    └───────────┬────────────────┬───────────┘
                                │                │
              (Signal Alert)    │                │ (Real-Time WS & REST)
                                ▼                ▼
  ┌───────────────────────────────────┐    ┌───────────────────────────────────┐
  │         Telegram Bot UI           │    │     Cyber-Hive Web Terminal       │
  │   - grammY Framework              │    │   - React + Vite Dashboard        │
  │   - Cyber-Hive Formatting         │    │   - WebSocket Live Swarm Stream   │
  │   - /start, /wallet, /web         │    │   - Stinger Quick-Buy & Moonbag   │
  │   - Inline Stinger Keyboards      │    │   - Portfolio & PnL Visualizer    │
  └─────────────────┬─────────────────┘    └─────────────────┬─────────────────┘
                    │                                        │
                    └───────────────────┬────────────────────┘
                                        │ (Shared Execution & Security)
                                        ▼
                    ┌────────────────────────────────────────┐
                    │      Encrypted Execution & Data        │
                    │   • AES-256-GCM Keystores              │
                    │   • Pump.fun & Jupiter v6 (Solana)     │
                    │   • Uniswap, Pancake & Pons (EVM)      │
                    │   • Redis Real-time State & Mutexes    │
                    │   • PostgreSQL User & Trade History    │
                    └────────────────────────────────────────┘
```

---

## 2. Mathematical Decision Logic

### A. Cluster Threshold Function
Let $W = \{w_1, w_2, \dots, w_k\}$ be the set of monitored smart wallets. For any token $T$ and rolling monitoring window:
$$U_T = \{w \in W \mid \text{Buy}(w, T) = \text{true}\}$$

The alert trigger condition $f(U_T)$ is defined as:
$$f(U_T) = \begin{cases}
\text{BUY\_SIGNAL}, & \text{if } |U_T| = 3 \land \text{called}_T = 0 \\
\text{BUY\_UPDATE}, & \text{if } |U_T| > 3 \land \text{called}_T = 1 \\
\text{IDLE}, & \text{if } |U_T| < 3
\end{cases}$$

### B. Pile-in Latency $\Delta t$
Pile-in duration measures the accumulation velocity between the first and $n$-th buyer:
$$\Delta t = t_n - t_1$$
- $\Delta t < 60\text{s} \implies \text{"<1m pile-in"}$ (Organized / high-velocity accumulation)
- $60\text{s} \le \Delta t < 3600\text{s} \implies \left\lfloor \frac{\Delta t}{60} \right\rfloor \text{"m pile-in"}$
- $\Delta t \ge 3600\text{s} \implies \left\lfloor \frac{\Delta t}{3600} \right\rfloor \text{"h pile-in"}$

### C. Signal Quality Tiers
Signals are evaluated across age ($A$, in minutes), early selling status ($E \in \{0, 1\}$), and liquidity-to-market-cap ratio ($R = \frac{\text{Liquidity}}{\text{MCAP}} \times 100\%$):

1. **👑 PLATINUM (★★★):**
   $$\text{Platinum} \iff (E = 0) \land (A \ge 74) \land (10\% \le R \le 75\%)$$
   Guarantees zero early exits among smart wallets, seasoned token age, and balanced pool depth.

2. **GOLD (★★☆):**
   $$\text{Gold} \iff (A \ge 60 \lor |U_T| \ge 6)$$

3. **SILVER (★☆☆):**
   $$\text{Silver} \iff (A < 60)$$
   Young microcap tokens with initial launch volatility.

4. **NEUTRAL (⚪):**
   $$\text{Neutral} \iff (E = 1 \land A < 30)$$
   Immediate early exit detected on newborn tokens (high dump risk).

---

## 3. Cryptographic Security Architecture

All user private keys are encrypted using **AES-256-GCM** (NIST SP 800-38D):
- **Key Derivation:** 256-bit high-entropy master key (`PREDIQUE_MASTER_KEY`).
- **Initialization Vector (IV):** 12 bytes (`crypto.randomBytes(12)`), randomly generated per encryption operation.
- **Authentication Tag:** 16 bytes (128 bits), verified during decryption to detect any tampering or bit flips.
- **Ephemeral Lifecycle:** Decrypted private keys exist in memory solely during transaction signing and are never written to disk or logs.

---

## 4. Multi-Chain Smart Routing

- **Solana (`*.pump` tokens):** Direct instruction generation to the Pump.fun bonding curve program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`), executing sub-second swaps before token graduation.
- **Solana (Graduated / Raydium / Meteora):** Routed through Jupiter API v6.
- **Base:** Uniswap v2 / v3 via `viem` (code: `EVM_UNISWAP`; Aerodrome/Flap not wired — see router).
- **BNB Chain:** PancakeSwap via `getRouterForChain` (`EVM_PANCAKE`; versioned v2/v3 routing not implemented).
- **Robinhood Chain:** Pons DEX router label (`EVM_PONS`).

---

## 5. Dual-Interface (Telegram & Web) Architecture

Predique features dual synchronization between its Telegram Bot and Cyber-Hive Web Trading Terminal:

### A. Authentication & Session Synchronization
- Users can authenticate via Telegram Login Widget or generate a 5-minute single-use secure link with `/web` inside the Telegram bot.
- A session JWT maps to the user's `telegramUserId`, ensuring both clients read from and write to the same encrypted keystore and position portfolio.

### B. Real-Time WebSocket Broadcasting (`/ws`)
- Real-time Swarm signals detected by the engine emit `SWARM_SIGNAL_NEW` events simultaneously to active Telegram subscriber channels and Web Terminal WebSocket clients with sub-50ms latency.
- Trades initiated on either platform trigger `TRADE_EXECUTED` state changes, immediately refreshing wallet balances and open bag lists on both interfaces.

