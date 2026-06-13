import fs from "node:fs";
import path from "node:path";
import type { CoreMessage } from "ai";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { getSettingsRoot, getWorkspaceRepositoryDeps } from "../runtimePaths";

/**
 * 战线 A / 选项②（用户拍板 2026-06-13）：把「喂给模型的对话工作缓存」落盘，重启读回，
 * 实现逐字续聊。
 *
 * 定位（守 P1）：这落盘的 `CoreMessage[]` 是**模型工作缓冲的快照**，不是 EventLog 之外的
 * 第二份对话真相源——它允许有损、允许与日志不同（日志本就只存 head）。EventLog 仍是
 * 审计/记忆提炼的语义真相，气泡 store 仍是 UI 展示缓存；本文件是第三种东西：跨重启续命
 * 的「进程内 Map 快照」。内容来自 agentChatV2 写回 Map 的 `capped`（已过 capAgentHistory，
 * provider-safe，且 user 消息只存 displayPrompt 文本、不含图片字节，故 JSON 可安全往返）。
 */

const SESSION_FILE_VERSION = 1;

type PersistedAgentSession = {
  version: number;
  sessionKey: string;
  messages: CoreMessage[];
};

/** sessionKey 形如 `nomi:workbench:<projectId>`（per-project 一份工作缓存，见 workbenchSessionKey）。 */
function projectIdFromSessionKey(sessionKey: string): string | null {
  const match = /^nomi:workbench:(.+)$/.exec(String(sessionKey || "").trim());
  return match ? match[1] : null;
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

/** 读回某会话的工作缓存；无/损坏/key 不匹配 → null（损坏即弃，对话从空开始，不崩）。 */
export function loadAgentSession(sessionKey: string): CoreMessage[] | null {
  const file = sessionFilePath(sessionKey);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PersistedAgentSession>;
    if (!raw || raw.sessionKey !== sessionKey || !Array.isArray(raw.messages)) return null;
    return raw.messages as CoreMessage[];
  } catch {
    return null;
  }
}

/** 原子写回（tmp + rename 防撕裂）。工作缓存落盘失败不阻断对话（静默吞）。 */
export function saveAgentSession(sessionKey: string, messages: readonly CoreMessage[]): void {
  const file = sessionFilePath(sessionKey);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload: PersistedAgentSession = {
      version: SESSION_FILE_VERSION,
      sessionKey,
      messages: messages as CoreMessage[],
    };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // 工作缓存,丢了下次重新攒,不打断当前对话
  }
}

/** 「新对话」/清会话时删掉持久工作缓存。 */
export function clearAgentSession(sessionKey: string): void {
  const file = sessionFilePath(sessionKey);
  if (!file) return;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

/** 磁盘上是否有该会话的工作缓存（S1b 诚实探针在内存 Map 冷启动时据此判断「能否续聊」）。 */
export function hasPersistedAgentSession(sessionKey: string): boolean {
  const file = sessionFilePath(sessionKey);
  return Boolean(file && fs.existsSync(file));
}
