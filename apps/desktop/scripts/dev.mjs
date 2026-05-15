#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 编译主进程 TypeScript
const tsc = spawn('npx', ['esbuild',
  'src/main/index.ts',
  'src/main/window.ts',
  'src/main/api-server.ts',
  'src/main/agents-bridge.ts',
  'src/main/ipc-handlers.ts',
  'src/main/tray.ts',
  'src/main/updater.ts',
  'src/main/storage.ts',
  '--bundle=false',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--outdir=dist/main',
  '--sourcemap',
], { cwd: root, stdio: 'inherit' });

await new Promise((resolve, reject) => {
  tsc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`esbuild exit ${code}`)));
});

// 编译 preload
const preload = spawn('npx', ['esbuild',
  'src/preload/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--outfile=dist/preload/index.js',
  '--sourcemap',
], { cwd: root, stdio: 'inherit' });

await new Promise((resolve, reject) => {
  preload.on('close', (code) => code === 0 ? resolve() : reject(new Error(`esbuild exit ${code}`)));
});

console.log('[desktop] Main process compiled. Starting Electron...');

// 启动 Electron
const electron = await import('electron');
const electronPath = electron.default;

const proc = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    NOMI_DEV_WEB_PORT: process.env.NOMI_DEV_WEB_PORT || '5173',
    NOMI_DEV_API_PORT: process.env.NOMI_DEV_API_PORT || '8788',
  },
});

proc.on('close', (code) => process.exit(code ?? 0));
