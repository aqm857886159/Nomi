import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fsyncIfDurable, isDurable } from "../durability";
import { renameSyncWithRetry } from "../jsonFile";

const MAX_FILE_BYTES = 1_048_576;

export class CertificationPersistenceError extends Error {
  constructor(
    readonly reason: "corrupt" | "unsupported_version" | "oversized" | "invalid_state" | "lock_timeout",
    message: string,
  ) {
    super(message);
    this.name = "CertificationPersistenceError";
  }
}

export function writeCertificationJsonAtomic(filePath: string, state: unknown): void {
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new CertificationPersistenceError("oversized", "Certification persistence exceeds size limit");
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  let renamed = false;
  try {
    const fd = fs.openSync(tempPath, "wx", 0o600);
    try { fs.writeFileSync(fd, serialized, "utf8"); fsyncIfDurable(fd); } finally { fs.closeSync(fd); }
    renameSyncWithRetry(tempPath, filePath);
    renamed = true;
    fs.chmodSync(filePath, 0o600);
    if (isDurable()) {
      try {
        const dirFd = fs.openSync(dir, "r");
        try { fsyncIfDurable(dirFd); } finally { fs.closeSync(dirFd); }
      } catch (error) {
        if (process.platform !== "win32") throw error;
      }
    }
  } finally {
    if (!renamed) try { fs.rmSync(tempPath, { force: true }); } catch { /* preserve original failure */ }
  }
}
