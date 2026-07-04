// 即梦官方 dreamina CLI 的二进制定位 + spawn 封装（IO 层；纯解析在 dreaminaCodec.ts）。
// processOperation（生成）与登录 IPC（设备码登录/积分自检/退登）共用这一份 spawn，避免两处各搓一遍。
//
// 关键坑：GUI 版 Electron 的 PATH 极简（不含用户 shell 的 ~/.local/bin），而官方安装脚本默认把
// dreamina 装到 ~/.local/bin。所以定位要兜底常见安装位 + spawn 时补 PATH，否则「终端能跑、App 里找不到」。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

/**
 * 判断一段文本是否含可重试的网络超时信号。
 */
function hasNetworkTimeoutSignal(text: string): boolean {
  const lower = String(text || "").toLowerCase();
  return /context deadline exceeded|etimedout|und_err_headers_timeout|und_err_connect_timeout|timeout exceeded|fetch failed/.test(lower);
}

/**
 * 判断错误是否属于「可重试的网络超时」类（Error 对象版）。
 */
function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return hasNetworkTimeoutSignal(error.message);
}

/**
 * 判断一次 CLI 返回结果是否属于网络超时（CLI 正常退出但 stderr 含超时信息）。
 */
function isNetworkTimeoutResult(result: { stderr: string }): boolean {
  return hasNetworkTimeoutSignal(result.stderr);
}

/**
 * 跑一条 dreamina 命令，收齐 stdout/stderr。网络超时自动重试（默认 1 次，共 2 次尝试）。
 * 参数走数组（不过 shell），无注入面。env.PATH 补兜底目录。
 */
export async function runDreaminaCli(args: string[], opts: { timeoutMs?: number; bin?: string; retries?: number } = {}): Promise<DreaminaRunResult> {
  const maxRetries = opts.retries ?? 1;
  const baseTimeout = opts.timeoutMs ?? 120_000;

  async function attempt(attemptIndex: number): Promise<DreaminaRunResult> {
    const bin = opts.bin || resolveDreaminaBin();
    if (!bin) {
      return Promise.reject(
        new Error("未找到即梦 CLI（dreamina）。请先安装：终端运行 curl -fsSL https://jimeng.jianying.com/cli | bash，并完成 dreamina login。"),
      );
    }
    const mergedPath = [...extraPathDirs(), process.env.PATH || ""].filter(Boolean).join(path.delimiter);
    // 超时逐次递增（首次 baseTimeout，每次重试 +30s），给服务端喘息。
    const timeoutMs = baseTimeout + attemptIndex * 30_000;

    return new Promise<DreaminaRunResult>((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true, env: { ...process.env, PATH: mergedPath } });
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
  }

  // 顺序尝试。覆盖两类失败：
  //  ① spawn 抛错（reject）：网络不通/二进制缺失等。
  //  ② CLI 正常退出但 stderr 含网络超时（resolve 但结果可重试）：如 Go context deadline exceeded。
  // 业务错误（非会员被拒 / 合规闸）不重试——重试多少次都会被拒。
  let lastError: unknown;
  let lastResult: DreaminaRunResult | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      lastResult = await attempt(i);
      // 结果成功（exit=0）→ 直接返回。
      if (lastResult.code === 0) return lastResult;
      // 结果含网络超时且还有重试额度 → 退避后重试。
      if (i < maxRetries && isNetworkTimeoutResult(lastResult)) {
        const delayMs = 500 * Math.pow(2, i); // 500ms, 1500ms
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      // 业务错误或无重试额度 → 原样返回，让调用方按常规路径诊断。
      return lastResult;
    } catch (error) {
      lastError = error;
      if (i < maxRetries && isRetryableNetworkError(error)) {
        const delayMs = 500 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
  // for 循环内每条路径都已 return 或 throw，不会落到这里。TS 安全网：
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
