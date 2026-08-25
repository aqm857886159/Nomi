import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import {
  readGenerationModelDefaults,
  writeGenerationModelDefaults,
  type GenerationModelDefaults,
} from "./generationModelDefaultsSettings";

export type GenerationModelDefaultsStore = {
  read: () => GenerationModelDefaults;
  write: (value: unknown) => GenerationModelDefaults;
};

export function registerGenerationModelDefaultsIpc(
  store: GenerationModelDefaultsStore = {
    read: readGenerationModelDefaults,
    write: writeGenerationModelDefaults,
  },
): void {
  // 默认生成模型 = 后续每次生成花谁的额度，属于花钱路径的前置开关。
  ipcMain.handle("nomi:settings:generation-model-defaults-get", async (event) => {
    assertTrustedSender(event);
    return store.read();
  });
  ipcMain.handle("nomi:settings:generation-model-defaults-set", async (event, payload: unknown) => {
    assertTrustedSender(event);
    return store.write(payload);
  });
}
