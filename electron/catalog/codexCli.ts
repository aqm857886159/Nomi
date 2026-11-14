import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { JsonRecord } from "../jsonUtils";
import { contentTypeFromPath } from "../assets/assetPaths";
import { mcpClientPlatform, resolveMcpClientHostRoot } from "../shared/mcpClientRegistry";
import type { ProcessResponse, WriteAsset } from "./processOperation";
import { materializeAssetToPath, toUrlList } from "./dreaminaInputFiles";

type CodexFinishedOutput = { code: number; stdout: string; stderr: string };
type CodexSpawnInvocation = { command: string; args: string[] };

type CodexImageInput = {
  prompt: string;
  referenceImages?: unknown;
  projectId: string;
  writeAsset: WriteAsset;
};

type CodexImageQueryInput = {
  taskId: string;
  projectId: string;
  writeAsset: WriteAsset;
};

type CodexImageJobStatus = "queued" | "running" | "succeeded" | "failed";

type CodexImageJobRecord = {
  jobId: string;
  status: CodexImageJobStatus;
  prompt: string;
  projectId: string;
  workDir: string;
  startedAt: number;
  updatedAt: number;
  threadId: string;
  imagePath: string;
  localUrls: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: string;
  request: { bin: string; args: string[]; prompt: string; imageCount: number };
};

type LiveCodexJob = {
  child: ReturnType<typeof spawn>;
  record: CodexImageJobRecord;
};

const liveJobs = new Map<string, LiveCodexJob>();

/** nvm 各 node 版本的 bin 目录（新版本在前）——npm -g 在 nvm 机器上就落在这，静态表探不到。 */
function nvmBinDirs(home: string): string[] {
  const versionsDir = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => {
        const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
        const [a0, a1, a2] = parse(a);
        const [b0, b1, b2] = parse(b);
        return b0 - a0 || b1 - a1 || b2 - a2;
      })
      .map((version) => path.join(versionsDir, version, "bin"));
  } catch {
    return [];
  }
}

