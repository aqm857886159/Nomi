// 提示词库 IPC(仿 memory/memoryIpc.ts)。renderer 一次取全量(缓存),过滤/分页在渲染层做。
// public 库只读;user(我的库)用户级 CRUD(跨项目)。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { getPromptLibrary } from "./promptLibraryStore";
import { addUserPrompt, deleteUserPrompt, listUserPrompts, updateUserPrompt } from "./userPromptStore";

export function registerPromptLibraryIpc(): void {
  ipcMain.handle("nomi:prompt-library:list", async (event) => {
    // 守卫放在 try 外：不能被下面的 catch 洗成 { ok:false }，必须真的 reject。
    assertTrustedSender(event);
    try {
      const prompts = await getPromptLibrary();
      return { ok: true, prompts };
    } catch (error) {
      return { ok: false, prompts: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  // —— 我的库(用户级) ——
  ipcMain.handle("nomi:prompt-library:user-list", async (event) => {
    assertTrustedSender(event);
    try {
      return { ok: true, prompts: listUserPrompts() };
    } catch (error) {
      return { ok: false, prompts: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-add", async (event, input: { title?: string; prompt: string; promptType: "image" | "video"; tags?: string[]; referenceImages?: { url: string; title?: string; sourceUrl?: string }[] }) => {
    assertTrustedSender(event);
    try {
      addUserPrompt(input);
      return { ok: true, prompts: listUserPrompts() };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-update", async (event, payload: { id: string; patch: { title?: string; prompt?: string; promptType?: "image" | "video" } }) => {
    assertTrustedSender(event);
    try {
      return { ok: true, prompts: updateUserPrompt(payload.id, payload.patch) };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("nomi:prompt-library:user-delete", async (event, payload: { id: string }) => {
    assertTrustedSender(event);
    try {
      return { ok: true, prompts: deleteUserPrompt(payload.id) };
    } catch (error) {
      return { ok: false, prompts: listUserPrompts(), error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 节点提示词优化用的文本大脑(vendor/modelKey,不含 apiKey)——渲染层据此走现成文本流式管线。
  // status 三态（ok/locked/missing）让上手清单/恢复卡把「Key 读不出」和「没配」说清楚（2026-08-25 走查）。
  ipcMain.handle("nomi:prompt-library:text-brain", async (event) => {
    assertTrustedSender(event);
    const { resolveTextBrainStatus } = await import("../ai/agentChatV2");
    const resolved = resolveTextBrainStatus();
    return resolved.status === "ok"
      ? { ok: true, brain: resolved.brain, status: "ok" as const }
      : { ok: false, brain: null, status: resolved.status };
  });
}
