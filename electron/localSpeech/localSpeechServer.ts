/**
 * 本地转写 —— sidecar 进程的生命周期与 `/inference` 调用。
 *
 * ## 为什么起一个常驻进程、而不是每段跑一次 CLI
 *
 * whisper 的启动成本几乎全在**把权重读进显存/内存**（默认档 574 MB，冷启实测 ~10 秒）。
 * 一条 8 分钟的视频会切成两段、半小时的切成六段——按 CLI 跑就是把这 10 秒乘上段数。
 * 常驻 server 把模型热在内存里，段与段之间只花推理时间。这也是近邻项目（OpenWhispr）
 * 的选型，它的 `src/helpers/whisperServer.js` 就是 spawn + 本机随机端口 + POST `/inference`。
 *
 * ## 三条边界
 *
 * 1. **只听回环**：`--host 127.0.0.1` + 端口由 OS 分配。不听 0.0.0.0——那等于在用户机器上
 *    开了一个任何局域网设备都能喂音频的转写服务。
 * 2. **一次任务一个进程，`finally` 里一定收**：不做进程池、不保温。转写是批处理不是听写，
 *    保温省下的那几秒换不来「用户关掉窗口后后台还留着一个吃 600 MB 内存的进程」。
 * 3. **出站仍走 `hardenedFetch`**：回环也是网络，目的地策略只有一个 owner。`allowedPrivateOrigins`
 *    精确到 `http://127.0.0.1:<port>`，且这条路径下 hardenedFetch 强制禁止重定向。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import crypto from "node:crypto";
import { hardenedFetch } from "../hardenedFetch";
import { logInfo, logWarn } from "../logging/logger";
import { localSpeechFailure } from "./localSpeechErrors";

/** 起进程后最多等这么久才认为它没起来（冷启要读几百 MB 权重，给足）。 */
const START_TIMEOUT_MS = 120_000;
/** 单段推理的上限。5 分钟音频在最慢的纯 CPU 路径上也该在这之内收敛。 */
const INFERENCE_TIMEOUT_MS = 30 * 60_000;
const HEALTH_POLL_MS = 250;

export type LocalSpeechRawSegment = { start: number; end: number; text: string };
export type LocalSpeechInferenceResult = {
  segments: LocalSpeechRawSegment[];
  /** 引擎自己检测到的语言（硬约束②：以音频检测为准，不是 UI 语言）。 */
  detectedLanguage: string;
  detectedLanguageProbability: number;
};

/** 让 OS 挑一个空闲端口再立刻还回去——比「随机数 + 撞了重试」少一整类 flake。 */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

/**
 * sidecar 的启动参数（纯函数，好让「必须开 VAD」「语言必须 auto」这两条不变量由测试盯着，
 * 而不是靠读一遍 spawn 那行代码——能让门岗拦的别留给人，R17）。
 */
export function buildServerArgs(input: { modelPath: string; vadModelPath: string; port: number }): string[] {
  // 线程数取可用核数的一半、夹在 [2, 8]：留一半给 ffmpeg 切片与 UI，别把整机吃满。
  const threads = Math.min(8, Math.max(2, Math.floor((os.cpus()?.length || 4) / 2)));
  return [
    "-m", input.modelPath,
    "--host", "127.0.0.1",
    "--port", String(input.port),
    "-t", String(threads),
    // 默认语言也写 auto：请求里还会再带一次，但 CLI 默认值是 `en`，
    // 万一哪天请求字段名变了，兜底也必须是「自动检测」而不是「当英文处理」（硬约束①②）。
    "-l", "auto",
    // VAD 常开，没有开关（硬约束④）。它先把非语音段摘掉再送解码，一次解决两件事：
    // ① 静音上的幻听与由它引发的复读（那会吞掉后面的真人讲话）；
    // ② 语言探测只取最前面 30 秒——片头留空时那 30 秒是静音，等于拿空气判断说的是哪国话。
    "--vad",
    "--vad-model", input.vadModelPath,
  ];
}

export class LocalSpeechServer {
  private child: ChildProcess | null = null;
  private stderrTail = "";
  readonly port: number;
  readonly origin: string;

  private constructor(port: number) {
    this.port = port;
    this.origin = `http://127.0.0.1:${port}`;
  }

