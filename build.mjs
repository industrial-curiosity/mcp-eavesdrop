import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'fs/promises';

const isWatch = process.argv.includes('--watch');

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

const proxyBuild = {
  entryPoints: ['src/proxy/server.ts'],
  bundle: true,
  outfile: 'dist/proxy/server.js',
  format: /** @type {const} */ ('cjs'),
  platform: /** @type {const} */ ('node'),
  target: 'node18',
  sourcemap: true,
};

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
  const [extCtx, proxyCtx, webviewCtx] = await Promise.all([
    esbuild.context(extensionBuild),
    esbuild.context(proxyBuild),
    esbuild.context(webviewBuild),
  ]);
  await Promise.all([extCtx.watch(), proxyCtx.watch(), webviewCtx.watch()]);
  await copyAssets();
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(proxyBuild),
    esbuild.build(webviewBuild),
  ]);
  await copyAssets();
  console.log('Build complete');
}
