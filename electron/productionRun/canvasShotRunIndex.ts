import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 画布单镜 Run 的身份与「还没收尾的」轻量索引（发动机收敛第一刀，岔路 F1：每点一次 ↑ 建一个单镜 Run）。
 *
 * 为什么要索引：每点一次 ↑ 就多一个 Run 目录（实测约 97 KB），打开项目时把它们逐个读一遍是 9 ms / 个、
 * 500 个就是 4 秒多的主进程同步读盘。所以：
 *   · 画布 Run 的目录名一律以 `canvas-` 开头，`productionRunRepository.list` 不列它们（任务中心制作那一栏、
 *     打开项目的补齐、恢复调度都只看 `list`，画布 Run 由画布队列那一行显示，F5）；
 *   · 还没收尾的画布 Run 在 `.nomi/canvas-runs/open/` 下各有一个标记文件（文件名 = 节点指纹~Run 号）。
 *     打开项目只读这几个；同节点在途只按文件名筛，不打开文件。
 *
 * 标记只是 Run 的派生缓存，不是第二个真相源：读到的 Run 已经收尾就顺手删掉标记（自愈），标记在、Run 不在也删。
 * 标记写在建 Run **之前**，所以崩溃只会多出一个空标记，不会漏掉一个在途的 Run。
 */

export const CANVAS_RUN_PREFIX = "canvas-";

const RUN_ID = /^[A-Za-z0-9._-]{1,160}$/;

export function isCanvasRunId(runId: string): boolean {
  return runId.startsWith(CANVAS_RUN_PREFIX);
}

/** 渲染层这一次运行记录号 → 它的单镜 Run 号（同一个号重试 = 同一个 Run，幂等）。 */
export function canvasRunIdFor(runRecordId: string): string {
  const runId = `${CANVAS_RUN_PREFIX}${String(runRecordId || "").trim()}`;
  if (!RUN_ID.test(runId) || runRecordId.trim() === "") throw new Error("Invalid canvas run record id");
  return runId;
}

function openDir(projectDir: string): string {
  return path.join(projectDir, ".nomi", "canvas-runs", "open");
}

export type OpenCanvasRun = { runId: string };

/** 标记文件名前缀 = 节点号的指纹：按节点筛不用打开任何文件（节点号可能互为前缀，所以不用节点号本身）。 */
function nodeKey(nodeId: string): string {
  return crypto.createHash("sha1").update(nodeId).digest("hex").slice(0, 16);
}

const SEPARATOR = "~";

export function markCanvasRunOpen(projectDir: string, runId: string, nodeId: string): void {
  const dir = openDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${nodeKey(nodeId)}${SEPARATOR}${canvasRunIdGuard(runId)}.json`), `${JSON.stringify({ nodeId })}
`, "utf8");
}

export function markCanvasRunSettled(projectDir: string, runId: string): void {
  const suffix = `${SEPARATOR}${canvasRunIdGuard(runId)}.json`;
  try {
    const dir = openDir(projectDir);
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (name.endsWith(suffix)) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // 删不掉的标记下次读到 Run 已收尾时再删（自愈），不影响这一次。
  }
}

/** 还挂着「没收尾」标记的画布 Run（可选只要某个节点的）。只列目录，不打开文件。 */
export function openCanvasRuns(projectDir: string, nodeId?: string): OpenCanvasRun[] {
  const dir = openDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const prefix = nodeId === undefined ? "" : `${nodeKey(nodeId)}${SEPARATOR}`;
  const runs: OpenCanvasRun[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || !name.startsWith(prefix)) continue;
    const separator = name.indexOf(SEPARATOR);
    const runId = separator < 0 ? "" : name.slice(separator + 1, -".json".length);
    if (RUN_ID.test(runId) && isCanvasRunId(runId)) runs.push({ runId });
  }
  return runs;
}

function canvasRunIdGuard(runId: string): string {
  if (!RUN_ID.test(runId) || !isCanvasRunId(runId)) throw new Error("Invalid canvas run id");
  return runId;
}
