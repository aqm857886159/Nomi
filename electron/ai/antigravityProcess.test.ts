import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAntigravityProcess, buildAntigravityEnv, prepareAntigravityInvocation } from "./antigravityProcess";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture(mode: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nomi-agy-test-")); dirs.push(dir);
  return { dir, invocation: { command: process.execPath,
    args: [path.resolve("electron/ai/fixtures/antigravity.mjs"), mode, dir] } };
}

describe("Antigravity process ownership", () => {
  it("spawns only the exact executable identity prepared by discovery", async () => {
    const f = await fixture("success");
    const prepared = await prepareAntigravityInvocation({ invocation: f.invocation, env: process.env });
    const result = await runAntigravityProcess({ prompt: "bound invocation" }, { preparedInvocation: prepared });
    expect(result.text).toBe("\u4f60\u597d");
    expect(JSON.parse(await readFile(path.join(f.dir, "input"), "utf8")))
      .toEqual({ event: "user", message: { content: "bound invocation" } });
  });

  it("fails before spawn when the prepared executable identity no longer matches", async () => {
    if (process.platform === "win32") return;
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-identity-")); dirs.push(dir);
    const executable = path.join(dir, "agy");
    const spawned = path.join(dir, "spawned");
    await writeFile(executable, `#!/bin/sh\nprintf spawned > '${spawned.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
    const prepared = await prepareAntigravityInvocation({ invocation: { command: executable, args: [] }, env: process.env });
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    await expect(runAntigravityProcess({ prompt: "must not spawn" }, { preparedInvocation: prepared }))
      .rejects.toThrow("ANTIGRAVITY_EXECUTABLE_CHANGED");
    await expect(readFile(spawned)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("handles split NDJSON and closes stdin after one prompt; removes its workspace", async () => {
    const f = await fixture("success"); const onDelta = vi.fn();
    const result = await runAntigravityProcess({ prompt: "write a scene", onDelta }, { invocation: f.invocation });
    expect(result.text).toBe("你好");
    expect(onDelta.mock.calls.flat().join("")).toBe("你好");
    expect(JSON.parse(await readFile(path.join(f.dir, "input"), "utf8")))
      .toEqual({ event: "user", message: { content: "write a scene" } });
    const cwd = await readFile(path.join(f.dir, "cwd"), "utf8");
    const profile = await readFile(path.join(f.dir, "profile"), "utf8");
    expect(profile).toContain("tools: []");
    expect(profile).toContain("inheritCustomizations: false");
    expect(profile).toContain("# System Prompt");
    expect(await readFile(path.join(f.dir, "mounted-cwd"), "utf8")).toBe(cwd);
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["agent-fallback", "missing-log", "oversize-log"])("withholds the prompt without a valid profile diagnostic: %s", async (mode) => {
    const f = await fixture(mode);
    await expect(runAntigravityProcess({ prompt: "secret task" }, { invocation: f.invocation })).rejects.toThrow("PROFILE");
    await expect(readFile(path.join(f.dir, "input"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("still rejects actual tool steps in a text session", async () => {
    const f = await fixture("tool-call");
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation })).rejects.toThrow("TOOLS_UNSUPPORTED");
  });
  it.skipIf(process.platform === "win32").each(["fifo-log", "symlink-log"])("rejects nonregular diagnostics before sending input: %s", async (mode) => {
    const f = await fixture(mode);
    // Rescue a regressed blocking FIFO open after the init deadline, so RED
    // fails with INIT_TIMEOUT instead of stranding the test's libuv worker.
    //
    // 2026-09-03：这两个数原本是 500 / 1_000，在满载机器上让本用例假红——它期望
    // PROFILE_UNVERIFIED，实际拿到 ANTIGRAVITY_INIT_TIMEOUT。原因是 500ms 的 init 截止时间
    // 要和**真实子进程启动**赛跑：本仓常年 20+ worktree 并行跑套件，spawn 一旦超过 500ms，
    // 绿路径也会先撞上截止时间，于是报的是「机器慢」而不是「诊断文件校验没生效」。
    // 这两个数都不是判据——判据是抛出的错误码（PROFILE_UNVERIFIED）和 input 文件必须不存在。
    // 它们只是「别永远挂着」的兜底，且必须保持 init 截止 < rescue 的先后关系（RED 时先超时、
    // 再解救被 FIFO 堵住的 libuv worker）。所以按同一倍数一起放大，比例与语义都不变；
    // 绿路径本就在校验完成时立刻 reject，放大不影响它的耗时。
    const rescue = setTimeout(() => {
      void readFile(path.join(f.dir, "cwd"), "utf8")
        .then((cwd) => open(path.join(cwd, "cli.log"), constants.O_WRONLY | constants.O_NONBLOCK))
        .then((file) => file.close()).catch(() => {});
    }, 16_000);
    try {
      await expect(runAntigravityProcess({ prompt: "secret task" }, { invocation: f.invocation, initTimeoutMs: 8_000 }))
        .rejects.toThrow("PROFILE_UNVERIFIED");
      await expect(readFile(path.join(f.dir, "input"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { clearTimeout(rescue); }
  });
  it.each(["malformed", "malformed-tail", "trailing-garbage", "missing", "duplicate", "nonzero"])("rejects partial output: %s", async (mode) => {
    const f = await fixture(mode);
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation })).rejects.toThrow();
  });
  it("distinguishes login from protocol errors", async () => {
    const f = await fixture("auth");
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation })).rejects.toThrow("LOGIN_REQUIRED");
  });
  it("times out before init without sending a prompt", async () => {
    const f = await fixture("hang");
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation, initTimeoutMs: 100 })).rejects.toThrow("INIT_TIMEOUT");
    await expect(readFile(path.join(f.dir, "input"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("cancels its owned child and rejects with AbortError", async () => {
    const f = await fixture("hang"); const controller = new AbortController();
    const run = runAntigravityProcess({ prompt: "test", signal: controller.signal }, { invocation: f.invocation });
    setTimeout(() => controller.abort(), 80);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
  it("enforces the overall timeout and kills a child that ignores SIGTERM", async () => {
    const f = await fixture("stuck");
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation, timeoutMs: 2_000 }))
      .rejects.toThrow("ANTIGRAVITY_TIMEOUT");
    await expect(stat(await readFile(path.join(f.dir, "cwd"), "utf8"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not inherit API credentials or arbitrary app secrets", () => {
    expect(buildAntigravityEnv({ HOME: "/user", PATH: "/bin", GEMINI_API_KEY: "private", AGNES_API_KEY: "private", OTHER_SECRET: "private" }))
      .toEqual({ HOME: "/user", PATH: "/bin" });
  });
  it.skipIf(process.platform === "win32")("kills inherited-pipe descendants even after the CLI exits", async () => {
    const f = await fixture("descendant");
    await expect(runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation, timeoutMs: 2_000 })).rejects.toThrow("TIMEOUT");
    const pid = Number(await readFile(path.join(f.dir, "child-pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(stat(await readFile(path.join(f.dir, "cwd"), "utf8"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.skipIf(process.platform === "win32").each(["success", "cancel"])("cleans silent SIGTERM-ignoring descendants on %s before returning", async (outcome) => {
    const f = await fixture("silent-descendant-" + outcome);
    const controller = new AbortController();
    const run = runAntigravityProcess({ prompt: "test", signal: controller.signal }, { invocation: f.invocation });
    const settled = run.then((value) => ({ value, error: undefined }), (error: Error) => ({ value: undefined, error }));
    let pid = 0;
    try {
      await vi.waitFor(async () => { pid = Number(await readFile(path.join(f.dir, "child-pid"), "utf8")); }, { timeout: 3_000 });
      if (outcome === "cancel") controller.abort();
      const result = await settled;
      if (outcome === "cancel") expect(result.error?.name).toBe("AbortError");
      else expect(result.value?.text).toBe("你好");
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(stat(await readFile(path.join(f.dir, "cwd"), "utf8"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      controller.abort();
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ } }
      await settled;
    }
  });
  it.skipIf(process.platform === "win32").each([false, true])("does not treat EPERM as proof the process group is gone (persistent=%s)", async (persistent) => {
    const f = await fixture("success");
    const kill = process.kill.bind(process); let denied = false;
    const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid < 0 && signal === 0 && (persistent || !denied)) {
        denied = true;
        throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      }
      return kill(pid, signal);
    });
    try {
      const run = runAntigravityProcess({ prompt: "test" }, { invocation: f.invocation });
      if (persistent) await expect(run).rejects.toThrow("ANTIGRAVITY_CLEANUP_FAILED");
      else await expect(run).resolves.toMatchObject({ text: "你好" });
    } finally { spy.mockRestore(); }
  });
  it.skipIf(process.platform === "win32")("honors cancellation during asynchronous descendant cleanup", async () => {
    const f = await fixture("silent-descendant-success"); const controller = new AbortController();
    const kill = process.kill.bind(process);
    const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid < 0 && signal === "SIGKILL") queueMicrotask(() => controller.abort());
      return kill(pid, signal);
    });
    try {
      await expect(runAntigravityProcess({ prompt: "test", signal: controller.signal }, { invocation: f.invocation }))
        .rejects.toMatchObject({ name: "AbortError" });
    } finally { spy.mockRestore(); }
  });
});

describe("Antigravity bounded media process", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5foAAAAASUVORK5CYII=", "base64");
  it.each([undefined, "1.2.0"])("fails closed before spawn for unverified CLI media version: %s", async (cliVersion) => {
    const f = await fixture("media-image");
    await expect(runAntigravityProcess({ prompt: "draw", capability: "image", cliVersion }, { invocation: f.invocation }))
      .rejects.toThrow("MEDIA_VERSION");
    await expect(readFile(path.join(f.dir, "cwd"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["image", "edit", "vision"] as const)("runs %s with its exact input/tool scope", async (capability) => {
    const f = await fixture("media-" + capability);
    const result = await runAntigravityProcess({ prompt: "task", capability, cliVersion: "1.1.21",
      ...(capability === "image" ? {} : { images: [{ bytes: png, mimeType: "image/png" }] }),
    }, { invocation: f.invocation, env: { ...buildAntigravityEnv(), HOME: f.dir } });
    const profile = await readFile(path.join(f.dir, "profile"), "utf8");
    expect(JSON.parse(await readFile(path.join(f.dir, "preflight-files"), "utf8"))).not.toContain(true);
    expect(profile).toContain(capability === "vision" ? "view_file" : "generate_image");
    expect(profile).toContain("plugins:");
    if (capability === "vision") expect(result.artifacts).toBeUndefined();
    else expect(result.artifacts).toMatchObject([{ mimeType: "image/png", width: 1, height: 1 }]);
    await expect(stat(await readFile(path.join(f.dir, "cwd"), "utf8"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["missing-hook", "wrong-reference", "double-generate", "artifact-outside", "artifact-symlink", "artifact-fifo", "artifact-corrupt"])("rejects unsafe media: %s", async (mode) => {
    const f = await fixture("media-" + mode);
    await expect(runAntigravityProcess({ prompt: "task", capability: "image", cliVersion: "1.1.21" },
      { invocation: f.invocation, env: { ...buildAntigravityEnv(), HOME: f.dir } })).rejects.toThrow("ANTIGRAVITY_");
  });
  it("rejects non-image bytes before launching the CLI", async () => {
    const f = await fixture("media-vision");
    await expect(runAntigravityProcess({ prompt: "task", capability: "vision", cliVersion: "1.1.21",
      images: [{ bytes: Buffer.from("not an image"), mimeType: "image/png" }] }, { invocation: f.invocation }))
      .rejects.toThrow("IMAGE_INVALID");
    await expect(readFile(path.join(f.dir, "cwd"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not release the task prompt when the private plugin did not initialize", async () => {
    const f = await fixture("media-missing-hook");
    await expect(runAntigravityProcess({ prompt: "PRIVATE_TASK_CONTENT", capability: "image", cliVersion: "1.1.21" },
      { invocation: f.invocation, env: { ...buildAntigravityEnv(), HOME: f.dir } })).rejects.toThrow("HOOK_UNVERIFIED");
    expect(await readFile(path.join(f.dir, "input"), "utf8")).not.toContain("PRIVATE_TASK_CONTENT");
  });
});
