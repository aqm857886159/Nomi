import { app } from 'electron';
import net from 'node:net';
import path from 'node:path';
import { ensureUserDataDirs, getOrCreateJwtSecret, getOrCreateLocalUserId, getAssetsDir, getUserDataDir } from './storage';

export interface ApiServerResult {
  port: number;
  close: () => Promise<void>;
}

async function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', () => {
      // preferred 端口被占用，让系统分配
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address() as net.AddressInfo;
        fallback.close(() => resolve(addr.port));
      });
    });
  });
}

export async function startApiServer(): Promise<ApiServerResult> {
  ensureUserDataDirs();

  const jwtSecret = getOrCreateJwtSecret();
  const localUserId = getOrCreateLocalUserId();
  const assetsDir = getAssetsDir();
  const devBypassSecret = `desktop_${jwtSecret.slice(0, 16)}`;

  // 设置 Desktop 模式专用环境变量
  const dbPath = path.join(getUserDataDir(), 'nomi.db');
  // libsql 要求 file: 协议，Windows 路径需要转换正斜杠
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`;
  process.env.DATABASE_URL = dbUrl;
  process.env.PRISMA_DB_PROVIDER = 'libsql';
  process.env.JWT_SECRET = jwtSecret;
  process.env.AGENTS_BRIDGE_AUTOSTART = 'false'; // 主进程另外管理
  process.env.ASSET_HOSTING_LOCAL_MODE = '1';
  process.env.ASSET_LOCAL_ROOT = assetsDir;

  // Desktop 模式跳过认证
  process.env.TAPCANVAS_DEV_PUBLIC_BYPASS = '1';
  process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET = devBypassSecret;
  process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID = localUserId;
  process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE = 'admin';

  // 动态 require hono-api（必须先 build hono-api）
  // hono-api build 产物在 apps/hono-api/dist/main.js
  const apiDistPath = app.isPackaged
    ? path.join(process.resourcesPath, 'hono-api', 'dist', 'main.js')
    : path.resolve(__dirname, '../../../hono-api/dist/main.js');

  let createNomiApp: () => Promise<unknown>;
  let createNodeWorkerEnv: () => Promise<unknown>;
  let createHonoNodeServer: (app: unknown, env: unknown) => { listen: (port: number, host: string, cb: () => void) => void; close: (cb: () => void) => void };

  try {
    const apiModule = require(apiDistPath);
    createNomiApp = apiModule.createNomiApp;
    createNodeWorkerEnv = apiModule.createNodeWorkerEnv;
    createHonoNodeServer = apiModule.createHonoNodeServer;
  } catch (err) {
    throw new Error(
      `Failed to load hono-api from ${apiDistPath}. ` +
      `Make sure to run "pnpm build:api" before starting the desktop app in production. ` +
      `Original error: ${err instanceof Error ? err.message : err}`
    );
  }

  const port = await findFreePort(8788);

  const honoApp = await createNomiApp();
  const env = await createNodeWorkerEnv();
  const server = createHonoNodeServer(honoApp, env);

  await new Promise<void>((resolve, reject) => {
    try {
      server.listen(port, '127.0.0.1', resolve);
    } catch (err) {
      reject(err);
    }
  });

  console.log(`[api-server] Listening on http://127.0.0.1:${port}`);

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
