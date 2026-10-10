// 脚本里「路径 ↔ URL ↔ 仓库内 / 分隔路径」的唯一入口（2026-10-10：6 道门岗只在 Windows 上红）。
//
// 类根因：Linux CI 上 `new URL(import.meta.url).pathname`、`path.relative()` 的结果、裸绝对路径交给 `import()`
// 恰好都对；Windows 上分别变成 `/D:/…`（受检文件被误报不存在）、`src\…`（拿去和含 `/` 的清单比永远不等）、
// `D:\…`（ESM 把盘符当协议，ERR_UNSUPPORTED_ESM_URL_SCHEME）。这三种写法都不该再手写：一律走本模块，
// `scripts/check-script-path-portability.mjs` 盯着 scripts/ 不再出现手写版本。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根（本文件在 scripts/lib/ 下）。 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 脚本自己的 import.meta.url → 它所在的目录（磁盘路径，不是 URL 的 pathname）。 */
export function dirOfMetaUrl(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl))
}

/** 把任意分隔符的相对路径统一成 `/`，拿去和清单 / 正则 / Set 比较。 */
export function toPosix(relative) {
  return String(relative).split(path.sep).join('/').replaceAll('\\', '/')
}

/** `path.relative(root, abs)` 的 `/` 分隔版本：门岗里一切「按仓库相对路径比较」都用它。 */
export function repoRelativePosix(abs, root = repoRoot) {
  return toPosix(path.relative(root, abs))
}

/** 本地文件 → `file:` URL 字符串，可交给 `import()` / `--import`。 */
export function toFileUrl(abs) {
  return pathToFileURL(abs).href
}

/** 动态 import 一个本地文件（绝对路径，或相对仓库根的路径）。 */
export function importLocal(fileOrRelative, root = repoRoot) {
  return import(toFileUrl(path.resolve(root, fileOrRelative)))
}
