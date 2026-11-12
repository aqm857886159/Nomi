import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 存盘 / 读盘时被隔离的那一项的原样内容，落在项目自己的 `.nomi/quarantine/` 下。
 * 文件名 = 内容哈希：同一项反复触发只写一次（幂等，不堆文件）。只存一项原文，不存整份项目。
 * 写失败不影响保存——隔离区是「留一份原样、方便找回」，不是保存的一部分。
 */
const MAX_ITEMS_PER_CALL = 20;
const MAX_BYTES_PER_ITEM = 2 * 1024 * 1024;

export type QuarantineItemInput = { container: string; field: string; raw: unknown };

export function writeQuarantineItems(projectDir: string, items: unknown): { written: number } {
  if (!Array.isArray(items) || !projectDir) return { written: 0 };
  const dir = path.join(projectDir, ".nomi", "quarantine");
  let written = 0;
  for (const item of items.slice(0, MAX_ITEMS_PER_CALL)) {
    if (!item || typeof item !== "object") continue;
    const { container, field, raw } = item as QuarantineItemInput;
    if (typeof container !== "string" || typeof field !== "string") continue;
    let body: string | undefined;
    try {
      body = JSON.stringify({ container, field, raw }, null, 2);
    } catch {
      continue;
    }
    if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BYTES_PER_ITEM) continue;
    const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
    const file = path.join(dir, `${container.replace(/[^a-zA-Z]/g, "")}-${hash}.json`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, body, { flag: "wx" });
      written += 1;
    } catch {
      // EEXIST = 同一项已留过；其余写不进也不影响保存。
    }
  }
  return { written };
}
