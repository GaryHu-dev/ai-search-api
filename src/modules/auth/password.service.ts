import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Password hashing, isolated so the algorithm and its cost parameters live in
// one place. argon2id is the current OWASP recommendation for password storage.
@Injectable()
export class PasswordService {
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
}
