import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, decryptWithRotation, isExampleMasterKey } from '../../src/security/crypto.js';

describe('AES-256-GCM Crypto Engine', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const privateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';

  it('encrypts and decrypts a private key identically', () => {
    const encrypted = encryptKey(privateKey, masterKey);
    expect(encrypted.ciphertext).not.toBe(privateKey);
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.authTag).toHaveLength(32);

    const decrypted = decryptKey(encrypted, masterKey);
    expect(decrypted).toBe(privateKey);
  });

  it('fails decryption if ciphertext is tampered with', () => {
    const encrypted = encryptKey(privateKey, masterKey);
    const flippedChar = encrypted.ciphertext[0] === '0' ? '1' : '0';
    const tampered = { ...encrypted, ciphertext: flippedChar + encrypted.ciphertext.slice(1) };
    expect(() => decryptKey(tampered, masterKey)).toThrow();
  });

  it('fails decryption with invalid master key', () => {
    const encrypted = encryptKey(privateKey, masterKey);
    const wrongKey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    expect(() => decryptKey(encrypted, wrongKey)).toThrow();
  });

  it('throws error if master key is not 32 bytes', () => {
    expect(() => encryptKey(privateKey, 'short')).toThrow(/Master key must be 32 bytes/);
  });

  it('flags the shipped example master key', () => {
    expect(isExampleMasterKey(masterKey)).toBe(true);
    expect(isExampleMasterKey('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')).toBe(false);
  });

  it('decrypts with previous key during rotation', () => {
    const oldKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const newKey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const encrypted = encryptKey(privateKey, oldKey);
    const res = decryptWithRotation(encrypted, newKey, oldKey);
    expect(res.plaintext).toBe(privateKey);
    expect(res.usedPrevious).toBe(true);
    expect(() => decryptWithRotation(encrypted, newKey)).toThrow();
  });
});
