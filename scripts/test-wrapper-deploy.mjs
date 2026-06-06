#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpEavesdrop-deploy-test-'));
const fakeHome = path.join(tmpRoot, 'home');
fs.mkdirSync(fakeHome, { recursive: true });
process.env.HOME = fakeHome;

const bundledWrapperPath = path.join(tmpRoot, 'dist', 'proxy', 'stdio-wrapper.js');
fs.mkdirSync(path.dirname(bundledWrapperPath), { recursive: true });

const mod = await import('../dist/lib/wrapper-deploy.js');

const context = {
  asAbsolutePath(relativePath) {
    return path.join(tmpRoot, relativePath);
  },
};

fs.writeFileSync(bundledWrapperPath, '// MCPEAVESDROP_WRAPPER_VERSION=1\nconsole.log("v1");\n', 'utf8');
const first = mod.deployWrapper(context);
assert.equal(first.deployed, true);
assert.equal(fs.existsSync(first.deployedPath), true);

const second = mod.deployWrapper(context);
assert.equal(second.deployed, false);

fs.writeFileSync(bundledWrapperPath, '// MCPEAVESDROP_WRAPPER_VERSION=2\nconsole.log("v2");\n', 'utf8');
const third = mod.deployWrapper(context);
assert.equal(third.deployed, true);
assert.equal(third.version, '2');

console.log('PASS test-wrapper-deploy');
