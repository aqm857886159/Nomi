// per-project AI 对话持久化(harness S1b-3,拍板 P-3:落盘+分隔线)。
// conversation 域独立文件 <projectDir>/.nomi/conversations.json——不混画布 payload
// (总方案 §5 三域裁定)。只存消息文本(id/role/content);draft/附件是 session 域不落盘。
// 配套分隔线(S1b-2):重启后旧气泡可见,但 LLM 记忆为空时 UI 必须如实声明。
import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import { writeJsonFileAtomic } from "../jsonFile";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";

type PersistedMessage = { id: string; role: string; content: string };
type PersistedConversations = {
  v: 1;
  creationMessages: PersistedMessage[];
  generationMessages: PersistedMessage[];
  /** S6-5 事务回执(审计 A6):整笔撤销入口随对话落盘,reload 后仍可撤销。形状由渲染层校验。 */
  committedProposal?: unknown;
};

const MAX_MESSAGES = 200;

function conversationsPath(projectId: string): string | null {
  const root = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());
  return root ? path.join(root, ".nomi", "conversations.json") : null;
}

/** 回执只做最小形状检(proposalId 必须是非空 string),完整校验在渲染层 parse。 */
function sanitizeCommittedProposal(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposalId = (value as Record<string, unknown>).proposalId;
  return typeof proposalId === "string" && proposalId ? value : null;
}

function sanitizeMessages(value: unknown): PersistedMessage[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedMessage[] = [];
  for (const item of value.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.role !== "string" || typeof rec.content !== "string") continue;
    out.push({ id: rec.id, role: rec.role, content: rec.content });
  }
  return out;
}

export function registerConversationsIpc(): void {
  ipcMain.handle("nomi:conversations:read", async (_event, payload: { projectId?: string }) => {
    try {
      const filePath = conversationsPath(String(payload?.projectId || ""));
      if (!filePath || !fs.existsSync(filePath)) return { ok: true, conversations: null };
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PersistedConversations>;
      return {
        ok: true,
        conversations: {
          v: 1 as const,
          creationMessages: sanitizeMessages(raw.creationMessages),
          generationMessages: sanitizeMessages(raw.generationMessages),
          committedProposal: sanitizeCommittedProposal(raw.committedProposal),
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    "nomi:conversations:write",
    async (
      _event,
      payload: { projectId?: string; creationMessages?: unknown; generationMessages?: unknown; committedProposal?: unknown },
    ) => {
      try {
        const filePath = conversationsPath(String(payload?.projectId || ""));
        if (!filePath) return { ok: false, error: "project not found" };
        const value: PersistedConversations = {
          v: 1,
          creationMessages: sanitizeMessages(payload?.creationMessages),
          generationMessages: sanitizeMessages(payload?.generationMessages),
          committedProposal: sanitizeCommittedProposal(payload?.committedProposal),
        };
        writeJsonFileAtomic(filePath, value);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
