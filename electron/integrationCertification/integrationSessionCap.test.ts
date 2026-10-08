/**
 * 「接入会话记录超过 100 条 → 整个 app 启动即静默退出」这一类的回归防线。
 *
 * 为什么单独成文件：这条不变量不是会话状态机的一步，而是**这份持久化状态自己的容量合同**
 * （写时不许越界 + 旧盘越界要能自愈）。它的反例是盘上的数据形状，不是某条转场。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationSessionService } from "./integrationSession";
import { validateState } from "./integrationSessionRecord";

const { logWarnSpy } = vi.hoisted(() => ({ logWarnSpy: vi.fn() }));
vi.mock("../logging/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logging/logger")>()),
  logWarn: logWarnSpy,
}));

const CAP = 100;
/** 写盘真实上限的 80%（integrationSessionRecord 的 INTEGRATION_SESSION_BYTE_BUDGET）。 */
const BYTE_BUDGET = Math.floor(1_048_576 * 0.8);
/** 三条这么大的会话就顶穿预算；单条声明卡上限 512KB，所以这不是臆造的形状。 */
const FAT_DRAFT_CHARS = 300_000;

function compactionLogs(): Array<Record<string, unknown>> {
  return logWarnSpy.mock.calls
    .filter((call) => call[1] === "integration-sessions-compacted")
    .map((call) => call[2] as Record<string, unknown>);
}

afterEach(() => logWarnSpy.mockClear());

let capabilityDir: string;
let previousCapabilityDir: string | undefined;

beforeAll(() => {
  // 任何情况下都不许碰用户真实的 ~/.nomi/capability-core。
  previousCapabilityDir = process.env.NOMI_CAPABILITY_DIR;
  capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-cap-capability-"));
  vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityDir);
});

beforeEach(() => {
  vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityDir);
});

afterAll(() => {
  if (previousCapabilityDir === undefined) vi.stubEnv("NOMI_CAPABILITY_DIR", undefined);
  else vi.stubEnv("NOMI_CAPABILITY_DIR", previousCapabilityDir);
  fs.rmSync(capabilityDir, { recursive: true, force: true });
});

function at(index: number): string {
  return new Date(Date.UTC(2026, 8, 1, 0, 0, 0) + index * 60_000).toISOString();
}

function sessionFixture(index: number, stage = "completed"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `integration-fixture-${String(index).padStart(3, "0")}`,
    revision: 1,
    ownerClientId: "codex",
    capabilityDigest: "capability-digest",
    kind: "http-api-provider",
    stage,
    configDigest: "config-digest",
    credentialStatus: "ready",
    unresolvedFields: [],
    createdAt: at(index),
    updatedAt: at(index),
    config: { name: `Fixture ${index}`, baseUrl: `https://fixture-${index}.example` },
    candidates: [],
    selections: [],
  };
}

/**
 * 条数远低于 100、但序列化后顶穿字节预算的一条会话。撑大它的是 `adapterDraft`——
 * 外部 Agent 交进来的说明卡，单张上限 512KB，所以这不是臆造的形状。
 * 形状要照着真的写（`models` 数组是投影读的），否则夹具自己会先炸，把真结论盖掉。
 */
function fatSessionFixture(index: number, stage = "completed"): Record<string, unknown> {
  return {
    ...sessionFixture(index, stage),
    adapterDraft: { models: [{ modelKey: `fat-${index}` }], sources: "d".repeat(FAT_DRAFT_CHARS) },
  };
}

function fileBytes(filePath: string): number {
  return fs.statSync(filePath).size;
}

function writeDisk(sessions: Record<string, unknown>[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-cap-"));
  const filePath = path.join(dir, "integration-sessions.json");
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, revision: sessions.length, sessions }, null, 2));
  return filePath;
}

function makeService(filePath: string): IntegrationSessionService {
  return new IntegrationSessionService({
    filePath,
    now: () => "2026-09-21T00:00:00.000Z",
    compilerAvailable: () => true,
  });
}

function readDisk(filePath: string): { sessions: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as { sessions: Array<Record<string, unknown>> };
}

