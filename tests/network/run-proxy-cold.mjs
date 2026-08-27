// Compile only the network entries and native pi island into a fresh directory.
// Never touch dist-electron, the running app, real preferences or paid endpoints.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/lib/tsc.js');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const buildRoot = path.join(mkdtempSync(path.join(root, '.tmp/repair-network-tests-')), 'electron');

async function run(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve()
      : reject(new Error(`${path.basename(command)} exited ${code ?? signal}`)));
  });
}

console.log(`Network fixture build: ${buildRoot}`);
await run(process.execPath, [compiler, '-p', 'electron/tsconfig.pi.json', '--outDir', buildRoot]);
await run(process.execPath, [compiler,
  'electron/systemProxy.ts', 'electron/appFetch.ts', 'electron/vendor/vendorBaseFallback.ts',
  'electron/ai/buildAiSdkModel.ts', 'electron/proxyProbe.ts', 'electron/hardenedFetch.ts',
  '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
  '--esModuleInterop', '--skipLibCheck', '--strict', '--noEmitOnError',
  '--rootDir', 'electron', '--outDir', buildRoot,
]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await run(require('electron'), [path.join(root, 'tests/network/proxy-cold-main.cjs'),
  '--network-build-root', buildRoot], env);
