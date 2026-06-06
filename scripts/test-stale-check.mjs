#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mod = await import('../dist/lib/stale-check.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpEavesdrop-stale-test-'));
const configPath = path.join(tmp, 'mcp.json');
const existingWrapper = path.join(tmp, 'wrapper.js');
fs.writeFileSync(existingWrapper, '// wrapper\n', 'utf8');

const config = {
  servers: {
    staleServer: {
      command: 'node',
      args: [path.join(tmp, 'missing-wrapper.js')],
      env: { MCPEAVESDROP_IPC_SOCKET: '/tmp/mcpEavesdrop.sock' },
    },
    healthyServer: {
      command: 'node',
      args: [existingWrapper],
      env: { MCPEAVESDROP_IPC_SOCKET: '/tmp/mcpEavesdrop.sock' },
    },
  },
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

const stale = mod.checkForStaleWrappers(configPath, 'servers');
assert.equal(stale.length, 1);
assert.equal(stale[0].serverName, 'staleServer');

console.log('PASS test-stale-check');
