#!/usr/bin/env node
/**
 * Syncs .opsx/ (single source of truth) → .github/ and .cursor/
 *
 * .opsx/prompts/*.md      → .cursor/commands/*.md          (verbatim)
 *                         → .github/prompts/*.prompt.md    (cursor-only frontmatter fields stripped)
 * .opsx/skills/*\/SKILL.md → .cursor/skills/*\/SKILL.md    (verbatim)
 *                          → .github/skills/*\/SKILL.md    (verbatim)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const OPSX_PROMPTS    = join(ROOT, '.opsx', 'prompts');
const OPSX_SKILLS     = join(ROOT, '.opsx', 'skills');
const GITHUB_PROMPTS  = join(ROOT, '.github', 'prompts');
const GITHUB_SKILLS   = join(ROOT, '.github', 'skills');
const CURSOR_COMMANDS = join(ROOT, '.cursor', 'commands');
const CURSOR_SKILLS   = join(ROOT, '.cursor', 'skills');

// Fields that are Cursor-specific and must be stripped from GitHub prompt frontmatter
const CURSOR_ONLY_FIELDS = new Set(['name', 'id', 'category']);

/**
 * Strip Cursor-only keys from YAML frontmatter, leaving the rest intact.
 * Handles both LF and CRLF line endings.
 */
function stripCursorFields(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return content;

  const strippedLines = match[1]
    .split(/\r?\n/)
    .filter(line => {
      const key = line.match(/^([\w-]+)\s*:/)?.[1];
      return !CURSOR_ONLY_FIELDS.has(key);
    });

  const newFrontmatter = `---\n${strippedLines.join('\n')}\n---\n`;
  return content.replace(match[0], newFrontmatter);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
}

function syncPrompts() {
  if (!existsSync(OPSX_PROMPTS)) {
    console.error('Error: .opsx/prompts/ not found. Ensure the .opsx directory exists.');
    process.exit(1);
  }

  ensureDir(OPSX_PROMPTS);
  cleanDir(GITHUB_PROMPTS);
  cleanDir(CURSOR_COMMANDS);

  const files = readdirSync(OPSX_PROMPTS).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(join(OPSX_PROMPTS, file), 'utf8');

    // Cursor: verbatim copy
    writeFileSync(join(CURSOR_COMMANDS, file), content);
    console.log(`  → .cursor/commands/${file}`);

    // GitHub: strip cursor-only frontmatter fields, rename to *.prompt.md
    const promptName = file.replace(/\.md$/, '.prompt.md');
    writeFileSync(join(GITHUB_PROMPTS, promptName), stripCursorFields(content));
    console.log(`  → .github/prompts/${promptName}`);
  }
}

function syncSkills() {
  if (!existsSync(OPSX_SKILLS)) {
    console.error('Error: .opsx/skills/ not found. Ensure the .opsx directory exists.');
    process.exit(1);
  }

  const skillDirs = readdirSync(OPSX_SKILLS).filter(
    f => statSync(join(OPSX_SKILLS, f)).isDirectory()
  );

  cleanDir(GITHUB_SKILLS);
  cleanDir(CURSOR_SKILLS);

  for (const skill of skillDirs) {
    const src = join(OPSX_SKILLS, skill, 'SKILL.md');
    if (!existsSync(src)) continue;

    const content = readFileSync(src, 'utf8');

    ensureDir(join(GITHUB_SKILLS, skill));
    writeFileSync(join(GITHUB_SKILLS, skill, 'SKILL.md'), content);
    console.log(`  → .github/skills/${skill}/SKILL.md`);

    ensureDir(join(CURSOR_SKILLS, skill));
    writeFileSync(join(CURSOR_SKILLS, skill, 'SKILL.md'), content);
    console.log(`  → .cursor/skills/${skill}/SKILL.md`);
  }
}

console.log('Syncing .opsx → .github and .cursor\n');
console.log('Prompts:');
syncPrompts();
console.log('\nSkills:');
syncSkills();
console.log('\nDone.');
