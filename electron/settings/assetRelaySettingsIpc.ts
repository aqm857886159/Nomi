import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import { readAssetRelaySettings, writeAssetRelaySettings, type AssetRelaySettingsInput } from "./assetRelaySettings";

export function registerAssetRelaySettingsIpc(): void {
  ipcMain.handle("nomi:settings:asset-relay-get", (event) => {
    assertTrustedSender(event);
    return readAssetRelaySettings();
  });
  ipcMain.handle("nomi:settings:asset-relay-set", (event, payload: AssetRelaySettingsInput) => {
    assertTrustedSender(event);
    return writeAssetRelaySettings(payload || {});
  });
}
