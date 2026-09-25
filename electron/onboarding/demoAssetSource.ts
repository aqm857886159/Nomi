// 随包引导示例图的字节来源——引导 seed 与「项目里旧的构建产物地址 → 项目资产」迁移共用这一处读盘。
//
// 目录由主进程开机时登记（electron/main.ts，= app.getAppPath()/resources/onboarding-demo）：这一层被工作区
// 清单事务引用，不能自己去 import electron 的 app。没登记（单测 / 纯 Node 进程）时读不到，调用方按「找不回」处理。
import fs from "node:fs";
import path from "node:path";

import { DEMO_ASSET_FILE_NAMES } from "../shared/onboardingDemoAssets";

let sourceDir: string | null = null;

export function registerOnboardingDemoAssetSourceDir(dir: string | null): void {
  sourceDir = dir;
}

/** 只认清单里的文件名（不接受任意路径拼进来）；读不到返回 null。 */
export function readOnboardingDemoAssetBytes(fileName: string): Buffer | null {
  if (!sourceDir || !DEMO_ASSET_FILE_NAMES.has(fileName)) return null;
  try {
    return fs.readFileSync(path.join(sourceDir, fileName));
  } catch {
    return null;
  }
}
