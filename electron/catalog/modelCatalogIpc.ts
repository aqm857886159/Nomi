// 模型目录 IPC 收口：读取走 ipcMain.handle，写入/事务沿用同步 registerSyncIpc。
// 读写分界在这里保持单一，main.ts 只负责接线，避免主进程巨壳越过 800 行门。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import {
  clearModelCatalogVendorApiKey,
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogModels,
  deleteModelCatalogVendor,
  ensureBuiltinModelSeeds,
  exportModelCatalogPackage,
  getModelCatalogHealth,
  importModelCatalogPackage,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
} from "./catalogStore";
import { retypeModelCatalogModel } from "./modelRetype";

type RegisterSyncIpc = (channel: string, handler: (...args: never[]) => unknown) => void;

export function registerModelCatalogIpc(registerSyncIpc: RegisterSyncIpc): void {
  ipcMain.handle("nomi:model-catalog:vendors:list", (event) => {
    assertTrustedSender(event);
    return listModelCatalogVendors();
  });
  ipcMain.handle("nomi:model-catalog:models:list", (event, params?: unknown) => {
    assertTrustedSender(event);
    // Renderer 热更新不会重启 Electron main；读取时补一次内置种子，避免 onboarding
    // 长时间停留在旧的持久化目录（例如 APIMart 缺 Grok Imagine 1.5）。
    ensureBuiltinModelSeeds();
    return listModelCatalogModels(params);
  });
  ipcMain.handle("nomi:model-catalog:mappings:list", (event, params?: unknown) => {
    assertTrustedSender(event);
    return listModelCatalogMappings(params);
  });
  ipcMain.handle("nomi:model-catalog:health", (event) => {
    assertTrustedSender(event);
    return getModelCatalogHealth();
  });

  registerSyncIpc("nomi:model-catalog:vendor:upsert", upsertModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor:delete", deleteModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:upsert", upsertModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:clear", clearModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:model:upsert", upsertModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:model:retype", retypeModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:model:delete", deleteModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:models:delete", deleteModelCatalogModels);
  registerSyncIpc("nomi:model-catalog:mapping:upsert", upsertModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:mapping:delete", deleteModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:export", exportModelCatalogPackage);
  registerSyncIpc("nomi:model-catalog:import", importModelCatalogPackage);
}