describe("integration session capacity", () => {
  it("loads a legacy over-capacity file instead of failing app start, keeping the newest terminal records", () => {
    // 用户盘上的真实形状：101 条、全部终态。修复前这一行就是 app 启动静默退出的那一抛。
    const filePath = writeDisk(Array.from({ length: CAP + 1 }, (_, index) => sessionFixture(index)));
    const service = makeService(filePath);
    const listed = service.list("codex", 1_000).sessions;
    expect(listed).toHaveLength(CAP);
    // 被挤掉的是最旧的那条，不是随便一条。
    expect(listed.map((entry) => entry.id)).not.toContain("integration-fixture-000");
    expect(listed.map((entry) => entry.id)).toContain(`integration-fixture-${String(CAP).padStart(3, "0")}`);
    // 自愈要落盘：下一次启动不能还是 101 条（用户永远不该被要求手工删文件）。
    expect(readDisk(filePath).sessions).toHaveLength(CAP);
  });

  it("never drops an unfinished session when trimming a mixed over-capacity file", () => {
    // 最旧的 5 条是「还在进行中」的草稿：它们恰好是裁剪最容易误伤的那一批。
    const sessions = Array.from({ length: CAP + 10 }, (_, index) =>
      sessionFixture(index, index < 5 ? "draft" : "completed"),
    );
    const filePath = writeDisk(sessions);
    const ids = makeService(filePath).list("codex", 1_000).sessions.map((entry) => entry.id);
    expect(ids).toHaveLength(CAP);
    for (let index = 0; index < 5; index += 1)
      expect(ids).toContain(`integration-fixture-${String(index).padStart(3, "0")}`);
    // 少掉的 10 条全部来自终态那一批，且是其中最旧的 10 条。
    for (let index = 5; index < 15; index += 1)
      expect(ids).not.toContain(`integration-fixture-${String(index).padStart(3, "0")}`);
  });

  it("leaves an exactly-at-capacity file untouched and trims a one-over file by exactly one", () => {
    const exact = writeDisk(Array.from({ length: CAP }, (_, index) => sessionFixture(index)));
    const before = fs.readFileSync(exact, "utf8");
    expect(makeService(exact).list("codex", 1_000).sessions).toHaveLength(CAP);
    expect(fs.readFileSync(exact, "utf8")).toBe(before);

    const over = writeDisk(Array.from({ length: CAP + 1 }, (_, index) => sessionFixture(index)));
    expect(makeService(over).list("codex", 1_000).sessions).toHaveLength(CAP);
  });

  it("keeps an unfinished-only file readable even above the cap, because dropping live work is worse", () => {
    const filePath = writeDisk(Array.from({ length: CAP + 3 }, (_, index) => sessionFixture(index, "draft")));
    expect(() => makeService(filePath)).not.toThrow();
    expect(makeService(filePath).list("codex", 1_000).sessions).toHaveLength(CAP + 3);
    // 超了容量、但一条都挤不动：这是「没丢记录」的另一种长相，同样不许打日志。
    expect(compactionLogs()).toHaveLength(0);
  });

  it("bounds the file on the write side: begin() trims instead of growing past the cap", () => {
    const filePath = writeDisk(Array.from({ length: CAP }, (_, index) => sessionFixture(index)));
    const service = makeService(filePath);
    service.begin({ kind: "http-api-provider", name: "New", baseUrl: "https://new.example" }, "codex");
    const persisted = readDisk(filePath).sessions;
    expect(persisted).toHaveLength(CAP);
    expect(persisted.map((entry) => entry.id)).not.toContain("integration-fixture-000");
    expect(persisted.some((entry) => String(entry.config && (entry.config as Record<string, unknown>).name) === "New"))
      .toBe(true);
  });

  it("refuses a new session with a structured code when the cap is full of unfinished work", () => {
    const filePath = writeDisk(Array.from({ length: CAP }, (_, index) => sessionFixture(index, "draft")));
    const service = makeService(filePath);
    expect(() => service.begin({ kind: "http-api-provider", name: "New", baseUrl: "https://new.example" }, "codex"))
      .toThrowError(expect.objectContaining({ code: "integration_session_limit_reached" }));
    // 拒绝必须是干净的：不许留下半条会话。
    expect(readDisk(filePath).sessions).toHaveLength(CAP);
  });

  it("leaves a diagnosable trace whenever trimming really dropped records, and stays quiet when it did not", () => {
    const filePath = writeDisk(Array.from({ length: CAP + 2 }, (_, index) => sessionFixture(index)));
    makeService(filePath);
    const logs = compactionLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ from: CAP + 2, to: CAP, dropped: 2, stages: "completed:2", reason: "count" });
    expect(logs[0].oldestDroppedAt).toBe(at(0));
    expect(logs[0].newestDroppedAt).toBe(at(1));
    expect(logs[0].outcome).toBe("persisted");
    // 日志会被贴进 issue：只许聚合量与时间，不许带 id / URL / 供应商字段。
    const serialized = JSON.stringify(logs[0]);
    expect(serialized).not.toContain("integration-fixture");
    expect(serialized).not.toContain("fixture-0.example");

    logWarnSpy.mockClear();
    const quiet = writeDisk(Array.from({ length: 3 }, (_, index) => sessionFixture(index)));
    makeService(quiet).begin({ kind: "http-api-provider", name: "New", baseUrl: "https://new.example" }, "codex");
    expect(compactionLogs()).toHaveLength(0);
  });

  it("records the deletion even when the write that followed it failed, because memory already lost them", () => {
    // 裁剪先改内存、再落盘。落盘抛出时记录已经不在内存里了，而下一次 cap 看到的已是裁剪后的
    // 数组、不会再生成 report——痕迹一旦这时丢掉，就是**永远**丢掉。真机 byteC 实测删 3 条只记了 2 条。
    const filePath = writeDisk(Array.from({ length: CAP + 2 }, (_, index) => sessionFixture(index)));
    const service = new IntegrationSessionService({
      filePath,
      now: () => "2026-09-21T00:00:00.000Z",
      compilerAvailable: () => true,
      save: () => { throw new Error("disk is full"); },
    });
    // 构造时读侧已经自愈过一轮（它的回写同样失败、同样留了痕）；这里只看 begin 那一次写。
    expect(compactionLogs()).toMatchObject([{ dropped: 2, outcome: "memory-only" }]);
    logWarnSpy.mockClear();
    expect(() => service.begin({ kind: "http-api-provider", name: "New", baseUrl: "https://new.example" }, "codex"))
      .toThrow(/disk is full/);
    const logs = compactionLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ from: CAP + 1, to: CAP, dropped: 1, stages: "completed:1", reason: "count" });
    // 落盘没成＝盘上仍是旧内容，内存与盘分叉。日志必须说得出是哪一种，不能两种长一样。
    expect(logs[0].outcome).toBe("memory-only");
    expect(logs[0].failure).toBe("Error");
  });

  it("loads a file that is small in records but too large in bytes, instead of failing app start", () => {
    // 条数 3 « 100，但落盘 >1MiB：与条数轴是同一条不变量的另一种越界方式。
    const filePath = writeDisk(Array.from({ length: 3 }, (_, index) => fatSessionFixture(index)));
    expect(fileBytes(filePath)).toBeGreaterThan(BYTE_BUDGET);
    const service = makeService(filePath);
    expect(service.list("codex", 1_000).sessions.length).toBeLessThan(3);
    expect(fileBytes(filePath)).toBeLessThanOrEqual(BYTE_BUDGET);
    expect(compactionLogs()[0]).toMatchObject({ from: 3, reason: "bytes" });
    // 挤掉的仍然是最旧的那条终态记录。
    expect(service.list("codex", 1_000).sessions.map((entry) => entry.id)).not.toContain("integration-fixture-000");
  });

  it("survives the startup watchdog write on an oversized disk instead of quitting the app", () => {
    // 全是非终态、且**超过写盘硬上限 1MiB** 的盘：读侧一条都裁不动（裁剪只碰终态），
    // 所以第一次写发生在 resumeInterrupted 的看门狗收尾里。修复前那一步抛 oversized，
    // 一路走到 main.ts 的 .catch → app.quit()，与「超过 100 条」是同一种死法。
    const filePath = writeDisk(
      Array.from({ length: 5 }, (_, index) => ({
        ...fatSessionFixture(index, "certifying"),
        certifyingDeadlineAt: at(index),
      })),
    );
    expect(fileBytes(filePath)).toBeGreaterThan(1_048_576);
    const service = makeService(filePath);
    let reaped: string[] = [];
    expect(() => { reaped = service.resumeInterrupted(); }).not.toThrow();
    service.stopWatchdog();
    // 五条全部被收成终态，且盘最终落回预算内——中途那次真的写不下的，留痕重试后由下一次写补上。
    expect(reaped).toHaveLength(5);
    expect(fileBytes(filePath)).toBeLessThanOrEqual(BYTE_BUDGET);
    expect(logWarnSpy.mock.calls.some((call) => call[1] === "integration-session-timeout-write-failed")).toBe(true);
  });

  it("refuses a new session when unfinished work alone already fills the byte budget", () => {
    const filePath = writeDisk(Array.from({ length: 3 }, (_, index) => fatSessionFixture(index, "draft")));
    const service = makeService(filePath);
    expect(() => service.begin({ kind: "http-api-provider", name: "New", baseUrl: "https://new.example" }, "codex"))
      .toThrowError(expect.objectContaining({ code: "integration_session_limit_reached" }));
    // 进行中的三条一条不少，拒绝没有留下半条新会话。
    expect(readDisk(filePath).sessions).toHaveLength(3);
  });

  it("still fails closed on a genuinely malformed record, which is a different problem from too many", () => {
    expect(() => validateState({ version: 1, revision: 1, sessions: [{ ...sessionFixture(0), stage: "bogus" }] }))
      .toThrow(/Invalid integration session record/);
    expect(() => validateState({ version: 2, revision: 1, sessions: [] })).toThrow(/Invalid integration session state/);
  });
});