/** codex 全局安装的常见落点（npm -g → /usr/local/bin、/opt/homebrew/bin、nvm；pnpm/bun/volta 各有家目录）。 */
function codexInstallDirs(platform: NodeJS.Platform, home: string): string[] {
  if (platform === "win32") return [];
  return [
    path.join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(home, "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    platform === "darwin" ? path.join(home, "Library", "pnpm") : path.join(home, ".local", "share", "pnpm"),
    ...nvmBinDirs(home),
  ];
}

/** GUI Electron 的 PATH 极简（同 dreaminaCli 的坑）：mac 从 Finder 启动不含用户 shell PATH，
 *  裸 spawn("codex") 必 ENOENT——先探已知安装位拿绝对路径，探不到再回退裸名 + spawn 时补 PATH。 */
export function candidateCodexBins(platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string[] {
  if (platform === "win32") {
    return [
      process.env.CODEX_BIN || "",
      path.join(home, "AppData", "Local", "Microsoft", "WindowsApps", "codex.exe"),
      "codex.cmd",
      "codex.exe",
      "codex",
    ].filter(Boolean);
  }
  return [...codexInstallDirs(platform, home).map((dir) => path.join(dir, "codex")), "codex"];
}

export function resolveCodexBin(): string {
  const override = (process.env.CODEX_BIN || "").trim();
  if (override && existsSync(override)) return override;
  for (const candidate of candidateCodexBins()) {
    if (candidate.includes(path.sep) && existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

/** codex 子进程 env：把已知安装位并进 PATH 兜底（裸名回退时也能命中终端里装的 codex）。 */
export function buildCodexSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): NodeJS.ProcessEnv {
  const mergedPath = [...codexInstallDirs(platform, home), base.PATH || ""].filter(Boolean).join(path.delimiter);
  return { ...base, PATH: mergedPath };
}

function codexHome(): string {
  return resolveMcpClientHostRoot("codex", {
    platform: mcpClientPlatform(process.platform),
    env: process.env,
    homedir: os.homedir(),
    join: path.join,
  });
}

function generatedImagesDir(threadId: string): string {
  return path.join(codexHome(), "generated_images", threadId);
}

function codexJobsDir(): string {
  return path.join(codexHome(), "nomi_image_jobs");
}

function codexJobPath(jobId: string): string {
  return path.join(codexJobsDir(), `${jobId}.json`);
}

function persistJob(record: CodexImageJobRecord): void {
  try {
    mkdirSync(codexJobsDir(), { recursive: true });
    const persisted: CodexImageJobRecord = {
      ...record,
      prompt: "",
      stdout: "",
      stderr: "",
      request: { ...record.request, prompt: "" },
    };
    writeFileSync(codexJobPath(record.jobId), JSON.stringify(persisted, null, 2), "utf8");
  } catch {
    /* job persistence is best-effort; in-memory query still works */
  }
}

function readPersistedJob(jobId: string): CodexImageJobRecord | null {
  try {
    const raw = JSON.parse(readFileSync(codexJobPath(jobId), "utf8")) as CodexImageJobRecord;
    return raw && raw.jobId === jobId ? raw : null;
  } catch {
    return null;
  }
}

function patchJob(jobId: string, patch: Partial<CodexImageJobRecord>): CodexImageJobRecord | null {
  const live = liveJobs.get(jobId);
  const current = live?.record || readPersistedJob(jobId);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  if (live) live.record = next;
  persistJob(next);
  return next;
}

export function parseCodexThreadId(stdout: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const item = JSON.parse(trimmed) as JsonRecord;
      if (item.type === "thread.started" && typeof item.thread_id === "string") return item.thread_id;
    } catch {
      /* ignore non-event lines */
    }
  }
  return "";
}

export function latestGeneratedImageForThread(threadId: string, notBeforeMs = 0): string {
  const dir = generatedImagesDir(threadId);
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const mtimeMs = existsSync(fullPath) ? statSync(fullPath).mtimeMs : 0;
      return { fullPath, mtimeMs };
    })
    .filter((item) => item.mtimeMs >= notBeforeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.fullPath || "";
}

// 两个哨兵必须分开（2026-07-31 群反馈根因）：codex 的 imagegen 工具**调用失败**时是把
// "image generation failed: <上游错误>" 当文本喂回模型，和「工具根本不存在」在模型侧长得一样。
// 单哨兵会让限流/额度失败被折叠成「未启用生图能力」——用户刚成功过一张、下一张就被指去改
// 一个 Nomi 自己已经传了的 CLI flag。拆开后：不存在 → UNAVAILABLE；调用失败 → ERROR + 原话透传。
export function buildCodexImagePrompt(prompt: string, hasReferenceImages = false): string {
  return [
    hasReferenceImages ? "必须使用 $imagegen 基于附件图片生成一张真实图片。" : "必须使用 $imagegen 生成一张真实图片。",
    "禁止使用 PowerShell、Python、SVG、HTML、canvas、System.Drawing、ImageMagick、占位图或任何脚本/代码自己画图。",
    "如果本会话根本没有 $imagegen 工具可用，只回复 FAIL_IMAGEGEN_UNAVAILABLE。",
    "如果 $imagegen 调用了但报错失败，只回复 FAIL_IMAGEGEN_ERROR: 并原样附上收到的完整错误信息，不要改写、不要翻译。",
    "图片需求：",
    prompt.trim(),
  ].join("\n");
}

function quoteWindowsCmdArg(arg: string): string {
  if (!arg) return "\"\"";
  return `"${arg.replace(/"/g, "\\\"")}"`;
}

function needsCmdWrapper(bin: string, platform = process.platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(bin);
}

export function buildCodexSpawnInvocation(bin: string, args: string[], platform = process.platform): CodexSpawnInvocation {
  if (!needsCmdWrapper(bin, platform)) return { command: bin, args };
  const commandLine = [quoteWindowsCmdArg(bin), ...args.map(quoteWindowsCmdArg)].join(" ");
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
  };
}

