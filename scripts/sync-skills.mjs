import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEST = join(ROOT, '.agents', 'skills', 'skill-creator');

const SKILL_URL = 'https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/skill-creator/SKILL.md';

console.log('Syncing skill-creator from anthropics/skills...');

mkdirSync(DEST, { recursive: true });
execSync(`curl -sL "${SKILL_URL}" -o "${join(DEST, 'SKILL.md')}"`, { stdio: 'inherit' });

console.log('Done. Synced to .agents/skills/skill-creator/SKILL.md');
