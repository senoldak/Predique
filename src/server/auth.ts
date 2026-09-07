import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export const JWT_ISSUER = 'predique';
export const JWT_AUDIENCE = 'predique-terminal';
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertSecretStrength(secret: string): void {
  if (!secret || secret.length < 16) {
    throw new Error('JWT secret too short: provide a >=32 character JWT_SECRET via env');
  }
}

function assertUserId(userId: string): void {
  if (!USER_ID_RE.test(userId)) {
    throw new Error('Invalid userId format');
  }
}

interface OneTimeTokenRecord {
  userId: string;
  expiresAt: number;
}

const oneTimeTokens: Map<string, OneTimeTokenRecord> = new Map();

export function createOneTimeToken(userId: string, ttlMs: number = 5 * 60 * 1000): string {
  assertUserId(userId);
  const token = `ott_${crypto.randomBytes(24).toString('hex')}`;
  oneTimeTokens.set(token, {
    userId,
    expiresAt: Date.now() + ttlMs,
  });
  return token;
}

export function generateWebLoginUrl(userId: string, baseUrl: string = 'http://localhost:3000'): string {
  const token = createOneTimeToken(userId);
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/?token=${token}`;
}

export function redeemOneTimeToken(token: string): string | null {
  const record = oneTimeTokens.get(token);
  if (!record) return null;
  oneTimeTokens.delete(token);

  if (Date.now() > record.expiresAt) {
    return null;
  }
  return record.userId;
}

export function signJwt(userId: string, secret: string, isAdmin = false): string {
  assertSecretStrength(secret);
  assertUserId(userId);
  return jwt.sign({ sub: userId, admin: isAdmin === true }, secret, {
    algorithm: 'HS256',
    expiresIn: '7d',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

export function verifyJwt(token: string, secret: string): { sub: string; admin: boolean } | null {
  try {
    assertSecretStrength(secret);
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }) as { sub: string; admin?: unknown };
    if (!payload.sub || !USER_ID_RE.test(payload.sub)) return null;
    return { sub: payload.sub, admin: payload.admin === true };
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

export function createAuthMiddleware(secret: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyJwt(token, secret);
    if (!payload || !payload.sub) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.userId = payload.sub;
    req.isAdmin = payload.admin;
    next();
  };
}
