import argon2 from 'argon2';
import { randomBytes } from 'crypto';

// OWASP-recommended minimums for argon2id (2024 cheat sheet).
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTS);
}

export function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return argon2.verify(hash, plaintext);
}

// Random temp password for admin-triggered resets — 20 URL-safe chars, ~120 bits of entropy.
export function generateTempPassword(): string {
  return randomBytes(15).toString('base64url');
}
