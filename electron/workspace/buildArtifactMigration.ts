// 项目记录里的构建产物地址 → 项目资产（2026-09-25）。挂在工作区清单事务的「内嵌媒体落盘」同一遍遍历上：
// 每次写清单、每次加锁读清单都会经过这里，所以渲染层保存、MCP / Agent 写入、新建、恢复、读时迁移都走同一处。
//
//   · 引导示例图（v0.16.7–v0.18.0 写进「示例：修好一个小机器人」的 app.asar / dev server 地址）→ 用随包原图在
//     该项目里落一份资产（sidecar kind = onboarding-demo，与引导 seed 同形，重看引导会复用它），换成 nomi-local 地址。
//   · 认不出的构建产物地址：字节找不回来。**新写入**直接拒绝（fail-closed：只有代码 bug 会产出它）；
//     记录里原来就有的不动、记一条日志——不能因为一个坏地址让整个项目打不开或存不了。
import path from "node:path";

import { localAssetUrl } from "../assets/assetPaths";
import { logWarn } from "../logging/logger";
import { readOnboardingDemoAssetBytes } from "../onboarding/demoAssetSource";
import { rewriteBuildArtifactUrls, type BuildArtifactUrl } from "../shared/buildArtifactUrl";
import { DEMO_ASSET_KIND } from "../shared/onboardingDemoAssets";
import type { WorkspaceManifestTransaction } from "./workspaceManifestTransaction";
import { workspaceAssetsGeneratedDir } from "./workspacePaths";

export class BuildArtifactUrlPersistError extends Error {
  constructor(readonly url: string) {
    super(`Project data must not reference a build artifact URL: ${url}`);
    this.name = "BuildArtifactUrlPersistError";
  }
}

export type BuildArtifactPolicy =
  /** 读路径：迁移能迁的，其余原样留下。 */
  | { rejectNew: false }
  /** 写路径：迁移能迁的；`tolerated`（写入前记录里已有的）之外的一律拒绝。 */
  | { rejectNew: true; tolerated: ReadonlySet<string> };

type Transaction = Pick<WorkspaceManifestTransaction, "exists" | "readJson" | "writeFile">;

/** 记录里现有的构建产物地址（写路径据此只拒「新带进来的」）。 */
export function collectBuildArtifactUrls(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    rewriteBuildArtifactUrls(value, (url) => {
      into.add(url);
      return url;
    });
  } else if (Array.isArray(value)) {
    for (const item of value) collectBuildArtifactUrls(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectBuildArtifactUrls(item, into);
  }
  return into;
}

function demoAssetPath(rootPath: string, fileName: string, transaction: Transaction): { absolutePath: string; reused: boolean } {
  const dir = workspaceAssetsGeneratedDir(rootPath);
  const parsed = path.parse(fileName);
  for (let index = 1; ; index += 1) {
    const absolutePath = path.join(dir, index === 1 ? fileName : `${parsed.name}-${index}${parsed.ext}`);
    if (!transaction.exists(absolutePath)) return { absolutePath, reused: false };
    const meta = transaction.readJson(`${absolutePath}.meta`) as { kind?: unknown; originalName?: unknown } | null;
    if (meta?.kind === DEMO_ASSET_KIND && meta.originalName === fileName) return { absolutePath, reused: true };
  }
}

/** 一次遍历用一个：同一张示例图在一条记录里出现多次只落一份。 */
export function createBuildArtifactRewriter(args: {
  rootPath: string;
  projectId: string;
  transaction: Transaction;
  policy: BuildArtifactPolicy;
}): (value: string) => string {
  const { rootPath, projectId, transaction, policy } = args;
  const seeded = new Map<string, string>();
  const warned = new Set<string>();

  const seedDemo = (fileName: string): string | null => {
    const cached = seeded.get(fileName);
    if (cached) return cached;
    const target = demoAssetPath(rootPath, fileName, transaction);
    if (!target.reused) {
      const bytes = readOnboardingDemoAssetBytes(fileName);
      if (!bytes) return null;
      transaction.writeFile(target.absolutePath, bytes);
      transaction.writeFile(`${target.absolutePath}.meta`, Buffer.from(JSON.stringify({ kind: DEMO_ASSET_KIND, originalName: fileName })));
    }
    const url = localAssetUrl(projectId, path.relative(rootPath, target.absolutePath).replace(/\\/g, "/"));
    seeded.set(fileName, url);
    return url;
  };

  const replace = (url: string, artifact: BuildArtifactUrl): string => {
    if (artifact.kind === "onboarding-demo") {
      const local = seedDemo(artifact.fileName);
      if (local) return local;
    }
    if (policy.rejectNew && !policy.tolerated.has(url)) throw new BuildArtifactUrlPersistError(url);
    if (!warned.has(url)) {
      warned.add(url);
      logWarn("workspace", "build-artifact-url-kept", { projectId, url });
    }
    return url;
  };

  return (value) => rewriteBuildArtifactUrls(value, replace);
}
