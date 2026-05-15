import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

let bridgeProcess: ChildProcess | null = null;

async function waitForHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error(`status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Agents bridge not healthy after ${timeoutMs}ms`);
}

export async function startAgentsBridge(apiPort: number): Promise<void> {
  const agentsCliEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'agents-cli', 'dist', 'cli', 'index.js')
    : path.resolve(__dirname, '../../../agents-cli/dist/cli/index.js');

  const bridgePort = 8799;

  bridgeProcess = spawn(process.execPath, [agentsCliEntry, 'serve', '--port', String(bridgePort)], {
    env: {
      ...process.env,
      TAPCANVAS_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      AGENTS_PROFILE: 'code',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  bridgeProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[agents-bridge] ${data.toString().trim()}`);
  });
  bridgeProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[agents-bridge] ${data.toString().trim()}`);
  });
  bridgeProcess.on('exit', (code) => {
    console.log(`[agents-bridge] Process exited with code ${code}`);
    bridgeProcess = null;
  });

  process.env.AGENTS_BRIDGE_BASE_URL = `http://127.0.0.1:${bridgePort}`;

  try {
    await waitForHealthy(`http://127.0.0.1:${bridgePort}/health`, 15_000);
    console.log('[agents-bridge] Ready');
  } catch (err) {
    console.warn('[agents-bridge] Health check failed, continuing anyway:', err);
  }
}

export function stopAgentsBridge(): void {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
}

app.on('will-quit', () => {
  stopAgentsBridge();
});
