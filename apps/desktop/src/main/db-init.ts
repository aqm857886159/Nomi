import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

function findPrismaCliPath(): string {
  // 在 packaged 应用中，prisma CLI 位于 extraResources 下
  // 在开发模式中，使用 node_modules/.bin/prisma
  const candidates = [
    path.join(process.resourcesPath || '', 'prisma-cli', 'node_modules', '.bin', 'prisma'),
    path.resolve(__dirname, '../../../../node_modules/.bin/prisma'),
    path.resolve(__dirname, '../../../hono-api/node_modules/.bin/prisma'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // fallback: hope prisma is in PATH
  return 'prisma';
}

function findDesktopSchemaPath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'prisma', 'schema.desktop.prisma'),
    path.resolve(__dirname, '../../../hono-api/prisma/schema.desktop.prisma'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'Cannot find schema.desktop.prisma. ' +
    'Searched: ' + candidates.join(', ')
  );
}

export async function initDatabase(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || process.env.PRISMA_DB_PROVIDER !== 'libsql') {
    // 非 libsql 模式（e.g. PostgreSQL），跳过
    return;
  }

  // 提取 SQLite 文件路径（去掉 "file:" 前缀）
  const dbFilePath = dbUrl.replace(/^file:/, '');

  // 如果数据库文件已存在，只做轻量迁移（push 幂等，安全）
  const isFirstRun = !fs.existsSync(dbFilePath);
  if (isFirstRun) {
    console.log('[db-init] First run detected, creating SQLite database...');
  } else {
    console.log('[db-init] Existing database found, checking for schema updates...');
  }

  const prismaPath = findPrismaCliPath();
  const schemaPath = findDesktopSchemaPath();

  try {
    execFileSync(
      process.execPath, // 使用 Electron 内置的 Node.js 执行器
      [prismaPath, 'db', 'push', '--schema', schemaPath, '--accept-data-loss', '--skip-generate'],
      {
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      }
    );
    console.log('[db-init] Schema applied successfully');
  } catch (err: unknown) {
    const stderr = err instanceof Error && 'stderr' in err
      ? String((err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr || '')
      : '';
    console.error('[db-init] prisma db push failed:', stderr || err);

    if (isFirstRun) {
      // 首次运行失败，尝试用 node 直接执行 prisma
      try {
        execFileSync(
          'node',
          [prismaPath, 'db', 'push', '--schema', schemaPath, '--accept-data-loss', '--skip-generate'],
          {
            env: { ...process.env, DATABASE_URL: dbUrl },
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60_000,
          }
        );
        console.log('[db-init] Schema applied via node fallback');
      } catch (fallbackErr: unknown) {
        throw new Error(
          `Failed to initialize SQLite database. ` +
          `Error: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`
        );
      }
    }
    // 非首次运行时，push 失败不是致命的（可能是 schema 已是最新）
  }
}
