import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// Password hashing, isolated so the algorithm and its cost parameters live in
// one place. argon2id is the current OWASP recommendation for password storage.
@Injectable()
export class PasswordService {
  // A throwaway hash, computed once, used to spend argon2 time on a login for an
  // account that has no password — see verifyDummy.
  private dummyHash?: string;

  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // A malformed or unreadable hash should read as "wrong password", never
      // bubble up as a 500.
      return false;
    }
  }

  // Always returns false, but does the same argon2 work a real verify would, so
  // a login for a non-existent account takes the same time as one for a real
  // account — closing a timing side-channel that leaks which emails exist.
  async verifyDummy(plain: string): Promise<false> {
    this.dummyHash ??= await this.hash(randomBytes(16).toString('hex'));
    await this.verify(this.dummyHash, plain);
    return false;
  }
}
