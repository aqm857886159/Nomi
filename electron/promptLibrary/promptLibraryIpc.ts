// 提示词库 IPC(仿 memory/memoryIpc.ts)。renderer 一次取全量(缓存),过滤/分页在渲染层做。
import { ipcMain } from "electron";
import { getPromptLibrary } from "./promptLibraryStore";
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

  // 节点提示词优化用的文本大脑(vendor/modelKey,不含 apiKey)——渲染层据此走现成文本流式管线。
  ipcMain.handle("nomi:prompt-library:text-brain", async () => {
    const brain = resolveTextBrainKeys();
    return { ok: Boolean(brain), brain };
  });
}
