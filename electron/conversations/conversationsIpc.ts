// per-project AI 对话持久化 IPC(harness S1b-3 起;2026-06-14 升 v2 会话历史)。
// conversation 域独立文件 <projectDir>/.nomi/conversations.json——不混画布 payload。
// 纯数据层(净化/v1→v2 迁移)在 conversationsStore.ts;本文件只管 fs/ipc。
import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import { writeJsonFileAtomic } from "../jsonFile";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import {
  normalizeToV2,
  sanitizeArea,
  sanitizeCommittedProposal,
  type PersistedConversations,
} from "./conversationsStore";

function conversationsPath(projectId: string): string | null {
  const root = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());
  return root ? path.join(root, ".nomi", "conversations.json") : null;
}

export function registerConversationsIpc(): void {
  ipcMain.handle("nomi:conversations:read", async (_event, payload: { projectId?: string }) => {
    try {
      const filePath = conversationsPath(String(payload?.projectId || ""));
      if (!filePath || !fs.existsSync(filePath)) return { ok: true, conversations: null };
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      return { ok: true, conversations: normalizeToV2(raw, Date.now()) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    "nomi:conversations:write",
    async (
      _event,
      payload: { projectId?: string; creation?: unknown; generation?: unknown; committedProposal?: unknown },
    ) => {
      try {
        const filePath = conversationsPath(String(payload?.projectId || ""));
        if (!filePath) return { ok: false, error: "project not found" };
        const value: PersistedConversations = {
          v: 2,
          creation: sanitizeArea(payload?.creation),
          generation: sanitizeArea(payload?.generation),
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
