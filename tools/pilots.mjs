#!/usr/bin/env node
/* Test-pilot code issuer.
 *
 * This site is static — no backend, no database — so there is nowhere to check
 * a code against. The way it stays honest anyway is that pilots.json holds no
 * names and no codes: each pilot's record is encrypted under their own code,
 * and "the code is valid" means "AES-GCM authenticated a record with the key
 * derived from what you typed". A wrong code decrypts nothing, and the file on
 * its own tells an attacker only how many pilots there are.
 *
 * Note what is deliberately absent: a list of code hashes. That would make the
 * published file a fast offline oracle for guessing ten characters, which is
 * the one thing a static site must not hand out.
 *
 * One PBKDF2 salt for the whole file rather than one per record, so the page
 * derives a key once and then tries each record's ciphertext at AES speed.
 * Per-record salts would mean one 250k-iteration derivation per pilot on every
 * submission — six seconds at thirty pilots. A shared salt is safe here
 * because the codes it is stretching are unique and random, which is the thing
 * a per-record salt exists to guarantee.
 *
 * Codes are 10 characters from a 22-letter alphabet with no 0/O/1/I/L/U, in two
 * groups of five: 2.7e13 combinations, so an offline attack on the file at a
 * generous ten thousand guesses a second is still measured in decades. Nine
 * characters would be two years and four would be an afternoon — the length is
 * the security here, since there is no server to rate-limit anything.
 *
 * The same code goes in the email and on the card inside the box. One code per
 * pilot, two places to find it: a pilot who has thrown the packaging away is
 * not locked out, and a pilot whose email went to spam has the box.
 *
 *   node tools/pilots.mjs add "Marcus Webb" --gym "Third Ave Boxing" --serial 003
 *   node tools/pilots.mjs list
 *
 * `add` prints the code once and cannot print it again — only the ciphertext is
 * kept. If a pilot loses it, issue a new one.
 */

import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'pilots.json');
/* The page lives on this site, at /test. It was drafted for a subdomain of its
   own, and the trade going the other way is deliberate: one host, one
   deployment, one set of fonts and one stylesheet directory, against a URL that
   reads slightly more like somewhere a stranger could have wandered onto. The
   page carries noindex and says nothing without a code, so the URL is the only
   part that changes. */
const BASE  = 'https://impktband.com/test/';

const ALPHABET  = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'.slice(0, 22);
const ITERATIONS = 250000;

const b64   = buf => Buffer.from(buf).toString('base64');
const unb64 = str => Buffer.from(str, 'base64');

/* Rejection sampling, not `% 22`. A byte modulo 22 hands the first twelve
   letters of the alphabet a 12/256 chance and the rest 11/256, which is a
   measurable bias over ten characters and the sort of thing that quietly
   removes a bit of entropy from every code issued. */
function mintCode() {
  const out = [];
  while (out.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 242 && out.length < 10) out.push(ALPHABET[byte % 22]);
    }
  }
  return out.join('').replace(/(.{5})(.{5})/, '$1-$2');
}

/* The page normalises what was typed the same way: case and separators are
   presentation, so "abcde-fghjk", "ABCDE FGHJK" and "ABCDEFGHJK" are one code.
   Anything outside the alphabet is dropped rather than rejected, which is what
   makes a code copied out of an email with a stray space still work. */
const normalise = code => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function keyFrom(code, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalise(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function load() {
  if (existsSync(STORE)) return JSON.parse(readFileSync(STORE, 'utf8'));
  return {
    v: 1,
    kdf: { salt: b64(crypto.getRandomValues(new Uint8Array(16))), iterations: ITERATIONS, hash: 'SHA-256' },
    records: []
  };
}

async function add(name, opts) {
  if (!name) throw new Error('usage: pilots.mjs add "Full Name" [--gym X] [--serial 003] [--note "..."]');
  const store = load();
  const code  = mintCode();
  const key   = await keyFrom(code, unb64(store.kdf.salt));
  const iv    = crypto.getRandomValues(new Uint8Array(12));

  const record = {
    name,
    first:  name.trim().split(/\s+/)[0],
    gym:    opts.gym    || '',
    serial: opts.serial || '',
    note:   opts.note   || '',
    issued: new Date().toISOString().slice(0, 10)
  };
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(record)));

  /* Records go in at a random position rather than appended, so the file's
     order is not the order the pilots were invited in — the only thing the
     ciphertext should leak is the count. */
  store.records.splice(
    crypto.getRandomValues(new Uint32Array(1))[0] % (store.records.length + 1),
    0, { iv: b64(iv), ct: b64(ct) });

  writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');

  const bare = code.replace('-', '');
  console.log(`\n  ${name}`);
  console.log(`  code     ${code}`);
  console.log(`  email    ${BASE}`);
  console.log(`  qr/link  ${BASE}?c=${bare}    (fills the field, does not submit)`);
  console.log(`\n  Print "${code}" on the card that goes in the box, and put the`);
  console.log(`  same code in the email. Not recoverable — send it now or reissue.\n`);
}

function list() {
  const store = load();
  console.log(`${store.records.length} pilot record(s) in pilots.json — names and codes are not stored.`);
}

const [cmd, ...rest] = process.argv.slice(2);
const positional = rest.filter(a => !a.startsWith('--'));
const opts = {};
rest.forEach((a, i) => { if (a.startsWith('--')) opts[a.slice(2)] = rest[i + 1]; });

if (cmd === 'add')       await add(positional[0], opts);
else if (cmd === 'list') list();
else {
  console.log('usage:\n  node tools/pilots.mjs add "Full Name" [--gym X] [--serial 003] [--note "..."]\n  node tools/pilots.mjs list');
  process.exit(1);
}
