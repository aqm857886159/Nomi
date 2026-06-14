import fs from "node:fs";
import path from "node:path";
import type { CoreMessage } from "ai";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { getSettingsRoot, getWorkspaceRepositoryDeps } from "../runtimePaths";

/**
 * 战线 A / 选项②（用户拍板 2026-06-13）：把「喂给模型的对话工作缓存」落盘，重启读回，实现逐字续聊。
 *
 * 2026-06-14 会话历史：sessionKey 升为 per-area（`nomi:workbench:<projectId>:<area>`），
 * 创作/画布各一份模型记忆；同一项目两个 area 落同一文件，故本文件存 **map<sessionKey, CoreMessage[]>**
 * （不再单会话一文件，否则两 area 互相覆盖）。
 *
 * 定位（守 P1）：落盘的 `CoreMessage[]` 是**模型工作缓冲快照**,不是 EventLog 之外的第二份对话真相源——
 * 允许有损、允许与日志不同。内容来自 agentChatV2 写回的 `capped`（provider-safe，user 只存文本不含图片字节）。
 */

const SESSION_FILE_VERSION = 2;

type PersistedAgentSessions = {
  version: number;
  sessions: Record<string, CoreMessage[]>;
};

/** sessionKey 形如 `nomi:workbench:<projectId>:<area>`（per-area）；兼容老的无 area 后缀。 */
function projectIdFromSessionKey(sessionKey: string): string | null {
  const key = String(sessionKey || "").trim();
  const withArea = /^nomi:workbench:(.+):(?:creation|generation)$/.exec(key);
  if (withArea) return withArea[1];
  const legacy = /^nomi:workbench:(.+)$/.exec(key);
  return legacy ? legacy[1] : null;
}

// 默认按 projectId 解析项目目录；`local` 桶（未开项目）落 settings root，互不污染。
let dirResolver: (projectId: string) => string | null = (projectId) =>
  projectId === "local"
    ? getSettingsRoot()
    : resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

export function setAgentSessionDirResolverForTests(resolver: (projectId: string) => string | null): void {
  dirResolver = resolver;
}

function sessionFilePath(sessionKey: string): string | null {
  const projectId = projectIdFromSessionKey(sessionKey);
  if (!projectId) return null;
  const root = dirResolver(projectId);
  if (!root) return null;
  return path.join(root, ".nomi", "agent-session.json");
}

/** 读整文件的 sessions map（损坏/缺失 → 空 map）。 */
function readSessions(file: string): Record<string, CoreMessage[]> {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PersistedAgentSessions>;
    if (raw && raw.sessions && typeof raw.sessions === "object") return raw.sessions as Record<string, CoreMessage[]>;
    return {};
  } catch {
    return {};
  }
}

function writeSessions(file: string, sessions: Record<string, CoreMessage[]>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload: PersistedAgentSessions = { version: SESSION_FILE_VERSION, sessions };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // 工作缓存,丢了下次重新攒,不打断当前对话
  }
}

/** 读回某会话的工作缓存；无/损坏 → null（损坏即弃,对话从空开始,不崩）。 */
export function loadAgentSession(sessionKey: string): CoreMessage[] | null {
  const file = sessionFilePath(sessionKey);
  if (!file) return null;
  const messages = readSessions(file)[sessionKey];
  return Array.isArray(messages) && messages.length ? (messages as CoreMessage[]) : null;
}

/** 原子写回（tmp + rename 防撕裂）。工作缓存落盘失败不阻断对话（静默吞）。 */
export function saveAgentSession(sessionKey: string, messages: readonly CoreMessage[]): void {
  const file = sessionFilePath(sessionKey);
  if (!file) return;
  const sessions = readSessions(file);
  sessions[sessionKey] = messages as CoreMessage[];
  writeSessions(file, sessions);
}

/** 「新对话」/清会话时删掉该 sessionKey 的持久工作缓存（其它 area 的不动）。 */
export function clearAgentSession(sessionKey: string): void {
  const file = sessionFilePath(sessionKey);
  if (!file || !fs.existsSync(file)) return;
  const sessions = readSessions(file);
  if (!(sessionKey in sessions)) return;
  delete sessions[sessionKey];
  writeSessions(file, sessions);
}

/** 磁盘上是否有该会话的非空工作缓存（S1b 诚实探针冷启动判「能否续聊」）。 */
export function hasPersistedAgentSession(sessionKey: string): boolean {
  const file = sessionFilePath(sessionKey);
  if (!file) return false;
  const messages = readSessions(file)[sessionKey];
  return Array.isArray(messages) && messages.length > 0;
}
