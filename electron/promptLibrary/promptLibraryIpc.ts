// 提示词库 IPC(仿 memory/memoryIpc.ts)。renderer 一次取全量(缓存),过滤/分页在渲染层做。
// public 库只读;user(我的库)用户级 CRUD(跨项目)。
import { ipcMain } from "electron";
import { getPromptLibrary } from "./promptLibraryStore";
import { addUserPrompt, deleteUserPrompt, listUserPrompts, updateUserPrompt } from "./userPromptStore";
import { resolveTextBrainKeys } from "../ai/agentChatV2";

export function registerPromptLibraryIpc(): void {
  ipcMain.handle("nomi:prompt-library:list", async () => {
    try {
      const prompts = await getPromptLibrary();
      return { ok: true, prompts };
    } catch (error) {
      return { ok: false, prompts: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  // —— 我的库(用户级) ——
  ipcMain.handle("nomi:prompt-library:user-list", async () => {
    try {
      return { ok: true, prompts: listUserPrompts() };
    } catch (error) {
      return { ok: false, prompts: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-add", async (_e, input: { title?: string; prompt: string; promptType: "image" | "video" }) => {
    try {
      addUserPrompt(input);
      return { ok: true, prompts: listUserPrompts() };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-update", async (_e, payload: { id: string; patch: { title?: string; prompt?: string; promptType?: "image" | "video" } }) => {
    try {
      return { ok: true, prompts: updateUserPrompt(payload.id, payload.patch) };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-delete", async (_e, payload: { id: string }) => {
    try {
      return { ok: true, prompts: deleteUserPrompt(payload.id) };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 节点提示词优化用的文本大脑(vendor/modelKey,不含 apiKey)——渲染层据此走现成文本流式管线。
  ipcMain.handle("nomi:prompt-library:text-brain", async () => {
    const brain = resolveTextBrainKeys();
    return { ok: Boolean(brain), brain };
  });
}
