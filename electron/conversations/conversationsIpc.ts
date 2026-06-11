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
};

const MAX_MESSAGES = 200;

function conversationsPath(projectId: string): string | null {
  const root = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());
  return root ? path.join(root, ".nomi", "conversations.json") : null;
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
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    "nomi:conversations:write",
    async (_event, payload: { projectId?: string; creationMessages?: unknown; generationMessages?: unknown }) => {
      try {
        const filePath = conversationsPath(String(payload?.projectId || ""));
        if (!filePath) return { ok: false, error: "project not found" };
        const value: PersistedConversations = {
          v: 1,
          creationMessages: sanitizeMessages(payload?.creationMessages),
          generationMessages: sanitizeMessages(payload?.generationMessages),
        };
        writeJsonFileAtomic(filePath, value);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
