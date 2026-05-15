import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function getUserDataPath(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments);
}

export function ensureUserDataDirs(): void {
  const dirs = [
    getUserDataPath(),
    getUserDataPath('assets'),
    getUserDataPath('logs'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getOrCreateJwtSecret(): string {
  const secretPath = getUserDataPath('jwt-secret.txt');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf-8').trim();
  }
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

export function getOrCreateLocalUserId(): string {
  const idPath = getUserDataPath('local-user-id.txt');
  if (fs.existsSync(idPath)) {
    return fs.readFileSync(idPath, 'utf-8').trim();
  }
  const id = `local_${crypto.randomBytes(16).toString('hex')}`;
  fs.writeFileSync(idPath, id);
  return id;
}

export function getUserDataDir(): string {
  return app.getPath('userData');
}

export function getAssetsDir(): string {
  return getUserDataPath('assets');
}

export function getDbPath(): string {
  return getUserDataPath('nomi.db');
}
