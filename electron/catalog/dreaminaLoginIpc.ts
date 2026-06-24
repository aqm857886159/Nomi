// 即梦 dreamina CLI 的登录/账户/安装 IPC 处理器（主进程侧）。
// 设备码 OAuth：login-start 拿设备码材料（前端显二维码/验证码）→ 用户扫码 → login-poll 续查到登录态。
// 解析全走 dreaminaCodec 纯函数（可单测）；spawn 走 dreaminaCli（统一 PATH 兜底 + 超时）。
import { spawn } from "node:child_process";
import { resolveDreaminaBin, isDreaminaInstalled, runDreaminaCli } from "./dreaminaCli";
import { parseDeviceFlow, parseAccountStatus, isNotMaestroVip, type DreaminaDeviceFlow } from "./dreaminaCodec";

export type DreaminaStatus = {
  installed: boolean;
  loggedIn: boolean;
  totalCredit: number | null;
  vipLevel: string;
  /** 已登录但被「非高级会员」闸拦（生成会被拒）。诚实标，让用户知道要升会员。 */
  notMaestroVip: boolean;
};

/** 检测安装 + 登录态 + 积分。user_credit 不耗积分。 */
export async function dreaminaStatus(): Promise<DreaminaStatus> {
  if (!isDreaminaInstalled()) {
    return { installed: false, loggedIn: false, totalCredit: null, vipLevel: "", notMaestroVip: false };
  }
  const ran = await runDreaminaCli(["user_credit"], { timeoutMs: 20_000 }).catch(() => null);
  if (!ran) return { installed: true, loggedIn: false, totalCredit: null, vipLevel: "", notMaestroVip: false };
  const status = parseAccountStatus(ran.stdout, ran.stderr);
  return {
    installed: true,
    loggedIn: status.loggedIn,
    totalCredit: status.totalCredit,
    vipLevel: status.vipLevel,
    notMaestroVip: isNotMaestroVip(`${ran.stdout}\n${ran.stderr}`),
  };
}

/** 发起设备码登录，返回 verification_uri/user_code/device_code 供前端显二维码。 */
export async function dreaminaLoginStart(): Promise<DreaminaDeviceFlow> {
  const ran = await runDreaminaCli(["login", "--headless"], { timeoutMs: 30_000 });
  const flow = parseDeviceFlow(`${ran.stdout}\n${ran.stderr}`);
  if (!flow) throw new Error(`发起即梦登录失败：${(ran.stderr || ran.stdout || "").slice(0, 300)}`);
  return flow;
}

export type DreaminaLoginPoll = { status: "success" | "pending" | "error"; message: string };

/**
 * 轮询设备码授权结果。注意：dreamina 登录成功但账号非 maestro vip 时会以非 0 退出码 + 「not maestro vip」
 * 收尾——所以**登录成功**靠 stdout 文本判定（含「登录成功」/「OAuth 登录成功」），不靠退出码。
 */
export async function dreaminaLoginPoll(deviceCode: string): Promise<DreaminaLoginPoll> {
  const code = String(deviceCode || "").trim();
  if (!code) return { status: "error", message: "缺少 device_code" };
  const ran = await runDreaminaCli(["login", "checklogin", `--device_code=${code}`, "--poll=60"], { timeoutMs: 75_000 }).catch(
    (e: unknown) => ({ code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) }),
  );
  const text = `${ran.stdout}\n${ran.stderr}`;
  if (/登录成功|oauth\s*登录成功|login\s*success/i.test(text)) return { status: "success", message: "登录成功" };
  if (/超时|timeout|等待登录/i.test(text)) return { status: "pending", message: "等待授权中…" };
  return { status: "error", message: (ran.stderr || ran.stdout || "登录失败").slice(0, 300) };
}

/** 退出登录（仅清本地 OAuth 态，不删任务记录）。 */
export async function dreaminaLogout(): Promise<{ ok: boolean }> {
  await runDreaminaCli(["logout"], { timeoutMs: 15_000 }).catch(() => null);
  return { ok: true };
}

export type DreaminaInstallResult = { ok: boolean; message: string };

/**
 * 一键安装官方 dreamina CLI（用户在卡里点按钮触发）。跑官方 curl 安装脚本。
 * 官方源 jimeng.jianying.com，用户主动发起；不 bundle（跟官方更新走）。
 */
export function dreaminaInstall(): Promise<DreaminaInstallResult> {
  if (isDreaminaInstalled()) return Promise.resolve({ ok: true, message: "即梦 CLI 已安装" });
  if (process.platform === "win32") {
    return Promise.resolve({ ok: false, message: "Windows 暂请在 WSL 或手动安装即梦 CLI（curl -fsSL https://jimeng.jianying.com/cli | bash）。" });
  }
  return new Promise<DreaminaInstallResult>((resolve) => {
    const child = spawn("/bin/bash", ["-lc", "curl -fsSL https://jimeng.jianying.com/cli | bash"], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ ok: false, message: "安装超时，请稍后重试或终端手动安装。" }); }, 120_000);
    child.stdout?.on("data", (c) => { out += String(c); });
    child.stderr?.on("data", (c) => { out += String(c); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, message: `安装失败：${e instanceof Error ? e.message : String(e)}` }); });
    child.on("close", () => {
      clearTimeout(timer);
      // 安装脚本可能改 PATH——直接探文件存在性判定成功，比退出码可靠。
      resolve(resolveDreaminaBin() ? { ok: true, message: "即梦 CLI 安装完成。" } : { ok: false, message: `安装未完成：${out.slice(-300)}` });
    });
  });
}
