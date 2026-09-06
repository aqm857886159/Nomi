// 引导示例项目的预置成图 → 项目资产（走和真生成产物同一条落盘路）。
//
// 为什么要有这一层（2026-07-30 根因修复，见 docs/plan/2026-07-30-demo-asset-persisted-bundle-url.md）：
// 引导回放会把成图 URL 通过 addNodeResult **写进项目文件**。此前给的是**构建产物 URL**
// （`new URL('./assets/robot/kid.jpg', import.meta.url)`）——dev 下是 `http://127.0.0.1:5273/src/...`、
// 打包版是 `file://…/dist/assets/kid-<hash>.jpg`。两者都是易变值：换环境、重新构建（哈希变）、
// 换机器（路径变）之后统统失效，用户看到裂图 + CSP 报错。
// 构建产物 URL 不配写进用户数据。这里把随包的示例图写成该项目的真实资产，返回稳定的
// `nomi-local://asset/<projectId>/…`——CSP 已放行，且重建/升级/换机/导出都还成立。
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { listProjectAssets, writeAsset } from "../assets/projectAssetStore";
import type { JsonRecord } from "../jsonUtils";
import { logError } from "../logging/logger";

/** sidecar kind：既标记来源，也是幂等复用的查找键（重看引导不堆副本）。 */
export const DEMO_ASSET_KIND = "onboarding-demo";

/**
 * clientId → 随包图片文件名。clientId 必须与 `src/workbench/onboarding/demoProject.ts`
 * 里分镜方案的 anchors/shots 一致——`demoAssetSeed.test.ts` 锁住这条跨进程约定。
 * rooftop(场景锚)复用屋顶日落镜 shot-8，故 8 个镜头共 10 个 clientId、9 个文件。
 */
export const DEMO_ASSET_FILES: Record<string, string> = {
  kid: "kid.jpg",
  robot: "robot.jpg",
  rooftop: "shot-8.jpg",
  "shot-1": "shot-1.jpg",
  "shot-2": "shot-2.jpg",
  "shot-3": "shot-3.jpg",
  "shot-4": "shot-4.jpg",
  "shot-5": "shot-5.jpg",
  "shot-6": "shot-6.jpg",
  "shot-7": "shot-7.jpg",
  "shot-8": "shot-8.jpg",
};

/**
 * 随包示例图目录。放 `resources/` 而不是 `src/` 或 `public/`：
 * - `src/` 会被 Vite 加内容哈希，只有渲染进程算得出地址（就是本次事故的起点）；
 * - `public/` 会被 Vite 原样拷进 dist，同一批图进包两份（多 920K，白吃）。
 * `resources/**` 已在 package.json > build.files 里随包走，故 dev（仓库根）与打包版
 * （app.asar 根）是同一条相对路径——不必 dev/prod 分治。
 */
export function demoAssetSourceDir(): string {
  return path.join(app.getAppPath(), "resources", "onboarding-demo");
}

function assetUrlOf(dto: unknown): string {
  const data = (dto as { data?: JsonRecord } | null)?.data;
  const url = typeof data?.url === "string" ? data.url.trim() : "";
  return url;
}

/** 已 seed 过的示例资产：originalName → nomi-local URL（幂等复用的依据）。 */
function existingDemoAssets(projectId: string): Map<string, string> {
  const found = new Map<string, string>();
  const { items } = listProjectAssets({ projectId, kind: DEMO_ASSET_KIND, limit: 500 });
  for (const item of items) {
    const url = assetUrlOf(item);
    const name = String((item as { name?: unknown }).name || "").trim();
    if (url && name && !found.has(name)) found.set(name, url);
  }
  return found;
}

/**
 * 把示例图落成项目资产，返回 clientId → nomi-local URL。
 * 幂等：同一项目重复调用复用已落盘的那份（引导走 seedKey 复用同一个示例项目，可以被重看多次）。
 * 单张读盘/落盘失败不阻断整条引导——该 clientId 缺席，画布上那个节点保持空态（诚实，不裂图）。
 */
export function seedOnboardingDemoAssets(payload: unknown): Record<string, string> {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");

  const sourceDir = demoAssetSourceDir();
  const existing = existingDemoAssets(projectId);
  const byFileName = new Map<string, string>();
  const urls: Record<string, string> = {};

  for (const [clientId, fileName] of Object.entries(DEMO_ASSET_FILES)) {
    // 同一文件被多个 clientId 引用（rooftop / shot-8）——只写一次盘。
    const cached = byFileName.get(fileName) ?? existing.get(fileName);
    if (cached) {
      urls[clientId] = cached;
      byFileName.set(fileName, cached);
      continue;
    }
    try {
      const bytes = fs.readFileSync(path.join(sourceDir, fileName));
      const url = assetUrlOf(
        writeAsset(projectId, bytes, fileName, "image/jpeg", {
          kind: DEMO_ASSET_KIND,
          originalName: fileName,
        }),
      );
      if (!url) continue;
      urls[clientId] = url;
      byFileName.set(fileName, url);
    } catch (error) {
      logError("onboarding", "demo-asset-seed-failed", error, { asset: fileName });
    }
  }

  return urls;
}