  /**
   * 起进程并等到它真的能应答。**等的是「健康检查通过」，不是 sleep 一个拍脑袋的秒数**——
   * 冷热盘差十倍，固定等待要么白等要么在慢机器上假失败。
   */
  static async start(input: { executablePath: string; modelPath: string; vadModelPath: string; signal?: AbortSignal }): Promise<LocalSpeechServer> {
    const port = await pickFreePort().catch((error: unknown) => {
      throw localSpeechFailure("engine-start-failed", error instanceof Error ? error.message : String(error));
    });
    const server = new LocalSpeechServer(port);
    const args = buildServerArgs({ modelPath: input.modelPath, vadModelPath: input.vadModelPath, port });
    const child = spawn(input.executablePath, args, { windowsHide: true });
    server.child = child;
    child.stderr?.on("data", (chunk) => {
      server.stderrTail = `${server.stderrTail}${String(chunk)}`.slice(-2000);
    });
    child.stdout?.on("data", (chunk) => {
      server.stderrTail = `${server.stderrTail}${String(chunk)}`.slice(-2000);
    });

    let exited: { code: number | null } | null = null;
    child.on("error", (error) => {
      server.stderrTail = `${server.stderrTail}\n${error.message}`.slice(-2000);
      exited = { code: null };
    });
    child.on("exit", (code) => {
      exited = { code };
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (input.signal?.aborted) {
        server.stop();
        throw localSpeechFailure("cancelled", "engine-start");
      }
      if (exited) {
        server.stop();
        throw localSpeechFailure("engine-start-failed", server.stderrTail.trim().slice(-300) || "engine exited during startup");
      }
      if (await server.healthy()) {
        // 日志报的就是真正传出去的那份参数（不另算一遍 threads——那会变成第二个真相源，
        // 也正是这次抽函数时留下悬空引用的地方）。
        logInfo("local-speech", "engine-started", { port, threads: args[args.indexOf("-t") + 1], vad: args.includes("--vad") });
        return server;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
    server.stop();
    throw localSpeechFailure("engine-start-failed", `timed out after ${START_TIMEOUT_MS}ms: ${server.stderrTail.trim().slice(-200)}`);
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await hardenedFetch(this.origin, {
        timeoutMs: 2_000,
        allowedPrivateOrigins: [this.origin],
        throwOnNon2xx: false,
        maxBytes: 64 * 1024,
      });
      return response.status > 0;
    } catch {
      return false;
    }
  }

  /** 把一段 wav 打过去。`language=auto` 是硬约束①②的执行点，**不接受调用方覆盖**。 */
  async transcribeWav(wavPath: string, signal?: AbortSignal): Promise<LocalSpeechInferenceResult> {
    const bytes = fs.readFileSync(wavPath);
    const boundary = `----nomi${crypto.randomUUID().replace(/-/g, "")}`;
    const body = buildMultipartBody(boundary, bytes);
    const response = await hardenedFetch(`${this.origin}/inference`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      timeoutMs: INFERENCE_TIMEOUT_MS,
      maxBytes: 64 * 1024 * 1024,
      allowedPrivateOrigins: [this.origin],
      throwOnNon2xx: false,
      signal,
    });
    if (response.status < 200 || response.status >= 300) {
      throw localSpeechFailure("chunk-failed", `HTTP ${response.status}: ${response.bytes.toString("utf8").slice(0, 200)}`);
    }
    return parseInferenceResponse(response.bytes.toString("utf8"));
  }

  /** 收进程。调用方必须放在 `finally` 里——留一个吃几百 MB 的孤儿进程比转写失败还糟。 */
  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch (error) {
      logWarn("local-speech", "engine-stop-failed", { reason: error instanceof Error ? error.message : String(error) });
    }
  }
}

/**
 * 手搓 multipart：只有一个文件字段加三个文本字段，形状固定。
 * 为什么不用 web `FormData` —— 那要经 `appFetch` 那条不过目的地策略的裸出口才发得出去
 * （`check:outbound-policy` 规则 2 盯着谁能 import 它），为了三个字段去多开一个出站口不划算。
 */
export function buildMultipartBody(boundary: string, wavBytes: Uint8Array): Buffer {
  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8");
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      "utf8",
    ),
    Buffer.from(wavBytes),
    Buffer.from("\r\n", "utf8"),
    // language=auto：语言从音频检测，**不从 UI locale 派生**（用户 2026-09-17 硬约束）。
    field("language", "auto"),
    // verbose_json：与云端 whisper 的同名格式同形状，所以上层解析器一份就够（P1）。
    field("response_format", "verbose_json"),
    // temperature=0：同一段音频每次跑出同样的字，否则「重试一次」会变成掷骰子。
    field("temperature", "0.0"),
    Buffer.from(`--${boundary}--\r\n`, "utf8"),
  ]);
}

/**
 * 解 `/inference` 的 verbose_json。
 * **空结果不当成功**：没有 `segments` 字段（而不是「有但为空」）说明形状不对，直接抛——
 * 静默返回空数组会让用户对着一列空白的对白猜（硬约束：不许静默空结果）。
 */
export function parseInferenceResponse(text: string): LocalSpeechInferenceResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw localSpeechFailure("chunk-failed", `unparsable response: ${text.slice(0, 160)}`);
  }
  const record = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const rawSegments = record.segments;
  if (!Array.isArray(rawSegments)) {
    throw localSpeechFailure("chunk-failed", `response has no segments: ${text.slice(0, 160)}`);
  }
  const segments: LocalSpeechRawSegment[] = [];
  for (const item of rawSegments) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const start = Number(entry.start);
    const end = Number(entry.end);
    const segmentText = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!Number.isFinite(start) || !segmentText) continue;
    segments.push({ start, end: Number.isFinite(end) ? end : start, text: segmentText });
  }
  return {
    segments,
    detectedLanguage: typeof record.detected_language === "string" ? record.detected_language : String(record.language || ""),
    detectedLanguageProbability: Number(record.detected_language_probability) || 0,
  };
}
