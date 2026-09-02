import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import type { CommittedSurfaceProjectSelection } from "../capabilityCore/canvasReadSurfaceRegistry";

const exportJobEventSubscriptions = new Map<number, () => void>();
let exportJobsPromise: Promise<typeof import("./exportJobs")> | null = null;

function loadExportJobs(): Promise<typeof import("./exportJobs")> {
  exportJobsPromise ??= import("./exportJobs");
  return exportJobsPromise;
}

type ExportJobIpcDeps = Readonly<{
  getActiveProjectSelection(): CommittedSurfaceProjectSelection | null;
}>;

function requireActiveProjectSelection(deps: ExportJobIpcDeps): CommittedSurfaceProjectSelection {
  const selection = deps.getActiveProjectSelection();
  if (!selection) throw new Error("No active project is bound to the export surface");
  return selection;
}

function sameSelection(
  snapshot: Readonly<{ projectIdentity: CommittedSurfaceProjectSelection | null }>,
  selection: CommittedSurfaceProjectSelection,
): boolean {
  const identity = snapshot.projectIdentity;
  return identity !== null && identity.projectId === selection.projectId
    && identity.immutableProjectUuid === selection.immutableProjectUuid
    && identity.projectGeneration === selection.projectGeneration
    && identity.canonicalRootDigest === selection.canonicalRootDigest;
}

export function registerExportJobIpc(deps: ExportJobIpcDeps): void {
  ipcMain.handle("nomi:exports:start-job", async (event, payload) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.startExportJob(payload, selection);
  });
  ipcMain.handle("nomi:exports:list", async (event) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.listExportJobs(selection);
  });
  ipcMain.handle("nomi:exports:write-temp-input", async (event, payload) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.writeExportTempInput(selection, payload);
  });
  ipcMain.handle("nomi:exports:finish-temp-input", async (event, payload) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.finishExportTempInput(selection, payload);
  });
  ipcMain.handle("nomi:exports:status", async (event, jobId) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.getExportJobStatus(selection, jobId);
  });
  ipcMain.handle("nomi:exports:verify", async (event, jobId) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    return jobs.verifyExportJob(selection, jobId);
  });
  ipcMain.handle("nomi:exports:cancel", async (event, jobId) => {
    assertTrustedSender(event);
    const jobs = await loadExportJobs();
    const selection = requireActiveProjectSelection(deps);
    await registerExportJobEventForwarding(event.sender, deps);
    return jobs.cancelExportJob(selection, jobId);
  });
  ipcMain.handle("nomi:exports:show-in-folder", async (event, payload) => {
    assertTrustedSender(event);
    const { showExportInFolder } = await loadExportJobs();
    return showExportInFolder(payload);
  });
}

export async function registerExportJobEventForwarding(contents: WebContents, deps: ExportJobIpcDeps): Promise<void> {
  if (exportJobEventSubscriptions.has(contents.id)) return;
  const { subscribeExportJobEvents } = await loadExportJobs();
  const unsubscribe = subscribeExportJobEvents((payload) => {
    const selection = deps.getActiveProjectSelection();
    if (!selection || !sameSelection(payload.snapshot, selection)) return;
    const target = electronWebContents.fromId(contents.id);
    if (!target || target.isDestroyed()) return;
    target.send("nomi:exports:event", payload);
  });
  exportJobEventSubscriptions.set(contents.id, unsubscribe);
  contents.once("destroyed", () => {
    exportJobEventSubscriptions.get(contents.id)?.();
    exportJobEventSubscriptions.delete(contents.id);
  });
}
