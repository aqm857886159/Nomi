import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import {
  readSystemPromptOverrides,
  writeSystemPromptOverrides,
  type SystemPromptOverrides,
} from "./systemPromptsSettings";

export type SystemPromptOverridesStore = {
  read: () => SystemPromptOverrides;
  write: (value: unknown) => SystemPromptOverrides;
};

export function registerSystemPromptsIpc(
  store: SystemPromptOverridesStore = {
    read: readSystemPromptOverrides,
    write: writeSystemPromptOverrides,
  },
): void {
  // 覆盖系统提示词 = 直接控制模型行为（可被改写成外泄/越权指令），必须主窗口才准读写。
  ipcMain.handle("nomi:settings:system-prompts-get", async (event) => {
    assertTrustedSender(event);
    return store.read();
  });
  ipcMain.handle("nomi:settings:system-prompts-set", async (event, payload: unknown) => {
    assertTrustedSender(event);
    return store.write(payload);
  });
}
