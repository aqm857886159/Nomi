// 随包引导示例图的字节来源——引导 seed 与「项目里旧的构建产物地址 → 项目资产」迁移共用这一处读盘。
//
// 目录由主进程在 registerAssetsIpc 里登记（= app.getAppPath()/resources/onboarding-demo）：这一层被工作区
// 清单事务引用，不能自己去 import electron 的 app。登记的是**解析函数**，用到时才取路径——注册本身不碰 app，
// 否则 registerAssetsIpc 会平白多出「注册那一刻就要有 Electron app」的依赖。没登记（单测 / 纯 Node 进程）时
// 读不到，调用方按「找不回」处理。
import fs from "node:fs";
import path from "node:path";

import { DEMO_ASSET_FILE_NAMES } from "../shared/onboardingDemoAssets";

let resolveSourceDir: (() => string) | null = null;

export function registerOnboardingDemoAssetSourceDir(resolve: (() => string) | null): void {
  resolveSourceDir = resolve;
}

/** 只认清单里的文件名（不接受任意路径拼进来）；读不到返回 null。 */
export function readOnboardingDemoAssetBytes(fileName: string): Buffer | null {
  if (!resolveSourceDir || !DEMO_ASSET_FILE_NAMES.has(fileName)) return null;
  try {
    return fs.readFileSync(path.join(resolveSourceDir(), fileName));
  } catch {
    return null;
  }
}
