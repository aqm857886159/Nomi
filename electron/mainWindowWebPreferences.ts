/**
 * [INPUT]: 依赖 node:path、./shared/featureFlags/director3dbox 的 director3dBoxProof、./logging/logger 的 logInfo
 * [OUTPUT]: 对外提供 mainWindowWebPreferences(mainDir)：主窗口 BrowserWindow 的 webPreferences（preload 入口、隔离开关、preload 启动参数）
 * [POS]: 主窗口与 preload 之间契约的唯一出处：安全开关（contextIsolation / nodeIntegration / sandbox）原样照搬 main.ts 旧值，
 *        另带 3D-BOX 开关证明（主进程算一次、记一条 director3dbox-resolved、经 additionalArguments 交给 preload 从 process.argv 解码核对）。
 *        从 main.ts 拆出来：main.ts 是 R9 白名单巨壳（只减不增），开关引导的细节不再喂它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import path from "node:path";
import type { WebPreferences } from "electron";
import { director3dBoxProof } from "./shared/featureFlags/director3dbox";
import { logInfo } from "./logging/logger";

let proofLogged = false;

export function mainWindowWebPreferences(mainDir: string): WebPreferences {
  const proof = director3dBoxProof();
  if (!proofLogged) {
    proofLogged = true;
    logInfo("main", "director3dbox-resolved", { enabled: proof.enabled, source: proof.source, fingerprint: proof.fingerprint, expiresOn: proof.expiresOn });
  }
  return {
    preload: path.join(mainDir, "preload.js"),
    additionalArguments: [`--nomi-director3dbox-proof=${encodeURIComponent(JSON.stringify(proof))}`],
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}