/** 生图调用失败的上游原话：FAIL_IMAGEGEN_ERROR 哨兵优先；模型没守哨兵时退回 codex
 *  imagegen 工具喂给模型的固定前缀 `image generation failed:`（源码 ext/image-generation/tool.rs）。
 *  stdout 是 JSONL，原话嵌在 agent_message 的 JSON 字符串里——遇引号/换行即止。 */
export function extractImagegenUpstreamError(text: string): string {
  const sentinel = text.match(/FAIL_IMAGEGEN_ERROR[:：]\s*([^"\n]{2,300})/i);
  const toolEcho = text.match(/image generation failed[:：]\s*([^"\n]{2,300})/i);
  return (sentinel?.[1] || toolEcho?.[1] || "").replace(/\\+$/, "").trim();
}

/** 上游原话是否指向限流/额度（ChatGPT 登录额度耗尽是 codex 生图最常见的确定性失败）。 */
function isQuotaLikeError(text: string): boolean {
  return /429|rate.?limit|too many request|quota|insufficient|limit (?:reached|exceeded)|usage cap|请求过于频繁|限流|额度/i.test(text);
}

export function describeCodexFailure(ran: CodexFinishedOutput, threadId: string): string {
  const text = `${ran.stdout}\n${ran.stderr}`;
  // ① 工具调用失败：透传上游原话（英文原话进文案 → 渲染层 classifyError 按 429/quota 等
  //    信号自动归类到「配额或限流·稍等重试」，不再误标成能力问题）。
  const upstream = extractImagegenUpstreamError(text);
  if (upstream) {
    return isQuotaLikeError(upstream)
      ? `Codex 生图被上游限流或登录额度暂时用尽：${upstream}。稍等几分钟重试，或换其他生图模型。`
      : `Codex 生图调用失败：${upstream}`;
  }
  // ② 工具真不存在（实测 --disable image_generation 时模型只回这个哨兵）。别再指引用户加
  //    --enable flag——Nomi 启动 codex 时本来就传了它，且新版 codex 该功能已默认开启；
  //    还会走到这里 = 本机 codex 太旧或账号不支持，可行动的只有升级/换模型。
  if (/FAIL_IMAGEGEN_UNAVAILABLE|unknown feature.*image_generation|image_generation.*false/i.test(text)) {
    return "本机 Codex CLI 生图工具不可用：多半是 Codex 版本过旧或登录账号不支持图片生成。请在终端升级后重试（npm i -g @openai/codex@latest），或换其他生图模型。";
  }
  if (/unknown variant `default`.*service_tier/i.test(text)) {
    return "Codex 配置里的 service_tier=default 与当前 CLI 不兼容；Nomi 已尝试用 fast 覆盖，但本机配置仍需清理。";
  }
  // 「auth」裸词会误吞 author/OAuth 这类良性输出，只认登录态的明确签名。
  if (/not logged in|login required|codex login|unauthorized|401/i.test(text)) {
    return "Codex CLI 未登录或登录态失效，请先在终端运行 codex login。";
  }
  if (!threadId) return "Codex CLI 没有返回 thread.started 事件，无法定位 generated_images 输出目录。";
  return "Codex CLI 未产生可导入的生图文件。";
}

// 落盘前的解码校验是异步的：两次并发查询同一个任务，第二次在第一次还没 patchJob 时就会再导一份（项目里多出 `-2`）。
// 同一任务的导入只跑一次，后来的查询等同一个结果。
const importsInFlight = new Map<string, Promise<string[]>>();

function importCodexImage(record: CodexImageJobRecord, input: CodexImageQueryInput): Promise<string[]> {
  const inFlight = importsInFlight.get(record.jobId);
  if (inFlight) return inFlight;
  const started = importCodexImageOnce(record, input).finally(() => importsInFlight.delete(record.jobId));
  importsInFlight.set(record.jobId, started);
  return started;
}

async function importCodexImageOnce(record: CodexImageJobRecord, input: CodexImageQueryInput): Promise<string[]> {
  if (record.localUrls.length) return record.localUrls;
  if (!record.imagePath || !existsSync(record.imagePath)) return [];
  // 进程执行器没项目号就不起进程（processOperation），这里一定有项目：本机生图只经生成产物关口写进项目。
  const localUrls: string[] = [];
  const threadPart = (record.threadId || record.jobId).slice(0, 8);
  const fileName = `codex-image-${threadPart}${path.extname(record.imagePath) || ".png"}`;
  const written = await input.writeAsset(
    input.projectId,
    readFileSync(record.imagePath),
    fileName,
    contentTypeFromPath(record.imagePath),
    { kind: "generated", provider: "codex-local", originalPath: record.imagePath },
    "image",
  ) as { data?: { url?: string } };
  const url = String(written.data?.url || "");
  if (url) localUrls.push(url);
  if (localUrls.length) patchJob(record.jobId, { localUrls });
  return localUrls;
}

function toProcessResponse(record: CodexImageJobRecord, genStatus: string, urls: string[] = []): ProcessResponse {
  return {
    submit_id: record.jobId,
    gen_status: genStatus,
    fail_reason: record.error,
    queue_info: record.threadId ? { thread_id: record.threadId } : null,
    video_url: urls,
    _stdout: record.stdout,
    _stderr: record.stderr,
  };
}

function markJobFailed(jobId: string, error: string): void {
  patchJob(jobId, { status: "failed", error });
}

export async function startCodexImageOperation(input: CodexImageInput): Promise<{ response: ProcessResponse; request: unknown }> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nomi-codex-image-"));
  mkdirSync(workDir, { recursive: true });
  const lastMessagePath = path.join(workDir, "last-message.txt");
  const startedAt = Date.now() - 1000;
  const imagePaths: string[] = [];
  for (const url of toUrlList(input.referenceImages)) {
    const { filePath } = await materializeAssetToPath(url, input.projectId, workDir);
    if (filePath) imagePaths.push(filePath);
  }
  const args = [
    "-c", "service_tier='fast'",
    "--enable", "image_generation",
    "--ask-for-approval", "never",
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox", "workspace-write",
    "--skip-git-repo-check",
    "-C", workDir,
    "-o", lastMessagePath,
    ...imagePaths.flatMap((imagePath) => ["-i", imagePath]),
    "-",
  ];
  const bin = resolveCodexBin();
  const request = { bin: path.basename(bin), args: args.slice(0, -1), prompt: input.prompt, imageCount: imagePaths.length };
  const jobId = `codex-${randomUUID()}`;
  const record: CodexImageJobRecord = {
    jobId,
    status: "queued",
    prompt: input.prompt,
    projectId: input.projectId,
    workDir,
    startedAt,
    updatedAt: Date.now(),
    threadId: "",
    imagePath: "",
    localUrls: [],
    stdout: "",
    stderr: "",
    exitCode: null,
    error: "",
    request,
  };
  persistJob(record);

  const invocation = buildCodexSpawnInvocation(bin, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: workDir,
    windowsHide: true,
    windowsVerbatimArguments: needsCmdWrapper(bin),
    env: buildCodexSpawnEnv(),
  });
  liveJobs.set(jobId, { child, record });
  patchJob(jobId, { status: "running" });

  const absorbOutput = (key: "stdout" | "stderr", chunk: unknown) => {
    const live = liveJobs.get(jobId);
    const current = live?.record || readPersistedJob(jobId);
    if (!current) return;
    const text = current[key] + String(chunk);
    const threadId = current.threadId || parseCodexThreadId(key === "stdout" ? text : current.stdout);
    const imagePath = threadId ? latestGeneratedImageForThread(threadId, startedAt) : "";
    patchJob(jobId, {
      [key]: text,
      ...(threadId ? { threadId } : {}),
      ...(imagePath ? { imagePath } : {}),
    } as Partial<CodexImageJobRecord>);
  };

  child.stdout?.on("data", (chunk) => { absorbOutput("stdout", chunk); });
  child.stderr?.on("data", (chunk) => { absorbOutput("stderr", chunk); });
  // .end(prompt) 的写入在流上异步完成：codex 进程 spawn 失败/秒死时，EPIPE 会在 stdin 流上异步
  // emit 'error'——try/catch 接不住，没挂监听就是主进程 uncaughtException（同族现场见
  // capabilityCore/mcpVerify.stdinError.test.ts）。真实故障由下面 'error'/'close' 如实上报。
  child.stdin?.on("error", () => { /* 流级回声，判定权在 child 的 error/close */ });
  child.stdin?.end(buildCodexImagePrompt(input.prompt, imagePaths.length > 0));
  child.on("error", (error) => {
    // ENOENT = 机器上定位不到 codex（GUI PATH 极简 + 安装位不在候选表）——给人话指引而不是裸报 spawn 错。
    const failure = (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "未找到 Codex CLI（codex）。请确认本机已安装并登录（npm i -g @openai/codex 后运行 codex login），或设置 CODEX_BIN 指向可执行文件。"
      : error.message || String(error);
    markJobFailed(jobId, failure);
    liveJobs.delete(jobId);
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });
  child.on("close", (code) => {
    const current = liveJobs.get(jobId)?.record || readPersistedJob(jobId) || record;
    const threadId = current.threadId || parseCodexThreadId(current.stdout);
    const imagePath = threadId ? latestGeneratedImageForThread(threadId, startedAt) : "";
    const ran = { code: code ?? -1, stdout: current.stdout, stderr: current.stderr };
    patchJob(jobId, {
      status: imagePath ? "succeeded" : "failed",
      exitCode: code ?? -1,
      ...(threadId ? { threadId } : {}),
      ...(imagePath ? { imagePath } : {}),
      error: imagePath ? "" : describeCodexFailure(ran, threadId),
    });
    liveJobs.delete(jobId);
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  const queued = readPersistedJob(jobId) || record;
  return { response: toProcessResponse(queued, "queued"), request };
}

export async function queryCodexImageOperation(input: CodexImageQueryInput): Promise<{ response: ProcessResponse; request: unknown }> {
  const jobId = input.taskId.trim();
  const live = liveJobs.get(jobId);
  const record = live?.record || readPersistedJob(jobId);
  if (!record) {
    const missing: CodexImageJobRecord = {
      jobId,
      status: "failed",
      prompt: "",
      projectId: input.projectId,
      workDir: "",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      threadId: "",
      imagePath: "",
      localUrls: [],
      stdout: "",
      stderr: "",
      exitCode: null,
      error: "找不到 Codex 本地生图任务记录，无法重新拉取。请重新生成。",
      request: { bin: path.basename(resolveCodexBin()), args: [], prompt: "", imageCount: 0 },
    };
    return { response: toProcessResponse(missing, "fail"), request: missing.request };
  }

  const threadId = record.threadId || parseCodexThreadId(record.stdout);
  const imagePath = threadId ? latestGeneratedImageForThread(threadId, record.startedAt) : "";
  const refreshed = patchJob(jobId, {
    ...(threadId ? { threadId } : {}),
    ...(imagePath ? { imagePath, status: "succeeded", error: "" } : {}),
  }) || record;
  if (imagePath || refreshed.imagePath) {
    const withImage = { ...refreshed, imagePath: imagePath || refreshed.imagePath, status: "succeeded" as const, error: "" };
    const urls = await importCodexImage(withImage, input);
    return { response: toProcessResponse(withImage, "success", urls), request: withImage.request };
  }

  if (refreshed.status === "failed") {
    return { response: toProcessResponse(refreshed, "fail"), request: refreshed.request };
  }

  if (!live) {
    const failed = patchJob(jobId, {
      status: "failed",
      error: "Codex 本地生图进程已不在运行，且尚未发现生成图片；可能是应用重启或进程退出导致。请重新生成。",
    }) || refreshed;
    return { response: toProcessResponse(failed, "fail"), request: failed.request };
  }

  return { response: toProcessResponse(refreshed, "generating"), request: refreshed.request };
}
