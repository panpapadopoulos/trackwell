#!/usr/bin/env node
/**
 * Produce the ADMIN_PASSWORD_HASH Worker secret. The password is read from a
 * hidden prompt (never an argument, so it can't land in shell history) and is
 * never printed or written to disk. Only the PBKDF2 hash is printed.
 *
 *   node tools/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
 */
import { createInterface } from 'node:readline';
import { webcrypto as crypto } from 'node:crypto';

const ITER = 100_000; // Cloudflare Workers' PBKDF2 maximum
const b64url = (b) => Buffer.from(b).toString('base64url');

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = () => undefined; // hide what is typed
    process.stderr.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

const pw = await ask('New Trackwell admin password (min 12 chars): ');
const again = await ask('Repeat: ');
if (pw !== again) throw new Error('Passwords do not match');
if (pw.length < 12) throw new Error('Password must be at least 12 characters');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
  'deriveBits',
]);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
  key,
  256,
);
process.stdout.write(`pbkdf2-sha256$${ITER}$${b64url(salt)}$${b64url(new Uint8Array(bits))}\n`);
