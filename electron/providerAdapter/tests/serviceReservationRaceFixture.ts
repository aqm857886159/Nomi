import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Model, Vendor } from "../../catalog/types";
import { ProviderAdapterService, type ProviderAdapterCatalogPort } from "../service";
import { ProviderAdapterStore } from "../store";
import type { ProviderAdapterRun } from "../types";

const fixedNow = "2026-08-28T00:00:00.000Z";

function marker(root: string, name: "stage" | "schedule" | "create"): void {
  fs.appendFileSync(path.join(root, `${name}.log`), "1\n");
}

function markerCount(root: string, name: "stage" | "schedule" | "create"): number {
  const filePath = path.join(root, `${name}.log`);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

function catalog(root: string): ProviderAdapterCatalogPort {
  const vendor: Vendor = {
    key: "race-example",
    name: "Race Example",
    enabled: false,
    baseUrlHint: "https://race.example/v1",
    authType: "bearer",
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
  const model: Model = {
    vendorKey: vendor.key,
    modelKey: "text-v1",
    labelZh: "Text V1",
    kind: "text",
    enabled: false,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
  return {
    register(input) {
      return { vendor: { ...vendor, key: input.vendorKey }, models: [{ ...model, vendorKey: input.vendorKey }] };
    },
    stage() {
      marker(root, "stage");
      return { vendor, models: [model], lineageRootVendorKey: vendor.key, supersededVendorKeys: [] };
    },
    load() {
      return { vendor, models: [model], apiKey: "sentinel-race-key" };
    },
    promote(input) {
      return { status: "committed", committedModes: input.verifiedModes };
    },
    fail() {},
  };
}

const input = {
  vendorName: "Race Example",
  catalogVendorKey: "race-example",
  baseUrl: "https://race.example/v1",
  apiKey: "sentinel-race-key",
  authType: "bearer" as const,
  providerKind: "openai-compatible" as const,
  models: [{ modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const }],
  certification: {
    contractDigest: "f".repeat(64),
    idempotencyKey: "canonical-reservation-materialization-race",
    remoteIdempotency: "unsupported" as const,
  },
};

function startCanonicalWorker(root: string, filePath: string, children: ChildProcess[]): {
  reserved: Promise<void>;
  completed: Promise<string>;
} {
  const workerPath = path.join(root, "canonical-worker.ts");
  const serviceModule = path.resolve(__dirname, "../service.ts");
  const storeModule = path.resolve(__dirname, "../store.ts");
  const tsxCli = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
  fs.writeFileSync(workerPath, `
    import fs from "node:fs";
    import path from "node:path";
    import { ProviderAdapterService } from ${JSON.stringify(serviceModule)};
    import { ProviderAdapterStore } from ${JSON.stringify(storeModule)};
    async function main() {
    const [root, filePath] = process.argv.slice(2);
    const fixedNow = ${JSON.stringify(fixedNow)};
    const observedPath = path.join(root, "duplicate-observed");
    const allowMaterializePath = path.join(root, "allow-materialize");
    const waitForFile = async (filePath: string, error: string) => {
      for (let attempt = 0; attempt < 6_000; attempt += 1) {
        if (fs.existsSync(filePath)) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(error);
    };
    const marker = (name: string) => fs.appendFileSync(path.join(root, \`\${name}.log\`), "1\\n");
    const vendor = {
      key: "race-example", name: "Race Example", enabled: false,
      baseUrlHint: "https://race.example/v1", authType: "bearer",
      createdAt: fixedNow, updatedAt: fixedNow,
    };
    const model = {
      vendorKey: vendor.key, modelKey: "text-v1", labelZh: "Text V1",
      kind: "text", enabled: false, createdAt: fixedNow, updatedAt: fixedNow,
    };
    const catalog = {
      register(input: any) { return { vendor: { ...vendor, key: input.vendorKey }, models: [{ ...model, vendorKey: input.vendorKey }] }; },
      stage() { marker("stage"); return { vendor, models: [model], lineageRootVendorKey: vendor.key, supersededVendorKeys: [] }; },
      load() { return { vendor, models: [model], apiKey: "sentinel-race-key" }; },
      promote(input: any) { return { status: "committed" as const, committedModes: input.verifiedModes }; },
      fail() {},
    };
    const scheduled: string[] = [];
    const service = new ProviderAdapterService(new ProviderAdapterStore(filePath), {
      catalog: catalog as any,
      id: () => "run-canonical",
      now: () => fixedNow,
      schedule: (runId: string) => { marker("schedule"); scheduled.push(runId); },
      verify: async ({ mode }: any) => { marker("create"); return { ok: true as const, taskKind: mode.taskKind }; },
      certificationCheckpoint: async (checkpoint: string) => {
        if (checkpoint !== "after_intent") return;
        process.stdout.write("RESERVED\\n");
        await waitForFile(observedPath, "duplicate never observed the reserved canonical start");
        await waitForFile(allowMaterializePath, "event loop never released canonical materialization");
      },
    });
    const run = await service.start(${JSON.stringify(input)});
    for (const runId of scheduled) await service.executeRun(runId);
    process.stdout.write(\`RESULT:\${run.id}\\n\`);
    }
    void main().catch((error) => { process.stderr.write(String(error?.stack || error)); process.exitCode = 1; });
  `);
  const child = spawn(process.execPath, [tsxCli, workerPath, root, filePath], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let stdout = "";
  let stderr = "";
  let resolveReserved!: () => void;
  const reserved = new Promise<void>((resolve) => { resolveReserved = resolve; });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    if (stdout.includes("RESERVED\n")) resolveReserved();
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const completed = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      const result = stdout.match(/RESULT:([^\n]+)/)?.[1];
      if (code === 0 && result) resolve(result);
      else reject(new Error(stderr || stdout || `canonical worker exited ${code}`));
    });
  });
  return { reserved: Promise.race([reserved, completed.then(() => undefined)]), completed };
}

