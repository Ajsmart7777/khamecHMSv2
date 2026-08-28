import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../netlify/functions/_shared/password';

describe('password hashing', () => {
  it('verifies a password hash without storing the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$v1\$/);
    expect(hash).not.toContain('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('rejects malformed hashes safely', async () => {
    await expect(verifyPassword('anything', 'plaintext-password')).resolves.toBe(false);
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });
});
