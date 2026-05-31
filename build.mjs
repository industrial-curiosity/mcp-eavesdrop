import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile } from 'fs/promises';

const isWatch = process.argv.includes('--watch');

// Read wrapper version from source so esbuild can emit it as a banner comment.
// esbuild strips all comments by default, but the banner is always preserved.
const wrapperSrc = await readFile('src/proxy/stdio-wrapper.ts', 'utf8');
const wrapperVersionMatch = /^\/\/\s*MYAI_WRAPPER_VERSION=(.+)$/m.exec(wrapperSrc);
const wrapperVersion = wrapperVersionMatch?.[1]?.trim() ?? 'unknown';

const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: /** @type {const} */ ('cjs'),
  platform: /** @type {const} */ ('node'),
  target: 'node18',
  sourcemap: true,
};

const daemonBuild = {
  entryPoints: ['src/daemon/index.ts'],
  bundle: true,
  outfile: 'dist/daemon/index.js',
  format: /** @type {const} */ ('cjs'),
  platform: /** @type {const} */ ('node'),
  target: 'node18',
  sourcemap: true,
};

const stdioWrapperBuild = {
  entryPoints: ['src/proxy/stdio-wrapper.ts'],
  bundle: true,
  outfile: 'dist/proxy/stdio-wrapper.js',
  format: /** @type {const} */ ('cjs'),
  platform: /** @type {const} */ ('node'),
  target: 'node18',
  sourcemap: true,
  banner: { js: `// MYAI_WRAPPER_VERSION=${wrapperVersion}` },
};

const lifecycleBuild = {
  entryPoints: ['src/lifecycle.ts'],
  bundle: true,
  outfile: 'dist/lifecycle.js',
  format: /** @type {const} */ ('cjs'),
  platform: /** @type {const} */ ('node'),
  target: 'node18',
  sourcemap: true,
};

const utilsBuilds = [
  {
    entryPoints: ['src/mcp-config.ts'],
    bundle: true,
    outfile: 'dist/lib/mcp-config.js',
    external: ['vscode'],
    format: /** @type {const} */ ('cjs'),
    platform: /** @type {const} */ ('node'),
    target: 'node18',
    sourcemap: true,
  },
  {
    entryPoints: ['src/mcp-wrap.ts'],
    bundle: true,
    outfile: 'dist/lib/mcp-wrap.js',
    format: /** @type {const} */ ('cjs'),
    platform: /** @type {const} */ ('node'),
    target: 'node18',
    sourcemap: true,
  },
  {
    entryPoints: ['src/wrapper-deploy.ts'],
    bundle: true,
    outfile: 'dist/lib/wrapper-deploy.js',
    external: ['vscode'],
    format: /** @type {const} */ ('cjs'),
    platform: /** @type {const} */ ('node'),
    target: 'node18',
    sourcemap: true,
  },
  {
    entryPoints: ['src/stale-check.ts'],
    bundle: true,
    outfile: 'dist/lib/stale-check.js',
    format: /** @type {const} */ ('cjs'),
    platform: /** @type {const} */ ('node'),
    target: 'node18',
    sourcemap: true,
  },
];

const webviewBuild = {
  entryPoints: ['src/panel/webview/app.ts'],
  bundle: true,
  outfile: 'dist/panel/webview/app.js',
  format: /** @type {const} */ ('iife'),
  platform: /** @type {const} */ ('browser'),
  target: 'es2020',
  sourcemap: true,
};

async function copyAssets() {
  await mkdir('dist/panel/webview', { recursive: true });
  await Promise.all([
    copyFile('src/panel/webview/index.html', 'dist/panel/webview/index.html'),
    copyFile('src/panel/webview/styles.css', 'dist/panel/webview/styles.css'),
  ]);
}

if (isWatch) {
  const [extCtx, daemonCtx, wrapperCtx, lifecycleCtx, webviewCtx, ...utilsCtx] = await Promise.all([
    esbuild.context(extensionBuild),
    esbuild.context(daemonBuild),
    esbuild.context(stdioWrapperBuild),
    esbuild.context(lifecycleBuild),
    esbuild.context(webviewBuild),
    ...utilsBuilds.map((build) => esbuild.context(build)),
  ]);
  await Promise.all([
    extCtx.watch(),
    daemonCtx.watch(),
    wrapperCtx.watch(),
    lifecycleCtx.watch(),
    webviewCtx.watch(),
    ...utilsCtx.map((ctx) => ctx.watch()),
  ]);
  await copyAssets();
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(daemonBuild),
    esbuild.build(stdioWrapperBuild),
    esbuild.build(lifecycleBuild),
    esbuild.build(webviewBuild),
    ...utilsBuilds.map((build) => esbuild.build(build)),
  ]);
  await copyAssets();
  console.log('Build complete');
}
