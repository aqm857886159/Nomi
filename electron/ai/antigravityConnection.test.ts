import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { AntigravityConnection, parseAntigravityModels, probeAntigravity } from "./antigravityConnection";
const result = { text: "OK", conversationId: "one", usage: {} };
const discovery = { version: "1.1.21", models: [{ id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" }] };
function service(run = vi.fn().mockResolvedValue(result), probe = vi.fn().mockResolvedValue(discovery)) {
  return { run, probe, connection: new AntigravityConnection({ probe, run, bin: () => "/test/agy" }) };
}
describe("Antigravity connection state", () => {
  it("does not confuse installation/authentication with a successful model test", async () => {
    const { connection, run } = service();
    const status = await connection.status();
    expect(status.state).toBe("unverified");
    expect(status.models).toEqual(discovery.models);
    expect(connection.canEnable()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect((await connection.test()).state).toBe("ready");
    expect((await connection.status()).state).toBe("ready");
  });
  it("reports login failure and invalidates previously successful state", async () => {
    const { connection, probe } = service();
    await connection.test();
    probe.mockRejectedValue(new Error("ANTIGRAVITY_LOGIN_REQUIRED"));
    const status = await connection.status();
    expect(status.state).toBe("login-required");
    expect(status.models).toEqual([]);
    expect(connection.canEnable()).toBe(false);
  });
  it.each(["ANTIGRAVITY_PROFILE_UNVERIFIED", "ANTIGRAVITY_INVALID_INIT"])("keeps an invalid runtime profile limited: %s", async (code) => {
    const { connection } = service(vi.fn().mockRejectedValue(new Error(code)));
    expect((await connection.test()).state).toBe("limited");
  });
  it("clears the previous model list when a new test cannot discover the account", async () => {
    const { connection, probe } = service();
    await connection.status();
    probe.mockRejectedValue(new Error("ANTIGRAVITY_LOGIN_REQUIRED"));
    expect((await connection.test()).models).toEqual([]);
  });
  it("cancels an ongoing test and rejects its late result as readiness evidence", async () => {
    let resolve!: (value: typeof result) => void;
    const { connection } = service(vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; })));
    const pending = connection.test();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    connection.cancel(); resolve(result);
    expect((await pending).state).not.toBe("ready");
    expect(connection.canEnable()).toBe(false);
  });
  it("verifies the selected real model independently without granting other capabilities", async () => {
    const { connection, run } = service();
    const request = { capability: "text" as const, modelId: discovery.models[0].id };
    const status = await connection.test(request);
    expect(run).toHaveBeenCalledWith(expect.any(AbortSignal), request, discovery.version);
    expect(status.checks).toEqual([expect.objectContaining({ ...request, state: "passed" })]);
    expect(connection.canEnable(request)).toBe(true);
    expect(connection.canEnable({ ...request, capability: "vision" })).toBe(false);
    expect(connection.canEnable({ capability: "text", modelId: "auto" })).toBe(false);
  });
  it("passes the exact discovery preparation into capability verification", async () => {
    const prepared = {
      discovery, invocation: { command: "/prepared/agy", args: ["--profile", "tested"] }, env: {},
      identity: { realpath: "/prepared/agy", dev: "1", ino: "2", size: "3", mtimeNs: "4", ctimeNs: "5" },
    };
    const run = vi.fn().mockResolvedValue(result);
    const connection = new AntigravityConnection({
      probe: vi.fn().mockRejectedValue(new Error("must not rediscover")),
      prepare: vi.fn().mockResolvedValue(prepared), run, bin: () => "/test/agy",
    });
    await expect(connection.test()).resolves.toMatchObject({ state: "ready" });
    expect(run).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal),
      { capability: "text", modelId: "auto" }, discovery.version, prepared);
  });
  it("refuses fabricated model IDs before running a paid test", async () => {
    const { connection, run } = service();
    const status = await connection.test({ capability: "text", modelId: "made-up-model" });
    expect(status.code).toBe("ANTIGRAVITY_MODEL_NOT_DISCOVERED");
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps text verification when an independent image test fails", async () => {
    const { connection, run } = service();
    await connection.test();
    run.mockRejectedValueOnce(new Error("ANTIGRAVITY_QUOTA"));
    const status = await connection.test({ capability: "image", modelId: "auto" });
    expect(status.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "text", modelId: "auto", state: "passed" }),
      expect.objectContaining({ capability: "image", state: "failed", code: "ANTIGRAVITY_QUOTA" }),
    ]));
    expect(connection.canEnable({ capability: "text", modelId: "auto" })).toBe(true);
    expect(connection.canEnable({ capability: "image", modelId: "auto" })).toBe(false);
  });
  it("does not count a model's nonempty but wrong verification answer as success", async () => {
    const { connection } = service(vi.fn().mockResolvedValue({ ...result, text: "not OK" }));
    expect((await connection.test()).code).toBe("ANTIGRAVITY_TEST_ASSERTION_FAILED");
    expect(connection.canEnable()).toBe(false);
  });
  it("invalidates every capability record when the installed CLI version changes", async () => {
    const { connection, probe } = service();
    await connection.test();
    probe.mockResolvedValue({ ...discovery, version: "1.1.22" });
    expect((await connection.status()).checks).toEqual([]);
    expect(connection.canEnable()).toBe(false);
  });
  it("restores persisted evidence only after matching the currently installed CLI version", async () => {
    const { connection } = service();
    connection.restore([{ capability: "edit", modelId: "auto", state: "passed", version: "1.1.21", checkedAt: Date.now() }]);
    expect(connection.canEnable()).toBe(false);
    expect((await connection.status()).checks).toEqual([expect.objectContaining({ capability: "edit", state: "passed" })]);
    expect(connection.canEnable({ capability: "edit", modelId: "auto" })).toBe(true);
  });
  it("authorizes only exact passed evidence for the probed version without a freshness window", async () => {
    const { connection } = service();
    connection.restore([
      { capability: "image", modelId: "auto", state: "passed", version: "1.1.21", checkedAt: 1 },
      { capability: "edit", modelId: "auto", state: "failed", version: "1.1.21", checkedAt: 2 },
      { capability: "vision", modelId: discovery.models[0].id, state: "cancelled", version: "1.1.21", checkedAt: 3 },
    ]);
    await connection.status();
    expect(connection.hasPassed({ capability: "image", modelId: "auto" }, "1.1.21")).toBe(true);
    expect(connection.hasPassed({ capability: "image", modelId: "auto" }, "1.1.22")).toBe(false);
    expect(connection.hasPassed({ capability: "edit", modelId: "auto" }, "1.1.21")).toBe(false);
    expect(connection.hasPassed({ capability: "vision", modelId: discovery.models[0].id }, "1.1.21")).toBe(false);
    expect(connection.hasPassed({ capability: "text", modelId: discovery.models[0].id }, "1.1.21")).toBe(false);
  });
});

describe("official CLI model discovery TSV", () => {
  it("closes unused stdin so model discovery can terminate", async () => {
    const found = await probeAntigravity(undefined, {
      invocation: { command: process.execPath, args: [path.resolve("electron/ai/fixtures/antigravity.mjs"), "discovery", "."] },
      env: process.env, platform: "linux",
    });
    expect(found).toEqual(discovery);
  });
  it("preserves returned IDs and labels without inferring capabilities or account eligibility", () => {
    expect(parseAntigravityModels("gemini-3.7-flash-high\tGemini 3.7 Flash (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\r\n"))
      .toEqual([...discovery.models, { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" }]);
  });
  it.each(["", "[]", "Please sign in", "id\t", "--model\tLabel", "one\tLabel\textra", "one\tA\none\tB", "one\tBad\u0000label"])("rejects malformed discovery: %j", (text) => {
    expect(() => parseAntigravityModels(text)).toThrow("ANTIGRAVITY_MODELS_INVALID");
  });
});
