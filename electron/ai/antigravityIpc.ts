import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { parseAntigravityTestRequest, type AntigravityConnectionStatus } from "../shared/antigravity";
import { antigravityConnection } from "./antigravityConnection";
import { syncAntigravityCatalog } from "../catalog/antigravityCatalog";
import { readAntigravityEvidence, writeAntigravityEvidence } from "./antigravityEvidenceStore";
import { isQuitRequested, registerQuitDrain } from "../quitTeardown";

export function registerAntigravityIpc(): void {
  let initialized = false;
  let active: { owner: number; promise: Promise<AntigravityConnectionStatus> } | undefined;
  let completed: { owner: number; status: AntigravityConnectionStatus } | undefined;
  registerQuitDrain("antigravity-connection", async () => {
    if (!active) return;
    antigravityConnection.cancel();
    await active.promise.catch(() => undefined);
  }, { required: true, timeoutMs: 2500 });
  const initialize = () => {
    if (initialized) return;
    initialized = true;
    antigravityConnection.restore(readAntigravityEvidence());
  };
  const persist = async (status: AntigravityConnectionStatus) => {
    writeAntigravityEvidence(status.checks ?? []);
    await syncAntigravityCatalog(status);
    return status;
  };
  ipcMain.handle("nomi:antigravity:status", async (event) => {
    assertTrustedSender(event); initialize();
    return persist(await antigravityConnection.status());
  });
  ipcMain.handle("nomi:antigravity:test", async (event, value: unknown) => {
    assertTrustedSender(event);
    if (isQuitRequested()) throw new Error("ANTIGRAVITY_SHUTTING_DOWN");
    const request = parseAntigravityTestRequest(value);
    if (active) throw new Error("ANTIGRAVITY_TEST_ACTIVE");
    initialize();
    const cancel = () => antigravityConnection.cancel();
    completed = undefined;
    // Submission, cancellation and shutdown share the complete durable operation.
    const run = { owner: event.sender.id, promise: antigravityConnection.test(request).then(persist) };
    active = run;
    event.sender.once("destroyed", cancel);
    try {
      const status = await run.promise;
      completed = { owner: run.owner, status };
      return status;
    }
    finally {
      event.sender.removeListener("destroyed", cancel);
      if (active === run) active = undefined;
    }
  });
  ipcMain.handle("nomi:antigravity:cancel", async (event) => {
    assertTrustedSender(event);
    // A finished test reply can cross an already-sent cancel request in IPC.
    if (!active) return completed?.owner === event.sender.id ? completed.status : undefined;
    if (active.owner !== event.sender.id) throw new Error("ANTIGRAVITY_OWNER_MISMATCH");
    antigravityConnection.cancel();
    return await active.promise;
  });
}
