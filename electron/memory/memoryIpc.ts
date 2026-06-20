// 记忆卡 IPC(harness S9):get=增量提炼+读;update=pin/纠正;remove=删+墓碑;add=用户软偏好转正。
import { ipcMain } from "electron";
import { addUserMemoryFact, getProjectMemory, removeMemoryFact, updateMemoryFact, type MemoryFactKind } from "./projectMemory";

export function registerMemoryIpc(): void {
  ipcMain.handle("nomi:memory:get", async (_event, payload: { projectId?: string }) => {
    const projectId = String(payload?.projectId || "");
    if (!projectId) return { ok: false, facts: [] };
    const memory = getProjectMemory(projectId);
    return { ok: true, facts: memory.facts, lastDistilledSeq: memory.lastDistilledSeq };
  });

  ipcMain.handle(
    "nomi:memory:update",
    async (_event, payload: { projectId?: string; factId?: string; patch?: { text?: string; pinned?: boolean } }) => {
      const projectId = String(payload?.projectId || "");
      const factId = String(payload?.factId || "");
      if (!projectId || !factId) return { ok: false, facts: [] };
      const memory = updateMemoryFact(projectId, factId, payload?.patch || {});
      return { ok: true, facts: memory.facts };
    },
  );

  ipcMain.handle(
    "nomi:memory:add",
    async (_event, payload: { projectId?: string; text?: string; kind?: string }) => {
      const projectId = String(payload?.projectId || "");
      const text = String(payload?.text || "");
      if (!projectId || !text.trim()) return { ok: false, facts: [] };
      const memory = addUserMemoryFact(projectId, text, (payload?.kind as MemoryFactKind) || "preference");
      return { ok: true, facts: memory.facts };
    },
  );

  ipcMain.handle("nomi:memory:remove", async (_event, payload: { projectId?: string; factId?: string }) => {
    const projectId = String(payload?.projectId || "");
    const factId = String(payload?.factId || "");
    if (!projectId || !factId) return { ok: false, facts: [] };
    const memory = removeMemoryFact(projectId, factId);
    return { ok: true, facts: memory.facts };
  });
}
