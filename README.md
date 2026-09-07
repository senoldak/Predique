# Predique

> **High-Performance Multi-Chain Intelligence, Real-Time DEX Alpha & Quantitative Trading Terminal**  
> Monitoring smart money accumulation, scoring on-chain viability, and executing algorithmic trades across **Solana, Base, Ethereum, BNB Chain, and Robinhood Chain**.

[![CI](https://github.com/senoldak/BeBot/actions/workflows/ci.yml/badge.svg)](https://github.com/senoldak/BeBot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Tests-225%20passing-brightgreen.svg)](https://vitest.dev/)

---

## Overview

**Predique** is an institutional-grade, multi-chain DEX alpha surveillance and execution platform featuring dual synchronized interfaces: a feature-rich **Telegram Bot** powered by grammY and a sleek **Cyber-Hive Web Trading Terminal** built with React 19 and Vite.

Predique detects rapid cluster accumulation by vetted, high-win-rate "Smart Wallets", assesses contract security via GoPlus and RugCheck APIs, models order-flow imbalance (OFI), and executes trades either via single-tap instant orders or autonomous multi-bot quantitative strategies with MEV protection and anti-sandwich defense.

---

## Key Capabilities

1. **Dual-Interface Real-Time Synchronization:**
   - Trade, monitor positions, configure risk thresholds, and manage keystores interchangeably from Telegram or the Cyber-Hive Web Terminal.
   - Instant bi-directional WebSocket broadcast events (`/ws`).

2. **On-Chain Execution Engine & MEV Protection:**
   - **Solana:** Direct swaps via Jupiter v6 Swap API and Pump.fun bonding curves with custom Jito tip bundles for zero-sandwich protection.
   - **EVM (Base, Ethereum, BNB Chain):** Uniswap v2/v3 and PancakeSwap routing protected by Flashbots Builder RPC private mempools.

3. **Smart Wallet Swarm & Clustering Radar:**
   - Tracks 50+ vetted smart money wallets with historical win rates, avg ROI, and cluster detection ($\ge 3$ wallets in $<60\text{s}$).
   - Dynamic Order Flow Imbalance (OFI) and pile-in velocity indicators.

4. **Multi-Bot Quantitative Trading Engine:**
   - Run concurrent algorithmic bot profiles (`SWARM_MOMENTUM`, `MEAN_REVERSION`, `MULTI_STRATEGY_ENSEMBLE`, `VOLUME_BREAKOUT`, `SNIPER_SPIKE`).
   - Independent budget allocations, stop-loss / take-profit parameters, and strategy weights.

5. **Multi-Wallet Balance Sweeper & Cold Vault Security:**
   - Automated zero-balance sweeping across Solana, Base, Ethereum, and BNB Chain.
   - One-tap / automated transfer of trading profits to designated Cold Vault addresses.
   - Web UI Sweeper modal and Telegram `/sweep` commands with gas-reserve guards.

6. **Execution Safety & Institutional Risk Controls:**
   - **Dead-Man Switch:** Stale market signals older than 90 seconds are automatically rejected.
   - **Order Idempotency:** SHA-256 client order IDs and Redis deduplication protect against double-buys.
   - **Dust Check:** Minimum notional filters prevent dust spam orders.
   - **Asymmetric Trailing Stop & Dynamic Take-Profit:** Locks in tiered profits while dynamically trailing stops.
   - **Daily Drawdown Circuit Breaker:** Halts all automated trading if daily loss limit (e.g., 5%) is hit.
   - **Paper Trading Sandbox:** Full simulated trading lifecycle with mock wallets (10.0 SOL / 1.5 ETH virtual balance) and simulated PnL.

7. **Institutional Cryptographic Security:**
   - User private keys are encrypted using **AES-256-GCM** with a master key derivation scheme, ephemeral in-memory signing, and live key rotation support.

---

## System Architecture

```
                    ┌────────────────────────────────────────┐
                    │       Live Market Feed & DEX APIs      │
                    │   - DexScreener Real-Time Stream       │
                    │   - GoPlus & RugCheck Security Radar   │
                    │   - Jito & Flashbots MEV Endpoints     │
                    └───────────────────┬────────────────────┘
                                        │ (Normalized Token Signals)
                                        ▼
                    ┌────────────────────────────────────────┐
                    │      Swarm Signal Engine (Core)        │
                    │   - Cluster Detector (>= 3 Wallets)    │
                    │   - Order Flow Imbalance (OFI)         │
                    │   - Pile-in Velocity Calculator        │
                    │   - Early Exit Monitor                 │
                    │   - Mathematical Quality Scoring       │
                    └───────────────────┬────────────────────┘
                                        │
                                        ▼
                    ┌────────────────────────────────────────┐
                    │       Unified Core Service Bus         │
                    │  - WalletService (AES-256-GCM Vault)   │
                    │  - TradeService (Paper/Live Router)    │
                    │  - AutoTradeService (Multi-Bot Engine) │
                    │  - SweeperService (Cold Vault Routing) │
                    └───────────┬────────────────┬───────────┘
                                │                │
              (Signal Broadcast)│                │ (Real-Time WS & REST)
                                ▼                ▼
   ┌───────────────────────────────────┐    ┌───────────────────────────────────┐
   │         Telegram Bot UI           │    │     Cyber-Hive Web Terminal       │
   │   - grammY Framework              │    │   - React 19 + Vite Dashboard     │
   │   - Cyber-Hive Formatting         │    │   - Live Swarm Radar & PnL Pills  │
   │   - /start, /wallet, /web         │    │   - Stinger Quick-Buy & Sliders   │
   │   - /autotrade Bot Controller     │    │   - Multi-Bot Management Panel    │
   │   - /sweep Cold Vault Transfer    │    │   - Cold Vault Balance Sweeper    │
   │   - Inline Stinger Keyboards      │    │   - Settings & Keystore Status    │
   └─────────────────┬─────────────────┘    └─────────────────┬─────────────────┘
                     │                                        │
                     └───────────────────┬────────────────────┘
                                         │ (State Persistence & Execution)
                                         ▼
                    ┌────────────────────────────────────────┐
                    │      Encrypted Execution & Storage     │
                    │   • AES-256-GCM Encrypted Vaults       │
                    │   • Pump.fun & Jupiter (Jito Bundles)  │
                    │   • Uniswap v2/v3 & Pancake (Private)  │
                    │   • Redis Mutexes & Idempotency Cache  │
                    │   • PostgreSQL User Portfolios         │
                    └────────────────────────────────────────┘
```

---

## Project Structure

```
Predique/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI matrix (Node 20.x, 22.x)
├── docs/
│   └── ARCHITECTURE.md            # Mathematical formulas & architecture reference
├── src/
│   ├── bot/
│   │   ├── botManager.ts          # Telegram bot controller, queues & rate limiting
│   │   └── formatters.ts          # Terminal & alert formatting templates
│   ├── config/
│   │   └── index.ts               # Environment validation via Zod schemas
│   ├── database/
│   │   └── postgres.adapter.ts    # PostgreSQL trade & portfolio persistence
│   ├── engine/
│   │   ├── backtestValidator.ts   # Walk-Forward validation & Sharpe/MDD analysis
│   │   ├── scoring.ts             # Signal quality tier scoring algorithms
│   │   ├── smartWalletRegistry.ts # Vetted smart money address registry
│   │   ├── stateMachine.ts        # Cluster accumulation & buy/sell state machines
│   │   ├── strategyEvaluator.ts   # Mathematical models (Kelly, VaR, Sharpe)
│   │   ├── streamListener.ts      # WebSocket stream listener & normalizer
│   │   └── swarmDetector.ts       # Smart wallet cluster accumulation detection
│   ├── scripts/
│   │   └── simulate.ts            # High-speed terminal simulation CLI
│   ├── security/
│   │   ├── crypto.ts              # AES-256-GCM encryption & key rotation
│   │   └── tokenSecurity.service.ts # GoPlus & RugCheck contract auditing
│   ├── server/
│   │   ├── app.ts                 # Express REST API application
│   │   ├── auth.ts                # JWT authentication & session handling
│   │   ├── routes.ts              # REST endpoints (auth, wallets, trade, sweeper)
│   │   └── ws.ts                  # WebSocket broadcasting server (/ws)
│   ├── services/
│   │   ├── autoTrade.service.ts   # Multi-bot autotrading engine & risk manager
│   │   ├── marketFeed.service.ts  # Real-time DEX market feed ingestion
│   │   ├── trade.service.ts       # Trade routing, idempotency, paper balances
│   │   └── wallet.service.ts      # Multi-chain wallet custodian & sweeper
│   ├── trade/
│   │   ├── execution/
│   │   │   ├── evm.executor.ts    # EVM DEX routing & Flashbots RPC
│   │   │   ├── mev.ts             # MEV protection & Jito tip calculation
│   │   │   └── solana.executor.ts # Solana Jupiter & Pump.fun execution
│   │   └── router.ts              # Multi-chain swap router
│   ├── types/
│   │   ├── autotrade.ts           # Type definitions for bots & positions
│   │   └── signal.ts              # Market signal types
│   ├── utils/
│   │   ├── mask.ts                # Token & secret masking utilities
│   │   └── sanitize.ts            # Address checksum & input sanitization
│   └── index.ts                   # Unified entrypoint
├── tests/                         # Vitest automated test suite (47 suites, 225 tests)
├── web/                           # Cyber-Hive Web Trading Terminal
│   ├── src/
│   │   ├── components/
│   │   │   ├── ActiveTerminal.tsx # Quick-buy terminal & order form
│   │   │   ├── AutoTradePanel.tsx # Multi-bot quantitative dashboard
│   │   │   ├── Header.tsx         # Connection status & navigation
│   │   │   ├── PortfolioPanel.tsx # Vault balances, Sweeper & position manager
│   │   │   ├── SettingsModal.tsx  # Configuration & channel broadcast modal
│   │   │   └── SwarmRadar.tsx     # Real-time Swarm signals stream
│   │   ├── styles/
│   │   │   └── cyberhive.css      # Cyberhive terminal design system tokens
│   │   ├── App.tsx                # Main web application shell
│   │   └── main.tsx               # React DOM entry point
│   ├── index.html                 # HTML shell
│   ├── tsconfig.json              # Web TypeScript configuration
│   └── vite.config.ts             # Vite bundler & reverse proxy configuration
├── .env.example                   # Environment configuration template
├── .gitignore                     # Git exclusion rules
├── CONTRIBUTING.md                # Contribution guidelines
├── DESIGN.md                      # UI/UX design specifications
├── LICENSE                        # MIT License
├── package.json                   # Dependencies and scripts
├── SECURITY.md                    # Security policy & disclosure instructions
├── tsconfig.json                  # Backend TypeScript configuration
└── vitest.config.ts               # Test runner configuration
```

---

## Signal Tiers & Quality Scoring

| Tier | Icon | Criteria & Mathematical Qualifications |
| :--- | :--- | :--- |
| **PLATINUM** | `★★★` | **Strict 0 early selling** (`🔒 no early exit`) + Token Age $\ge$ 74m + Healthy Liquidity Ratio ($10\% \le \text{Liq/MC} \le 75\%$). |
| **GOLD** | `★★☆` | Seasoned token ($Age \ge 60\text{m}$) OR High Wallet Cluster ($\ge 6\text{ Smart Wallets}$). |
| **SILVER** | `★☆☆` | Young microcap token launch ($Age < 60\text{m}$). |
| **NEUTRAL** | `⚪` | Fresh token ($Age < 30\text{m}$) with immediate early exit detected (high dump risk). |
| **HONEYPOT TRAP** | `⚠️` | Malicious tax ($>10\%$), honeypot, freeze authority, or blacklisting logic detected. Immediate zero-rating. |

---

## Requirements

- **Node.js:** `v20.x` or `v22.x` LTS
- **Package Manager:** `npm` (v10+)
- **Redis:** `v6.0+` (optional for local testing; in-memory fallback provided)
- **PostgreSQL:** `v14+` (optional for local development)

---

## Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/senoldak/BeBot.git
cd BeBot
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy the template configuration file:
```bash
cp .env.example .env
```

Generate a secure 256-bit hexadecimal master key:
```bash
openssl rand -hex 32
```

Generate a secure JWT secret:
```bash
openssl rand -base64 48
```

Edit `.env` and configure your credentials:
```ini
PORT=3001
WEB_APP_URL=http://localhost:3000
BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHANNEL_ID=@predique
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/predique?schema=public
PREDIQUE_MASTER_KEY=your_generated_64_character_hex_key
JWT_SECRET=your_generated_jwt_secret_min_32_chars
ALLOW_DEMO_AUTH=true
ALLOW_LIVE_TRADING=false
```

---

## Available Commands

| Command | Description |
| :--- | :--- |
| `npm test` | Runs the full Vitest automated test suite (47 test files, 225 tests). |
| `npm run test:watch` | Runs Vitest in interactive watch mode for TDD. |
| `npm run build` | Compiles both backend TypeScript (`tsc`) and Web Terminal (`vite build`). |
| `npm run build:server`| Compiles only the backend TypeScript engine into `dist/`. |
| `npm run build:web`   | Compiles only the React/Vite Web Terminal into `web/dist/`. |
| `npm run dev`         | Starts the backend server and Telegram bot in development mode via `tsx`. |
| `npm run dev:web`     | Starts the Cyber-Hive Web Terminal development server on port 3000. |
| `npm run simulate`    | Launches the interactive CLI simulation demonstrating the full Swarm lifecycle. |
| `npm start`           | Runs the compiled production build from `dist/index.js`. |

---

## Automated Testing & Verification

Predique maintains strict unit, integration, and end-to-end test coverage across all subsystems.

Run the test suite:
```bash
npm test
```

Verification output:
```text
 Test Files  47 passed (47)
      Tests  225 passed (225)
   Duration  8.55s
```

### Test Suite Coverage Breakdown

- **Engine & Mathematics:** State machine transitions, score tiers, Kelly sizing, Sharpe/Sortino/Calmar ratios, Walk-Forward backtest validation (`tests/engine/`).
- **Services & Trading:** Multi-bot autotrading, MEV protection, Balance Sweeper, asymmetric exits, circuit breakers, idempotency, dust checks, dead-man switch, market feeds (`tests/services/`).
- **Execution & Security:** Solana Jupiter/Pump.fun executors, EVM Uniswap/Pancake executors, AES-256-GCM encryption, live key rotation, GoPlus/RugCheck audits (`tests/trade/`, `tests/security/`).
- **Telegram Bot:** Alert formatters, admin authorization, queue rate limiting, channel broadcasting, `/sweep` controls (`tests/bot/`).
- **Server & APIs:** JWT authentication, dual-interface REST endpoints, WebSocket broadcasts (`tests/server/`).
- **End-to-End Lifecycles:** Full dual-interface and simulation workflows (`tests/e2e/`).

---

## Security Architecture

Predique is engineered with a security-first posture:
- **Military-Grade Encryption:** User private keys are protected with **AES-256-GCM** authenticated encryption. Each record uses a unique 12-byte initialization vector (IV) and 16-byte authentication tag.
- **Key Rotation Protocol:** Seamless zero-downtime key rotation (`PREDIQUE_MASTER_KEY_PREVIOUS` fallback).
- **Ephemeral Key Handling:** Plaintext private keys are never stored in databases, never written to disk, and never transmitted to client browsers.
- **Fail-Closed Permissions:** Administrative operations (`/autotrade`, live trading configuration, token rotation) require strict admin authorization.
- **Sanitized Outputs:** HTML entities and Markdown characters are escaped to prevent injection and DoS attacks.

For vulnerability reporting, please see [SECURITY.md](SECURITY.md).

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code standards, testing requirements, and the pull request process.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
