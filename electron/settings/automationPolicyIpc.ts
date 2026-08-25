import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import {
  readAutomationPolicySettings,
  writeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "./automationPolicySettings";

export type AutomationPolicySettingsStore = {
  read: () => AutomationPolicySettings;
  write: (value: unknown) => AutomationPolicySettings;
};

export function registerAutomationPolicyIpc(
  store: AutomationPolicySettingsStore = {
    read: readAutomationPolicySettings,
    write: writeAutomationPolicySettings,
  },
): void {
  // 这两条写的是 anonymousAssetHosting 同意策略：一旦被非主窗内容改成 "allow"，
  // 素材托管的同意卡就不再弹，本地素材会无声上传公网托管——正是同意机制要防的事。
  ipcMain.handle("nomi:settings:automation-policy-get", async (event) => {
    assertTrustedSender(event);
    return store.read();
  });
  ipcMain.handle("nomi:settings:automation-policy-set", async (event, payload: unknown) => {
    assertTrustedSender(event);
    return store.write(payload);
  });
}
