#!/usr/bin/env node
// PreToolUse guard: stops Claude from printing, reading, writing, or committing API keys.
// Exit 2 + stderr = blocked (Claude sees the reason and adjusts). Exit 0 = normal permission flow.
import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

const block = (why) => {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-secrets.mjs: ${why}\n` +
      'API keys live only in the shell environment. Scripts read them from env themselves; ' +
      'never echo, print, read, pass, or write them. Use the probe scripts to check SET/MISSING.\n',
  );
  process.exit(2);
};

// Actual secret values present in this environment (never printed).
const secretValues = Object.entries(process.env)
  .filter(([k, v]) => /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(k) && v && v.length >= 16)
  .map(([, v]) => v);
const containsSecretValue = (text) => secretValues.some((v) => text.includes(v));

const KEY_NAMES = /\b(ELEVENLABS|GEMINI|GOOGLE|TRIPO|OPENAI|ANTHROPIC|GH|GITHUB)_(API_KEY|TOKEN)\b/;
const SECRET_FILES =
  /(^|[\s'"=/])(\.env(\.[\w-]+)?|\.zshrc|\.zprofile|\.bashrc|\.bash_profile|\.profile|secrets\.env|\.netrc|\.npmrc)(\s|$|['"])/;

if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  if (containsSecretValue(cmd)) block('the command contains a secret value.');
  if (KEY_NAMES.test(cmd)) block('the command references an API key variable by name.');
  if (/--api-key\b/.test(cmd)) block('passing --api-key on the command line exposes the key.');
  if (/(^|[;&|]\s*)(printenv|env|set|export -p|declare -x|compgen -e)\s*($|[|;&>])/.test(cmd))
    block('dumping the environment would print secrets.');
  if (/\b(cat|less|more|head|tail|grep|rg|sed|awk|bat|source|\.)\b[^|;&]*/.test(cmd) && SECRET_FILES.test(cmd))
    block('reading shell profiles or env files can expose secrets.');
  if (/\bgit\s+add\b/.test(cmd) && /(^|\s)(-f|--force)(\s|$)/.test(cmd))
    block('force-adding ignored files can commit secrets.');
  if (/\bgit\s+add\b/.test(cmd) && /\.env\b/.test(cmd)) block('.env files are never committed.');
}

if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
  const text = [ti.content, ti.new_string, ti.new_source].filter(Boolean).join('\n');
  const path = String(ti.file_path ?? ti.notebook_path ?? '');
  if (containsSecretValue(text)) block(`refusing to write a secret value into ${path}.`);
  if (/(^|\/)\.env(\.|$)/.test(path) && !/\.env\.example$/.test(path)) block('.env files are not written by Claude.');
  if (/\bVITE_\w*(API_KEY|TOKEN|SECRET)\b/.test(text))
    block('VITE_* variables are bundled into the browser build; keys must never use that prefix.');
}

process.exit(0);
