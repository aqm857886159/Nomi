// 素材上传通道域的 IPC（从 main.ts 拆出，给 800 行门腾空间；后续 transport 通道加这里，别回填 main.ts）。
// 与 comfyuiIpc.ts 同一范式：main.ts 惰性 require 本文件，内部用静态 import。
import { ipcMain } from "electron";
import { assertTrustedSender } from "./ipcSenderGuard";
import { readCatalog } from "./catalog/catalogStore";
import { describeAssetTransportChannels } from "./catalog/assetTransportDescribe";
import { decryptApiKeyRecord } from "./catalog/secrets";

export function registerAssetTransportIpc(): void {
  // 设置页「素材上传通道」状态卡的数据源：问的是**真解析器**「现在第一名是谁」，
  // 渲染层不重算优先级（重算 = 第二个真相源，卡片迟早和真实行为漂移，而说谎的状态卡比没有更坏）。
  ipcMain.handle("nomi:asset-transport:channels:describe", (event) => {
    assertTrustedSender(event);
    const catalog = readCatalog();
    return describeAssetTransportChannels({
      vendors: catalog.vendors,
      getApiKey: (key) => decryptApiKeyRecord(catalog.apiKeysByVendor[key]),
    });
  });
}
