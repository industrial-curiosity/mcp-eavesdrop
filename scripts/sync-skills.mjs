#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILL_DIR = join(ROOT, '.agents', 'skills', 'skill-creator');
const REMOTE_DIR = join(SKILL_DIR, 'remote');
const LATEST_PATH = join(REMOTE_DIR, 'SKILL.latest.md');

const SKILL_URL = 'https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/skill-creator/SKILL.md';

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const fail = (msg) => { console.error('[sync-skills] ERROR:', msg); process.exit(1); };

// ── 1. Download ──────────────────────────────────────────────────────────────
console.log('Syncing skill-creator from anthropics/skills...');
mkdirSync(REMOTE_DIR, { recursive: true });

try {
  execSync(`curl -fsSL "${SKILL_URL}" -o "${LATEST_PATH}"`, { stdio: 'inherit' });
} catch {
  fail(`Failed to download ${SKILL_URL}`);
}

// ── 2. Checksum latest ───────────────────────────────────────────────────────
const latestContent = readFileSync(LATEST_PATH, 'utf8');
const latestChecksum = createHash('sha256').update(latestContent).digest('hex');

// ── 3. Find most recent snapshot ─────────────────────────────────────────────
const prevChecksumFile = readdirSync(REMOTE_DIR)
  .filter(f => /^SKILL\.\d{8}\.checksum$/.test(f))
  .sort()
  .at(-1);

const commit = () => {
  const destMd = join(REMOTE_DIR, `SKILL.${today}.md`);
  const destCs = join(REMOTE_DIR, `SKILL.${today}.checksum`);
  renameSync(LATEST_PATH, destMd);
  writeFileSync(destCs, latestChecksum + '\n');
  console.log(`Snapshot saved: remote/SKILL.${today}.md`);
};

// ── 4. No prior snapshot → save and exit ─────────────────────────────────────
if (!prevChecksumFile) {
  console.log('No previous snapshot found — saving initial version.');
  commit();
  process.exit(0);
}

// ── 5. Compare checksums ─────────────────────────────────────────────────────
const prevChecksum = readFileSync(join(REMOTE_DIR, prevChecksumFile), 'utf8').trim();

if (latestChecksum === prevChecksum) {
  console.log('No upstream changes detected — skipping snapshot.');
  unlinkSync(LATEST_PATH);
  process.exit(0);
}

// ── 6. Diff and report ───────────────────────────────────────────────────────
const prevDate = prevChecksumFile.replace('SKILL.', '').replace('.checksum', '');
const prevMdPath = join(REMOTE_DIR, `SKILL.${prevDate}.md`);

console.log(`\nUpstream change detected (${prevDate} → ${today}):`);
console.log('─'.repeat(70));

if (existsSync(prevMdPath)) {
  const diff = spawnSync('diff', ['-u', prevMdPath, LATEST_PATH], { encoding: 'utf8' });
  console.log(diff.stdout || '(no textual diff despite checksum change)');
} else {
  console.log(`(previous snapshot SKILL.${prevDate}.md not found — cannot diff)`);
  console.log('Full new content:\n');
  console.log(latestContent);
}

console.log('─'.repeat(70));
console.log('\nAction required: review the diff above and update accordingly:');
console.log('  .agents/skills/skill-creator/SKILL.md\n');

commit();
