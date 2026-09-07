# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Predique seriously. If you believe you have found a security vulnerability in Predique, please do not open a public issue. Instead, report it privately via email or GitHub Private Vulnerability Reporting:

- **Email:** security@predique.local (or your designated security contact)
- **GitHub:** Submit an advisory through the "Security" tab of this repository.

### Vulnerability Handling Process

1. **Acknowledgment:** We will acknowledge receipt of your vulnerability report within 48 hours.
2. **Investigation:** We will investigate and verify the vulnerability and its severity.
3. **Remediation:** A fix will be developed, tested, and released as quickly as feasible.
4. **Disclosure:** Once a patch is published, we will coordinate public disclosure.

## Security Best Practices for Operators

- **Master Key Security:** Always generate a high-entropy 256-bit hexadecimal key (`openssl rand -hex 32`) for `PREDIQUE_MASTER_KEY`. Never commit this key to source control.
- **RPC Isolation:** Use private, authenticated RPC endpoints (e.g. Alchemy, QuickNode, Helius) with rate-limiting and access restrictions.
- **Redis Security:** Ensure your Redis instance is protected with authentication (`requirepass`) and not exposed to the public internet.
