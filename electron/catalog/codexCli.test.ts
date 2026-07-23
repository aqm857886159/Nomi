import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodexImagePrompt, buildCodexSpawnInvocation, latestGeneratedImageForThread, parseCodexThreadId, queryCodexImageOperation } from "./codexCli";

const envSnapshot = { ...process.env };
const tempRoots: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, envSnapshot);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Codex CLI image bridge", () => {
  it("Windows 下用 cmd.exe 包装 codex.cmd，避免 spawn EINVAL", () => {
    const invocation = buildCodexSpawnInvocation("codex.cmd", ["--version"], "win32");
    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(invocation.args[3]).toContain("\"codex.cmd\"");
    expect(invocation.args[3]).toContain("\"--version\"");
  });

  it("非 cmd/bat 可执行文件保持直接 spawn", () => {
    const invocation = buildCodexSpawnInvocation("codex", ["--version"], "linux");
    expect(invocation).toEqual({ command: "codex", args: ["--version"] });
  });

  it("从 codex exec --json 的 JSONL 里提取 thread_id", () => {
    const stdout = [
      "{\"type\":\"turn.started\"}",
      "{\"type\":\"thread.started\",\"thread_id\":\"019f8939-c2c6-7c62-a9ff-a169c1dda10b\"}",
      "plain text",
    ].join("\n");
    expect(parseCodexThreadId(stdout)).toBe("019f8939-c2c6-7c62-a9ff-a169c1dda10b");
  });

  it("提示词强制走 $imagegen，禁止脚本/占位图替代", () => {
    const prompt = buildCodexImagePrompt("黑底白字 N");
    expect(prompt).toContain("$imagegen");
    expect(prompt).toContain("FAIL_IMAGEGEN_UNAVAILABLE");
    expect(prompt).toContain("禁止使用 PowerShell、Python、SVG、HTML、canvas");
    expect(prompt).toContain("黑底白字 N");
  });

  it("带参考图时提示词要求基于附件图片生成", () => {
    const prompt = buildCodexImagePrompt("把它改成蓝色", true);
    expect(prompt).toContain("基于附件图片");
    expect(prompt).toContain("把它改成蓝色");
  });

  it("只从当前 thread 的 generated_images 目录取新生成图片", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    process.env.CODEX_HOME = root;
    const threadDir = path.join(root, "generated_images", "thread-1");
    mkdirSync(threadDir, { recursive: true });
    const oldFile = path.join(threadDir, "old.png");
    const newFile = path.join(threadDir, "new.webp");
    const ignoredFile = path.join(threadDir, "note.txt");
    writeFileSync(oldFile, "old");
    writeFileSync(newFile, "new");
    writeFileSync(ignoredFile, "ignore");
    const cutoff = Date.now() - 500;
    const oldTime = new Date(cutoff - 1000);
    const newTime = new Date(cutoff + 1000);
    utimesSync(oldFile, oldTime, oldTime);
    utimesSync(newFile, newTime, newTime);
    utimesSync(ignoredFile, newTime, newTime);

    expect(latestGeneratedImageForThread("thread-1", cutoff)).toBe(newFile);
    expect(latestGeneratedImageForThread("missing-thread", cutoff)).toBe("");
    expect(existsSync(newFile)).toBe(true);
  });

  it("query 可从落盘 job + generated_images 找回并导入图片", async () => {
    const root = path.join(os.tmpdir(), `nomi-codex-query-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    process.env.CODEX_HOME = root;
    const jobId = "codex-job-1";
    const threadId = "thread-query-1";
    const startedAt = Date.now() - 1000;
    const imageDir = path.join(root, "generated_images", threadId);
    const jobDir = path.join(root, "nomi_image_jobs");
    mkdirSync(imageDir, { recursive: true });
    mkdirSync(jobDir, { recursive: true });
    const imagePath = path.join(imageDir, "ig.png");
    writeFileSync(imagePath, "png");
    const imageTime = new Date(startedAt + 1000);
    utimesSync(imagePath, imageTime, imageTime);
    writeFileSync(path.join(jobDir, `${jobId}.json`), JSON.stringify({
      jobId,
      status: "running",
      prompt: "一张图",
      projectId: "proj",
      workDir: "",
      startedAt,
      updatedAt: startedAt,
      threadId,
      imagePath: "",
      localUrls: [],
      stdout: `{"type":"thread.started","thread_id":"${threadId}"}`,
      stderr: "",
      exitCode: null,
      error: "",
      request: { bin: "codex", args: ["exec"], prompt: "一张图", imageCount: 0 },
    }), "utf8");
    const writeAsset = () => ({ data: { url: "nomi-local://asset/proj/assets/codex.png" } });

    const { response } = await queryCodexImageOperation({ taskId: jobId, projectId: "proj", writeAsset });
    expect(response.gen_status).toBe("success");
    expect(response.submit_id).toBe(jobId);
    expect(response.video_url).toEqual(["nomi-local://asset/proj/assets/codex.png"]);
    const persisted = JSON.parse(readFileSync(path.join(jobDir, `${jobId}.json`), "utf8")) as { prompt?: string; stdout?: string; stderr?: string; request?: { prompt?: string } };
    expect(persisted.prompt).toBe("");
    expect(persisted.stdout).toBe("");
    expect(persisted.stderr).toBe("");
    expect(persisted.request?.prompt).toBe("");
  });
});
