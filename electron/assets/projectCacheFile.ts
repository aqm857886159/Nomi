// 项目内部**缓存**文件（可重建、非用户创作物）：住 `.nomi/cache/<bucket>/`，与 `assets/` 严格分开。
//
// 为什么必须分开：`listProjectAssets` 递归扫的是 `assets/` 整棵树，凡落在那里的文件都会
// 出现在素材库。把中间产物（如时间轴胶片条）写成素材，用户素材库里就会混进一堆
// 26:1 的长条图，真素材被挤成细线——素材库看着像坏的/空的（2026-08-01 真机实测）。
// 惯例对齐 `.nomi/` 下既有的 memory.json / jobs / conversations.json（项目内部数据）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { projectDirById, sanitizeName } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { localAssetUrl } from "./assetPaths";

export type ProjectCacheBucket = "filmstrip" | "shot-cuts" | "audio-track";

export type ProjectCacheFile = { url: string; absolutePath: string };

/** 缓存文件在项目内的相对路径（同时是 nomi-local URL 的路径段，协议侧照常可读）。 */
export function projectCacheRelativePath(bucket: ProjectCacheBucket, fileName: string): string {
  return `.nomi/cache/${bucket}/${sanitizeName(fileName, "cache.bin")}`;
}

/**
 * 写一份项目缓存文件，返回可直接喂渲染层的 nomi-local URL。
 * 命名带随机段避免并发同名；调用方自己做「同源只抽一次」的记忆（见 extractVideoFrame 的缓存表）。
 */
export function writeProjectCacheFile(
  projectId: string,
  bytes: Buffer,
  bucket: ProjectCacheBucket,
  extension: string,
): ProjectCacheFile {
  const projectDir = projectDirById(String(projectId || "").trim());
  if (!projectDir) throw new Error("Project not found");
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const relativePath = projectCacheRelativePath(bucket, `${bucket}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  const absolutePath = path.join(projectDir, relativePath);
  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, bytes);
  return { url: localAssetUrl(projectId, relativePath), absolutePath };
}