class DuplicateBarrierStore extends ProviderAdapterStore {
  constructor(filePath: string, private readonly root: string) {
    super(filePath);
  }

  override getRun(id: string): ProviderAdapterRun | undefined {
    const run = super.getRun(id);
    if (id === "run-canonical" && !run) fs.writeFileSync(path.join(this.root, "duplicate-observed"), "1");
    return run;
  }
}

export async function runCanonicalReservationRace(): Promise<{
  duplicateRunId: string | undefined;
  canonicalRunId: string;
  stageCount: number;
  scheduleCount: number;
  createCount: number;
  storedRunIds: string[];
  eventLoopResponsiveDuringWait: boolean;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canonical-reservation-race-"));
  const children: ChildProcess[] = [];
  try {
    const filePath = path.join(root, "provider-adapters.json");
    const worker = startCanonicalWorker(root, filePath, children);
    await worker.reserved;

    const duplicateService = new ProviderAdapterService(new DuplicateBarrierStore(filePath, root), {
      catalog: catalog(root),
      id: () => "run-duplicate",
      now: () => fixedNow,
      // 这个窗口是**死锁兜底**，不是判据。本用例断言的是「duplicate 复用了 canonical 的 run」
      // （duplicateRunId === canonicalRunId），从来没断言过它多快拿到；而 canonical 侧跑在独立
      // tsx 子进程里，这 200ms 要覆盖「子进程启动 + 文件栅栏轮询 + start()/executeRun()」。
      // 本仓常年 20+ worktree 并行跑套件，机器一忙窗口就不够，start() 抛
      // "Timed out waiting for canonical run materialization" 让整条用例红——证明的是机器慢，
      // 不是代码阻塞了事件循环。真判据 eventLoopResponsiveDuringWait 由「setImmediate 回调有没有
      // 抢在 duplicate 结算之前跑到」决定，是顺序事实、与机器速度无关，放宽这里不会削弱它。
      // 兜底就该给得宽；真卡死仍会在 30s testTimeout 处红。
      // 别顺手改下面 fail-closed 用例的 canonicalStartWaitMs: 25——那条的 owner 永不物化，
      // 短窗口正是它的判据本身。
      canonicalStartWaitMs: 10_000,
      schedule: () => marker(root, "schedule"),
      verify: async ({ mode }) => {
        marker(root, "create");
        return { ok: true as const, taskKind: mode.taskKind };
      },
    });
    let duplicate: ProviderAdapterRun | undefined;
    let duplicateError: unknown;
    let duplicateSettled = false;
    let eventLoopResponsiveDuringWait = false;
    const responsiveness = new Promise<void>((resolve) => {
      setImmediate(() => {
        eventLoopResponsiveDuringWait = !duplicateSettled;
        fs.writeFileSync(path.join(root, "allow-materialize"), "1");
        resolve();
      });
    });
    try {
      duplicate = await duplicateService.start(input);
    } catch (error) {
      duplicateError = error;
    } finally {
      duplicateSettled = true;
    }
    await responsiveness;
    const canonicalRunId = await worker.completed;
    if (duplicateError) throw duplicateError;
    return {
      duplicateRunId: duplicate?.id,
      canonicalRunId,
      stageCount: markerCount(root, "stage"),
      scheduleCount: markerCount(root, "schedule"),
      createCount: markerCount(root, "create"),
      storedRunIds: new ProviderAdapterStore(filePath).snapshot().runs.map((run) => run.id),
      eventLoopResponsiveDuringWait,
    };
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runCanonicalReservationTimeout(): Promise<{
  duplicateError: unknown;
  stageCount: number;
  scheduleCount: number;
  createCount: number;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canonical-reservation-timeout-"));
  try {
    const filePath = path.join(root, "provider-adapters.json");
    const owner = new ProviderAdapterService(new ProviderAdapterStore(filePath), {
      catalog: catalog(root),
      id: () => "run-canonical",
      now: () => fixedNow,
      certificationCheckpoint: (checkpoint) => {
        if (checkpoint === "after_intent") throw new Error("simulated owner crash after reservation");
      },
    });
    try {
      await owner.start(input);
    } catch {
      // The canonical reservation intentionally survives the simulated owner crash.
    }

    const duplicate = new ProviderAdapterService(new ProviderAdapterStore(filePath), {
      catalog: catalog(root),
      id: () => "run-duplicate",
      now: () => fixedNow,
      canonicalStartWaitMs: 25,
      schedule: () => marker(root, "schedule"),
    });
    let duplicateError: unknown;
    try {
      await duplicate.start(input);
    } catch (error) {
      duplicateError = error;
    }
    return {
      duplicateError,
      stageCount: markerCount(root, "stage"),
      scheduleCount: markerCount(root, "schedule"),
      createCount: markerCount(root, "create"),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
