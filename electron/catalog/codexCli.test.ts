import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCodexImagePrompt, buildCodexSpawnEnv, buildCodexSpawnInvocation, candidateCodexBins, describeCodexFailure, extractCodexImageArtifacts, extractImagegenUpstreamError, latestGeneratedImageForThread, parseCodexThreadId, queryCodexImageOperation, resolveCodexGeneratedImage } from "./codexCli";

const envSnapshot = { ...process.env };
const tempRoots: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) vi.stubEnv(key, undefined);
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

  it("mac 候选表探真实安装位（GUI PATH 极简，裸 spawn 必 ENOENT）：静态位 + nvm 版本目录，末位裸名兜底", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-bins-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    const nvmBin = path.join(root, ".nvm", "versions", "node", "v24.13.1", "bin");
    const nvmBinOld = path.join(root, ".nvm", "versions", "node", "v9.2.0", "bin");
    mkdirSync(nvmBin, { recursive: true });
    mkdirSync(nvmBinOld, { recursive: true });

    const candidates = candidateCodexBins("darwin", root);
    // 静态位断言用 path.join 按宿主分隔符算：实现的 join 在 Windows 宿主产反斜杠，
    // 写死 "/opt/.../codex" 字面量会让社区贡献者在 Windows 上全量测试恒红（PR#55 作者报）。
    expect(candidates).toContain(path.join("/opt/homebrew/bin", "codex"));
    expect(candidates).toContain(path.join("/usr/local/bin", "codex"));
    expect(candidates).toContain(path.join(root, ".local", "bin", "codex"));
    // nvm 各版本 bin 都在候选里，且数值降序（v24 在 v9 前，不许按字典序）
    const nvmIdx = candidates.indexOf(path.join(nvmBin, "codex"));
    const nvmOldIdx = candidates.indexOf(path.join(nvmBinOld, "codex"));
    expect(nvmIdx).toBeGreaterThan(-1);
    expect(nvmOldIdx).toBeGreaterThan(nvmIdx);
    // 裸名兜底恒在末位
    expect(candidates[candidates.length - 1]).toBe("codex");
  });

  it("spawn env 把安装位并进 PATH（裸名回退时也能命中终端里装的 codex）", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-env-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    const env = buildCodexSpawnEnv({ PATH: "/usr/bin" }, "darwin", root);
    const dirs = String(env.PATH).split(path.delimiter);
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs[dirs.length - 1]).toBe("/usr/bin");
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

  it("提示词把「工具不存在」与「调用失败」拆成两个哨兵（失败要原样带上游错误）", () => {
    const prompt = buildCodexImagePrompt("一张图");
    expect(prompt).toContain("FAIL_IMAGEGEN_UNAVAILABLE");
    expect(prompt).toContain("FAIL_IMAGEGEN_ERROR:");
    expect(prompt).toContain("原样附上");
  });

  it("从 JSONL 事件里抠出生图上游错误原话：哨兵优先，tool 回显兜底", () => {
    const sentinelLine = "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"FAIL_IMAGEGEN_ERROR: image generation failed: 429 Too Many Requests\"}}";
    expect(extractImagegenUpstreamError(sentinelLine)).toBe("image generation failed: 429 Too Many Requests");
    const echoLine = "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"抱歉，image generation failed: content policy violation\"}}";
    expect(extractImagegenUpstreamError(echoLine)).toBe("content policy violation");
    expect(extractImagegenUpstreamError("{\"type\":\"turn.completed\"}")).toBe("");
  });

  it("限流/额度类调用失败：透传原话并给「稍等重试」话术，不再误标成能力未启用", () => {
    const ran = {
      code: 0,
      stdout: "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"FAIL_IMAGEGEN_ERROR: image generation failed: 429 rate limit exceeded\"}}",
      stderr: "",
    };
    const message = describeCodexFailure(ran, "thread-1");
    expect(message).toContain("限流");
    expect(message).toContain("429 rate limit exceeded");
    expect(message).not.toContain("--enable");
    expect(message).not.toContain("未启用生图能力");
  });

  it("非限流类调用失败：原话透传（渲染层 classifyError 按信号词自行归类）", () => {
    const ran = {
      code: 0,
      stdout: "{\"item\":{\"type\":\"agent_message\",\"text\":\"FAIL_IMAGEGEN_ERROR: image generation failed: content policy violation\"}}",
      stderr: "",
    };
    const message = describeCodexFailure(ran, "thread-1");
    expect(message).toContain("Codex 生图调用失败");
    expect(message).toContain("content policy violation");
  });

  it("工具真不存在（UNAVAILABLE 哨兵）：指引升级/换模型，不再让用户去加 Nomi 本就传了的 --enable flag", () => {
    const ran = {
      code: 0,
      stdout: "{\"item\":{\"type\":\"agent_message\",\"text\":\"FAIL_IMAGEGEN_UNAVAILABLE\"}}",
      stderr: "",
    };
    const message = describeCodexFailure(ran, "thread-2");
    expect(message).toContain("升级");
    expect(message).not.toContain("--enable");
  });

  it("登录态判定收窄：良性输出里的 author/OAuth 字样不再被误判成未登录", () => {
    const benign = { code: 1, stdout: "{\"item\":{\"type\":\"error\",\"message\":\"Skill authored by OAuth plugin was shortened\"}}", stderr: "" };
    expect(describeCodexFailure(benign, "thread-3")).toBe("Codex CLI 未产生可导入的生图文件。");
    const loggedOut = { code: 1, stdout: "", stderr: "Not logged in. Please run codex login first." };
    expect(describeCodexFailure(loggedOut, "")).toContain("codex login");
  });

  it("带参考图时提示词要求基于附件图片生成", () => {
    const prompt = buildCodexImagePrompt("把它改成蓝色", true);
    expect(prompt).toContain("基于附件图片");
    expect(prompt).toContain("把它改成蓝色");
  });

  it("只从当前 thread 的 generated_images 目录取新生成图片", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    vi.stubEnv("CODEX_HOME", root);
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

  it("CODEX_HOME 未设置时沿用 ~/.codex", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-default-home-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    vi.stubEnv("HOME", root);
    vi.stubEnv("CODEX_HOME", undefined);
    const imageDir = path.join(root, ".codex", "generated_images", "thread-default");
    mkdirSync(imageDir, { recursive: true });
    const imagePath = path.join(imageDir, "default.png");
    writeFileSync(imagePath, "png");

    expect(latestGeneratedImageForThread("thread-default")).toBe(imagePath);
  });

  it("CODEX_HOME 为空字符串时仍沿用 ~/.codex", () => {
    const root = path.join(os.tmpdir(), `nomi-codex-empty-home-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    vi.stubEnv("HOME", root);
    vi.stubEnv("CODEX_HOME", "");
    const imageDir = path.join(root, ".codex", "generated_images", "thread-empty");
    mkdirSync(imageDir, { recursive: true });
    const imagePath = path.join(imageDir, "empty.png");
    writeFileSync(imagePath, "png");

    expect(latestGeneratedImageForThread("thread-empty")).toBe(imagePath);
  });

  it("query 可从落盘 job + generated_images 找回并导入图片", async () => {
    const root = path.join(os.tmpdir(), `nomi-codex-query-test-${Date.now()}-${process.pid}`);
    tempRoots.push(root);
    vi.stubEnv("CODEX_HOME", root);
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
    const writeAsset = async () => ({ data: { url: "nomi-local://asset/proj/assets/codex.png" } });

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

  // ── NF-1025-0001 回归矩阵：Codex 产图发现（JSONL saved_path / 嵌套目录 / workDir / 内联 base64）与真实失败透传 ──
  describe("NF-1025-0001 · Codex 产图发现与失败原因透传矩阵", () => {
    const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

    const CODEX_ARTIFACT_DISCOVERY_MATRIX = [
      {
        label: "JSONL ImageGenerationItem.saved_path 指向自定义位置 → 找回并暂存，不报未产出",
        setup: (root: string, workDir: string) => {
          const out = path.join(workDir, "rendered-output.png");
          writeFileSync(out, TINY_PNG);
          const stdout = JSON.stringify({
            type: "item.completed",
            item: { type: "image_generation", status: "completed", saved_path: out },
          });
          return { stdout, inputImagePaths: [] as string[], expectedCopyOutsideWorkDir: true };
        },
      },
      {
        label: "generated_images/<threadId> 嵌套子目录中的生成图 → 递归发现",
        setup: (root: string) => {
          const nestedDir = path.join(root, "generated_images", "thread-matrix", "batch-1");
          mkdirSync(nestedDir, { recursive: true });
          writeFileSync(path.join(nestedDir, "nested.png"), TINY_PNG);
          return { stdout: "", inputImagePaths: [] as string[], expectedCopyOutsideWorkDir: false };
        },
      },
      {
        label: "Codex 把生成图移动/保存到 workDir（排除参考输入图）→ 清理 workDir 前收进持久化目录",
        setup: (_root: string, workDir: string) => {
          const refIn = path.join(workDir, "ref-input.png");
          const generatedOut = path.join(workDir, "final-art.png");
          writeFileSync(refIn, TINY_PNG);
          writeFileSync(generatedOut, TINY_PNG);
          return { stdout: "", inputImagePaths: [refIn], expectedCopyOutsideWorkDir: true };
        },
      },
      {
        label: "JSONL ImageGenerationItem 仅带内联 base64 result（无磁盘文件）→ 核验 PNG 魔数后落盘找回",
        setup: () => {
          const stdout = JSON.stringify({
            type: "item.completed",
            item: { type: "image_generation", status: "completed", result: TINY_PNG.toString("base64") },
          });
          return { stdout, inputImagePaths: [] as string[], expectedCopyOutsideWorkDir: true };
        },
      },
    ] as const;

    it.each(CODEX_ARTIFACT_DISCOVERY_MATRIX)("$label", ({ setup }) => {
      const root = path.join(os.tmpdir(), `nomi-codex-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const workDir = path.join(os.tmpdir(), `nomi-codex-work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      tempRoots.push(root, workDir);
      mkdirSync(root, { recursive: true });
      mkdirSync(workDir, { recursive: true });
      vi.stubEnv("CODEX_HOME", root);

      const startedAt = Date.now() - 1000;
      const { stdout, inputImagePaths, expectedCopyOutsideWorkDir } = setup(root, workDir);
      const resolved = resolveCodexGeneratedImage({
        jobId: "codex-matrix-job",
        threadId: "thread-matrix",
        stdout,
        workDir,
        inputImagePaths,
        startedAt,
      });
      expect(resolved).not.toBe("");
      expect(existsSync(resolved)).toBe(true);
      expect(readFileSync(resolved).subarray(0, 4)).toEqual(TINY_PNG.subarray(0, 4));
      if (expectedCopyOutsideWorkDir) {
        // 即使随即清理 workDir，持久化后的图片仍可读
        rmSync(workDir, { recursive: true, force: true });
        expect(existsSync(resolved)).toBe(true);
      }
    });

    it("extractCodexImageArtifacts 忽略非图片的伪 result 文本，不把报错文本误落成图", () => {
      const stdout = JSON.stringify({
        type: "item.completed",
        item: { type: "image_generation", status: "failed", result: Buffer.from("not an image").toString("base64") },
      });
      const artifacts = extractCodexImageArtifacts(stdout);
      expect(artifacts.savedPaths).toEqual([]);
      expect(artifacts.inlineImages).toEqual([]);
    });

    const CODEX_FAILURE_DISCOVERY_MATRIX = [
      {
        label: "顶层 turn.failed 额度用尽 → 透传真实原因并归限流/额度提示，不吞成黑盒未产出",
        ran: {
          code: 1,
          stdout: JSON.stringify({ type: "turn.failed", error: { message: "usage_limit_reached: You have reached your Plus usage limit" } }),
          stderr: "",
        },
        threadId: "thread-f1",
        mustContain: ["限流", "usage_limit_reached"],
      },
      {
        label: "顶层 type=error 服务端报错 → 透传上游错误原文",
        ran: {
          code: 1,
          stdout: JSON.stringify({ type: "error", message: "model_not_found: image generation model unavailable" }),
          stderr: "",
        },
        threadId: "thread-f2",
        mustContain: ["Codex 生图调用失败", "model_not_found"],
      },
      {
        label: "模型在 agent_message 拒答但没带哨兵前缀 → 附带模型回复内容供排查",
        ran: {
          code: 0,
          stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I cannot generate images depicting real public figures." } }),
          stderr: "",
        },
        threadId: "thread-f3",
        mustContain: ["Codex CLI 未产生可导入的生图文件", "real public figures"],
      },
      {
        label: "非零退出且 stderr 有错误输出 → 透传退出码与 stderr 摘要",
        ran: {
          code: 2,
          stdout: "",
          stderr: "error: unexpected argument '--bad-flag' found",
        },
        threadId: "thread-f4",
        mustContain: ["退出码 2", "unexpected argument '--bad-flag'"],
      },
    ] as const;

    it.each(CODEX_FAILURE_DISCOVERY_MATRIX)("$label", ({ ran, threadId, mustContain }) => {
      const msg = describeCodexFailure(ran, threadId);
      for (const piece of mustContain) expect(msg).toContain(piece);
    });
  });
});
