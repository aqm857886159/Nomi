#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cpSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

async function run(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
  return new Promise((resolve, reject) => {
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)));
  });
}

// 0. 生成 desktop Prisma client（使用 libsql schema）
await run('pnpm', ['--filter', '@nomi/api', 'prisma:generate:desktop'], { cwd: resolve(root, '../..') });

// 1. 编译主进程
await run('npx', ['esbuild',
  'src/main/index.ts', 'src/main/window.ts', 'src/main/api-server.ts',
  'src/main/agents-bridge.ts', 'src/main/ipc-handlers.ts',
  'src/main/tray.ts', 'src/main/updater.ts', 'src/main/storage.ts',
  '--bundle=false', '--platform=node', '--target=node20', '--format=cjs',
  '--outdir=dist/main',
], { cwd: root });

// 2. 编译 preload
await run('npx', ['esbuild',
  'src/preload/index.ts',
  '--bundle', '--platform=node', '--target=node20', '--format=cjs',
  '--outfile=dist/preload/index.js',
], { cwd: root });

// 3. 复制 web 构建产物到 renderer 目录
const webDist = resolve(root, '../web/dist');
const rendererDist = resolve(root, 'dist/renderer');
cpSync(webDist, rendererDist, { recursive: true });
console.log('[desktop] Copied web dist to dist/renderer');

console.log('[desktop] Build complete. Run "pnpm dist" to package.');
