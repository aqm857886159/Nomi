// 项目盘剩余空间 —— 「这个文件收不收得下」的**事实来源**。
//
// 为什么存在（2026-09-14）：导入上限此前是五个散落的 hardcode 常量（30MB / 600MB / 200MB / 80MB / 64MB），
// 和用户磁盘上真实的余量毫无关系——600MB 的片子在一台还剩 2TB 的机器上被拒，
// 而 500MB 的片子在一台只剩 300MB 的机器上会被放行然后写到一半 ENOSPC。
// 上限该由磁盘说话（见 mediaImportPolicy.diskLimitBytes），这里负责去问磁盘。
import fs from "node:fs";

import { projectDirById } from "../projects/repository";
import type { StorageCapacity } from "../shared/contracts/mediaImportPolicy";

/** 量到的余量缓存这么久——磁盘余量变化远慢于一次导入批次，每个文件都 statfs 是白花 syscall。 */
const CAPACITY_TTL_MS = 5_000;

const cache = new Map<string, { at: number; capacity: StorageCapacity | null }>();

function statfsFreeBytes(dirPath: string): number | null {
  // statfs 在 Node 18.15+ 才有；拿不到就返回 null（= 容量未知 → 不设限，让落盘自己报 ENOSPC）。
  const statfsSync = (fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } }).statfsSync;
  if (typeof statfsSync !== "function") return null;
  try {
    const stats = statfsSync(dirPath);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

/** 项目所在盘还剩多少。项目不存在或量不到 → null（未知，不当拒绝理由）。 */
export function readStorageCapacity(projectId: string): StorageCapacity | null {
  const id = String(projectId || "").trim();
  if (!id) return null;
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CAPACITY_TTL_MS) return cached.capacity;
  let capacity: StorageCapacity | null = null;
  const projectDir = projectDirById(id);
  if (projectDir) {
    const freeBytes = statfsFreeBytes(projectDir);
    capacity = freeBytes === null ? null : { freeBytes };
  }
  cache.set(id, { at: Date.now(), capacity });
  return capacity;
}

/** 测试用：清掉缓存，免得上一条用例量到的余量泄进下一条。 */
export function clearStorageCapacityCache(): void {
  cache.clear();
}
