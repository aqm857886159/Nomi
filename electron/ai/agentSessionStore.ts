import fs from "node:fs";
import path from "node:path";
import type { CoreMessage } from "ai";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { writeJsonFileAtomic } from "../jsonFile";
import { getSettingsRoot, getWorkspaceRepositoryDeps } from "../runtimePaths";
import { projectIdFromSessionKey } from "../events/eventLogRepository";

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

// area 后缀剥离收口到 eventLogRepository 的单一导出(P1 不留第二份正则)。
// 差异: 本存储要持久化 local 桶(落 settings root),而 EventLog 把 local 视作 null(不落盘)——
// 故 local 策略留在本消费者,area 剥离逻辑(易错的那部分)复用 canonical。
function projectIdForSession(sessionKey: string): string | null {
  const key = String(sessionKey || "").trim();
  if (/^nomi:workbench:local(?::(?:creation|generation))?$/.test(key)) return "local";
  return projectIdFromSessionKey(key);
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
  const projectId = projectIdForSession(sessionKey);
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
    // 收口到共享原子原语（唯一 temp 名 + fsync）：同项目两 area 并发 save 不再抢同一个 `.tmp`
    // 互相截断（旧实现固定 `${file}.tmp`），且 fsync 后崩溃/掉电不会留空文件（P1 不留更弱的第二份写法）。
    const payload: PersistedAgentSessions = { version: SESSION_FILE_VERSION, sessions };
    writeJsonFileAtomic(file, payload);
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
