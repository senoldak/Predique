# Contributing to Predique

Thank you for your interest in contributing to **Predique**! We welcome bug reports, pull requests, documentation improvements, and architectural discussions.

## Development Workflow

1. **Fork and Clone:**
   ```bash
   git clone https://github.com/your-username/predique.git
   cd predique
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```

4. **Run Tests:**
   ```bash
   npm test
   ```

5. **Type Checking & Build:**
   ```bash
   npm run build
   ```

## Code Guidelines

- **TypeScript:** Strict type checking is enforced (`tsconfig.json`). Do not use `any` without explicit justification.
- **Testing:** Write unit and integration tests using Vitest for any new functionality or bug fixes.
- **Security:** Never commit private keys or API tokens. User secrets must remain encrypted via `AES-256-GCM`.
- **Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`
  - `test: ...`
  - `refactor: ...`

## Pull Request Process

1. Ensure all tests pass (`npm test`) and TypeScript compiles without errors (`npm run build`).
2. Submit a PR describing your changes and link any related issues.
3. PRs will be reviewed and merged upon approval and passing CI checks.
