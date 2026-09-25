// 模型目录**那一个文件**怎么安全地读、怎么在迁移前留底、以及「它现在为什么只能读不能改」
// ——这三件事住这里；catalogStore 只管事务与业务写入（R9 分层：巨壳只减不增）。
//
// 为什么单独成层：2026-09-21 的事故里，「目录读不出来怎么办」这个判断散在三个读点上
// （readCatalog / ensureBuiltinModelSeeds / onDiskCatalogVersion 各自 readJson 吞异常），
// 谁都不知道另外两个看到了什么。收成一处之后，目录的读法只有一份答案，写门只需要问它一句。
import fs from "node:fs";
import path from "node:path";

import { isJsonRecord } from "../jsonUtils";
import {
  configQuarantineNotice,
  configReadFailure,
  readConfigFile,
  snapshotConfigVersion,
  type ConfigFileReadResult,
} from "../configFileStore";
import { CATALOG_FILE, getSettingsRoot } from "../runtimePaths";
import { CURRENT_CATALOG_VERSION, type CatalogState } from "./types";

export function catalogPath(): string {
  return path.join(getSettingsRoot(), CATALOG_FILE);
}

/**
 * 目录为什么读不了 / 为什么改不了的结构化答案。界面拿它出横幅（「你的配置没丢，是……」），
 * 不再靠渲染层从一个空列表里猜（根因：`rootcause-config-loss-on-reinstall.md` §0）。
 */
export type ModelCatalogReadOnlyStatus =
  | { reason: "newer_on_disk"; diskVersion: number; appVersion: number }
  | { reason: "unreadable_file"; detail: string; quarantinedPath: string | null };

/**
 * 目录文件的唯一读口：区分「不存在」「读不了」「读到了」。
 *
 * 旧写法是 `readJson(catalogPath(), null)`——文件缺失、JSON 解析失败、Windows 上被杀软/索引器
 * 锁住的 EPERM，全都吞成同一个 null，调用方于是把空目录原子写回覆盖用户文件。
 */
export function readCatalogFile(): ConfigFileReadResult<CatalogState> {
  return readConfigFile<CatalogState>(catalogPath(), isJsonRecord);
}

/** 盘上目录文件的原始字节（读缓存的键）；读不到返回 null，交给 readCatalogFile 走正规的缺失/失败路径。 */
export function readCatalogFileBytes(): string | null {
  try {
    return fs.readFileSync(catalogPath(), "utf8");
  } catch {
    return null;
  }
}

/** 盘上那份比本应用新（装过新版又装回旧版）。读得出来、但一个字都不许改。 */
export function catalogIsNewerOnDisk(outcome: ConfigFileReadResult<CatalogState>): number | null {
  if (outcome.status !== "ok") return null;
  const version = outcome.value?.version;
  return typeof version === "number" && version > CURRENT_CATALOG_VERSION ? version : null;
}

export function modelCatalogReadOnlyStatus(): ModelCatalogReadOnlyStatus | null {
  const failure = configReadFailure(catalogPath()) ?? configQuarantineNotice(catalogPath());
  if (failure) {
    return { reason: "unreadable_file", detail: failure.message, quarantinedPath: failure.quarantinedPath };
  }
  const outcome = readCatalogFile();
  if (outcome.status === "failed") {
    const recorded = configReadFailure(catalogPath());
    return { reason: "unreadable_file", detail: outcome.message, quarantinedPath: recorded?.quarantinedPath ?? null };
  }
  const diskVersion = catalogIsNewerOnDisk(outcome);
  if (diskVersion != null) {
    return { reason: "newer_on_disk", diskVersion, appVersion: CURRENT_CATALOG_VERSION };
  }
  return null;
}

/**
 * 跨版本迁移前留一份带版本号的底（`model-catalog.v<旧版本>.bak.json`，保留最近几份）。
 *
 * 这是「装了新版、又装回旧版」唯一的解药：新版把文件升到 v13 之后旧版读不懂它，但旧版能认领
 * v9 那一份。日常写轮转出来的 `.bak` 救不了这个场景——它会被升级之后的每一次写覆盖掉。
 * 幂等（同版本留过就跳过），所以它挂在每次读上也只在真要迁移的那一次做一次拷贝。
 */
export function snapshotBeforeMigration(parsed: CatalogState): CatalogState {
  const version = typeof parsed.version === "number" ? parsed.version : null;
  if (version != null && version >= 1 && version < CURRENT_CATALOG_VERSION) {
    snapshotConfigVersion(catalogPath(), version);
  }
  return parsed;
}
