// 两把锁共用的运行时：冻结名单（还没迁的文件）、记录模式、「名单多了或少了都红」按文件判。
//   - 不在名单的文件命中 → 当场抛，报错第一行是错误码，第二行点名入口。
//   - 在名单的文件命中 → 只记，照常跑；跑完一次都没命中 → 该文件红（名单里的条目已经过期，要删）。
//   - 记录模式：NOMI_WORLD_LOCK_RECORD=<文件> 时只记不拦、不核名单，由 tests/world/freeze-list.mjs 生成名单。
import fs from "node:fs";
import path from "node:path";
import { afterAll, expect } from "vitest";
import { REPO_ROOT, repoRelative } from "./ownerModules";

export type LockName = "fsLock" | "exportLock";

export function readFrozenList(lock: LockName): string[] {
  const file = path.join(REPO_ROOT, "tests/world/not-yet-migrated", `${lock}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { files: string[] };
  return parsed.files;
}

export function installLockRuntime(lock: LockName) {
  const recordFile = process.env.NOMI_WORLD_LOCK_RECORD || "";
  const listed = new Set(readFrozenList(lock));
  let hits = 0;
  const currentTestRel = (fallback?: string): string => {
    const raw = (expect.getState().testPath as string | undefined) ?? fallback ?? "";
    return repoRelative(raw) ?? raw;
  };

  afterAll(() => {
    if (recordFile) return;
    const rel = currentTestRel();
    if (listed.has(rel) && hits === 0) {
      throw new Error(
        `frozen_list_stale: ${rel} 已经不再命中 ${lock}。\n` +
          `从 tests/world/not-yet-migrated/${lock}.json 的 files 里删掉这一行（名单只许减）。`,
      );
    }
  });

  return {
    /** 命中一次：返回时表示放行（记录模式或在名单里），否则抛。 */
    violation(info: { testFallback?: string; detail: Record<string, unknown>; message: string }): void {
      const rel = currentTestRel(info.testFallback);
      if (recordFile) {
        fs.appendFileSync(recordFile, `${JSON.stringify({ lock, file: rel, ...info.detail })}\n`);
        return;
      }
      if (listed.has(rel)) {
        hits += 1;
        return;
      }
      throw new Error(info.message);
    },
  };
}
