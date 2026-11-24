// 即梦官方 dreamina CLI 的二进制定位 + spawn 封装（IO 层；纯解析在 dreaminaCodec.ts）。
// processOperation（生成）与登录 IPC（设备码登录/积分自检/退登）共用这一份 spawn，避免两处各搓一遍。
//
// 关键坑：GUI 版 Electron 的 PATH 极简（不含用户 shell 的 ~/.local/bin），而官方安装脚本默认把
// dreamina 装到 ~/.local/bin。所以定位要兜底常见安装位 + spawn 时补 PATH，否则「终端能跑、App 里找不到」。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopT } from "../desktopStrings";
import { retryWithBackoff } from "../shared/retryPolicy";

/** dreamina 可能的安装位（官方脚本默认 ~/.local/bin；homebrew/手动放 /usr/local/bin、/opt/homebrew/bin）。 */
function candidateBinPaths(): string[] {
  const home = os.homedir();
  const isWin = process.platform === "win32";
  const names = isWin ? ["dreamina.exe", "dreamina.cmd", "dreamina"] : ["dreamina"];
  const dirs = isWin
    ? [path.join(home, ".local", "bin"), path.join(home, "AppData", "Local", "Microsoft", "WindowsApps")]
    : [path.join(home, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin", path.join(home, "bin")];
  return dirs.flatMap((dir) => names.map((n) => path.join(dir, n)));
}

/** PATH 兜底目录（spawn 时合并进 env.PATH，治 GUI Electron 极简 PATH）。 */
function extraPathDirs(): string[] {
  const home = os.homedir();
  return process.platform === "win32"
    ? [path.join(home, ".local", "bin")]
    : [path.join(home, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin", path.join(home, "bin")];
}

/** 出站代理环境变量名（大小写各一份）。dreamina 子进程要抹掉这些 → 见 buildDreaminaEnv。 */
const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "http_proxy",
  "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy",
] as const;

/**
 * dreamina 子进程的 env：补 PATH 兜底 + **强制直连**（抹掉继承来的出站代理变量 + NO_PROXY=*）。
 *
 * 病根：dreamina 是 Go 程序，HTTP 栈只认环境变量代理（HTTP(S)_PROXY / NO_PROXY，见其内置
 * golang.org/x/net/http/httpproxy）；而即梦（jimeng.jianying.com）是中国大陆服务、按来源 IP 认会员。
 * 用户为访问海外 AI API 开的梯子若把 HTTP(S)_PROXY 泄进本子进程，dreamina 的 user_credit / login /
 * 生成就会经代理出站——代理只要把即梦分流到海外（就是青阳机器上 clash 的行为），即梦即当成非本土
 * 流量 → 会员识别失败 / 静默拒绝（现象：得关掉梯子才能用）。app 自身 fetch 该走代理（systemProxy.ts
 * 管，为的是海外 API）；即梦 CLI 恰恰相反——永远直连。故给子进程一份抹掉代理的 env。
 *
 * 实测（2026-07-04，本机 clash 开着、把代理指向死端口验证）：带代理 →
 * `proxyconnect tcp ... connection refused` 直接挂；删掉代理变量 或 NO_PROXY=* → user_credit 正常返回。
 * 两条都灵，这里双保险（删变量治「梯子经 env 泄进来」，NO_PROXY=* 兜底「代理从别处冒出来」）。
 * 注：clash「TUN / 增强模式」在网络层透明改道，env 层拦不住——那种只能在梯子里给
 * jimeng.jianying.com 配直连分流规则，非本进程能修。
 */
export function buildDreaminaEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const mergedPath = [...extraPathDirs(), base.PATH || ""].filter(Boolean).join(path.delimiter);
  const env: NodeJS.ProcessEnv = { ...base, PATH: mergedPath };
  for (const key of PROXY_ENV_KEYS) delete env[key];
  env.NO_PROXY = "*";
  env.no_proxy = "*";
  return env;
}

/**
 * 解析 dreamina 真实可执行路径：env 覆盖 → 已知安装位逐个探。返回 "" 表示未安装（调用方负责引导安装）。
 * 不做 `which`（GUI PATH 不可靠），直接探文件存在性。
 */
export function resolveDreaminaBin(): string {
  const override = (process.env.DREAMINA_BIN || process.env.JIMENG_BIN || "").trim();
  if (override && existsSync(override)) return override;
  for (const candidate of candidateBinPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

export function isDreaminaInstalled(): boolean {
  return resolveDreaminaBin() !== "";
}

export type DreaminaRunResult = { code: number; stdout: string; stderr: string };
type DreaminaRunOptions = { timeoutMs?: number; bin?: string; retries?: number; retryDelayMs?: number };

function hasNetworkTimeoutSignal(text: string): boolean {
  return /context deadline exceeded|etimedout|eai_again|econnreset|und_err_headers_timeout|und_err_connect_timeout|headers timeout|connect timeout|timeout exceeded|fetch failed|request timeout|network timeout|i\/o timeout|执行超时/i.test(String(text || ""));
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof Error && hasNetworkTimeoutSignal(error.message);
}

function isNetworkTimeoutResult(result: DreaminaRunResult): boolean {
  return hasNetworkTimeoutSignal(result.stderr);
}

/**
 * 跑一条 dreamina 命令，收齐 stdout/stderr。超时杀进程；网络超时类故障默认重试 1 次。
 * 参数走数组（不过 shell），无注入面。env.PATH 补兜底目录。
 */
export async function runDreaminaCli(args: string[], opts: DreaminaRunOptions = {}): Promise<DreaminaRunResult> {
  const bin = opts.bin || resolveDreaminaBin();
  if (!bin) {
    return Promise.reject(
      new Error("未找到即梦 CLI（dreamina）。请先安装：终端运行 curl -fsSL https://jimeng.jianying.com/cli | bash，并完成 dreamina login。"),
    );
  }

  const maxRetries = Math.max(0, Math.trunc(opts.retries ?? 1));
  const baseTimeoutMs = opts.timeoutMs ?? 120_000;
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 500);

  const runOnce = (attemptIndex: number): Promise<DreaminaRunResult> =>
    new Promise<DreaminaRunResult>((resolve, reject) => {
      const timeoutMs = baseTimeoutMs + attemptIndex * 30_000;
      const child = spawn(bin, args, { windowsHide: true, env: buildDreaminaEnv() });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        reject(new Error(`即梦 CLI 执行超时（${args[0] || "?"}）`));
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });

  if (Number.isNaN(maxRetries)) throw new Error(desktopT("dreamina.invokeFailed"));
  const retryTimeoutResult = new Error("Dreamina CLI returned a network timeout");
  return retryWithBackoff(async (attempt) => {
    const result = await runOnce(attempt - 1);
    if (attempt <= maxRetries && isNetworkTimeoutResult(result)) throw retryTimeoutResult;
    return result;
  }, {
    retries: maxRetries,
    initialDelayMs: retryDelayMs,
    shouldRetry: (error) => error === retryTimeoutResult || isRetryableNetworkError(error),
  });
}
