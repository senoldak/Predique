import crypto from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export const EXAMPLE_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export function isExampleMasterKey(masterKeyHex: string): boolean {
  return masterKeyHex.toLowerCase() === EXAMPLE_MASTER_KEY;
}

export function encryptKey(plainKey: string, masterKeyHex: string): EncryptedPayload {
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Master key must be 32 bytes (64 hex characters)');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag
  };
}

export function decryptKey(payload: EncryptedPayload, masterKeyHex: string): string {
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Master key must be 32 bytes (64 hex characters)');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

  let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function decryptWithRotation(
  payload: EncryptedPayload,
  primaryHex: string,
  previousHex?: string | null
): { plaintext: string; usedPrevious: boolean } {
  try {
    return { plaintext: decryptKey(payload, primaryHex), usedPrevious: false };
  } catch (primaryErr) {
    if (!previousHex) throw primaryErr;
    const plaintext = decryptKey(payload, previousHex);
    return { plaintext, usedPrevious: true };
  }
}
