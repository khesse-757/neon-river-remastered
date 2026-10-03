#!/usr/bin/env node
// Secret scanner for Neon River.
//   node scripts/check-secrets.mjs --staged     scan lines added in the git index (pre-commit)
//   node scripts/check-secrets.mjs --dir dist   scan a build output (postbuild)
//   node scripts/check-secrets.mjs --tracked    scan every tracked file (CI)
// Exits 1 on any finding. Never prints the secret itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  ['ElevenLabs-style key', /\bsk_[A-Za-z0-9]{32,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Key assignment', /\b(ELEVENLABS|GEMINI|GOOGLE|TRIPO)_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/],
];

const envSecrets = Object.entries(process.env)
  .filter(([k, v]) => /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(k) && v && v.length >= 16)
  .map(([k, v]) => [k, v]);

const findings = [];
const scanText = (label, text) => {
  for (const [name, re] of PATTERNS) if (re.test(text)) findings.push(`${label}: looks like a ${name}`);
  for (const [k, v] of envSecrets) if (text.includes(v)) findings.push(`${label}: contains the value of $${k}`);
};

const mode = process.argv[2] ?? '--staged';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (mode === '--staged') {
  const names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
  for (const n of names) {
    if (/(^|\/)\.env(\.|$)/.test(n) && !n.endsWith('.env.example')) findings.push(`${n}: .env files must not be committed`);
  }
  const diff = git('diff', '--cached', '--unified=0', '--no-color', '--text');
  let file = '?';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) scanText(file, line);
  }
} else if (mode === '--dir') {
  const root = process.argv[3] ?? 'dist';
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|css|html|json|map|txt|webmanifest|svg)$/.test(e)) scanText(p, readFileSync(p, 'utf8'));
    }
  };
  walk(root);
} else if (mode === '--tracked') {
  for (const n of git('ls-files').split('\n').filter(Boolean)) {
    if (/\.(png|jpe?g|gif|webp|mp3|wav|ogg|woff2?|glb|ico)$/i.test(n)) continue;
    try {
      scanText(n, readFileSync(n, 'utf8'));
    } catch {
      /* unreadable or removed */
    }
  }
} else {
  console.error('usage: check-secrets.mjs --staged | --dir <path> | --tracked');
  process.exit(2);
}

if (findings.length) {
  console.error('✗ Secret scan failed:\n  ' + [...new Set(findings)].join('\n  '));
  console.error('Remove the secret, rotate the key if it was ever committed or pushed, then retry.');
  process.exit(1);
}
console.log(`✓ Secret scan passed (${mode})`);
