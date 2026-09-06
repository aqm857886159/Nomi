// 「导出诊断包」的主进程入口：收集 → 组包 → 让用户自己选保存位置。
//
// 边界有意画在这里：**组包是纯的**（`diagnosticsBundle.ts`，只读 fs、可单测），
// 这一层只做两件 Electron 才能做的事——解析当前项目身份、弹保存对话框。
// 之所以不把 zip 交给渲染层去下载：包里有崩溃日志和目录快照，多绕一层渲染进程
// 就多一处它们可能被别的代码看到的地方。
import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { logsDir } from "../logging/logFiles";
import { logError, logInfo } from "../logging/logger";
import { getSettingsRoot, getWorkspaceRepositoryDeps } from "../runtimePaths";
import { projectAgentPartitionKey } from "../projectAgentHost/projectAgentIdentity";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { activeTaskProjectFallback } from "../tasks/activeProjectFallback";
import { buildDiagnosticsBundle, diagnosticsBundleFileName } from "./diagnosticsBundle";
import type { DiagnosticsExportResult } from "../shared/contracts/diagnostics";

export type { DiagnosticsExportResult } from "../shared/contracts/diagnostics";

/**
 * 当前项目的 Agent 命令账本在哪。要拿到它得先有项目身份（uuid + generation），
 * 而身份是 `ensureWorkspaceProjectIdentity` 的事——不在这里另抄一份推导（P1）。
 * 拿不到就如实返回原因，写进包的清单里，别让「这项没有」看起来像「这项是空的」。
 */
async function resolveAgentLedgerPath(
  projectId: string,
  projectDir: string,
): Promise<{ ledgerPath: string | null; reason?: string }> {
  try {
    const identity = await ensureWorkspaceProjectIdentity(projectDir);
    const partition = projectAgentPartitionKey({
      projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
    });
    return { ledgerPath: path.join(getSettingsRoot(), "project-agent-host", partition, "commands-v1.jsonl") };
  } catch (error) {
    return {
      ledgerPath: null,
      reason: `project-identity-unavailable: ${error instanceof Error ? error.name : "unknown"}`,
    };
  }
}

export async function exportDiagnosticsBundle(): Promise<DiagnosticsExportResult> {
  const now = new Date();
  const projectId = activeTaskProjectFallback() || null;
  const projectDir = projectId ? resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()) : null;
  const ledger =
    projectId && projectDir
      ? await resolveAgentLedgerPath(projectId, projectDir)
      : { ledgerPath: null, reason: "no-active-project" };

  const { zip, manifest } = buildDiagnosticsBundle({
    logsDir: logsDir(),
    settingsRoot: getSettingsRoot(),
    projectId,
    projectDir,
    agentLedgerPath: ledger.ledgerPath,
    agentLedgerUnavailableReason: ledger.reason,
    now,
    app: {
      version: app.getVersion(),
      electron: process.versions.electron ?? "?",
      node: process.versions.node ?? "?",
      chrome: process.versions.chrome ?? "?",
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      locale: typeof app.getLocale === "function" ? app.getLocale() : "?",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "?",
    },
  });

  // 单参数形态：原生对话框绝不传父窗口（跨线程模态属主 = 输入法闪退根因，
  // 见 electron/nativeDialogParent.invariant.test.ts）。
  const picked = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("downloads"), diagnosticsBundleFileName(now)),
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (picked.canceled || !picked.filePath) return { ok: false, reason: "canceled" };

  try {
    fs.writeFileSync(picked.filePath, zip);
  } catch (error) {
    logError("diagnostics", "bundle-write-failed", error);
    return { ok: false, reason: "failed" };
  }
  logInfo("diagnostics", "bundle-exported", {
    entries: manifest.entries.length,
    bytes: manifest.totalBytes,
  });
  return {
    ok: true,
    filePath: picked.filePath,
    entryCount: manifest.entries.length,
    totalBytes: manifest.totalBytes,
  };
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle("nomi:diagnostics:export", async (event) => {
    assertTrustedSender(event);
    try {
      return await exportDiagnosticsBundle();
    } catch (error) {
      logError("diagnostics", "bundle-export-failed", error);
      return { ok: false, reason: "failed" } satisfies DiagnosticsExportResult;
    }
  });
}
