// 应用内代理设置的 IPC（见 docs/plan/2026-08-01-in-app-proxy-setting.md）。
// get 读状态、set 写偏好并**即时重装 dispatcher**（不用重启）、test 探连通。
import { ipcMain, session } from "electron";
import { normalizeProxyPrefs, readProxyPrefs, writeProxyPrefs, type ProxyPrefs } from "./proxySettings";
import { probeOutbound, probeTargets } from "./proxyProbe";
import { assertTrustedSender } from "./ipcSenderGuard";
import { applySystemProxy, getProxyStatus } from "./systemProxy";

/**
 * 启动时按已存偏好装一次代理。
 * 住在这里而不是 main.ts：① main.ts 只剩个位数行数余量（filesize 门岗 800 行）；
 * ② systemProxy 刻意不引 proxySettings（那条链 → runtimePaths → electron，会让它没法纯 Node 单测），
 * 所以"读盘 + 注入"这一步必须由本来就在 electron 里的模块干，这里正合适。
 */
export async function applyProxyAtBoot(): Promise<void> {
  await applySystemProxy(session.defaultSession, readProxyPrefs());
}

export function registerProxyIpc(): void {
  // 必须传 readProxyPrefs()：getProxyStatus 不传参会退回「跟随系统」默认值，
  // 面板一打开就把用户存的档显示错（拆分模块时差点漏掉这个默认参数的陷阱）。
  // 代理设置能把全应用出站流量改道到攻击者的服务器；三条都只认主窗口。
  ipcMain.handle("nomi:proxy:get", async (event) => {
    assertTrustedSender(event);
    return { ok: true, status: getProxyStatus(readProxyPrefs()) };
  });

  ipcMain.handle("nomi:proxy:set", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const prefs = writeProxyPrefs(normalizeProxyPrefs(payload));
    // 即时重装：热切换是这个设置成立的前提，否则用户改完还得重启（那这设置就废了一半）。
    await applySystemProxy(session.defaultSession, prefs as ProxyPrefs);
    return { ok: true, status: getProxyStatus(prefs) };
  });

  ipcMain.handle("nomi:proxy:test", async (event) => {
    assertTrustedSender(event);
    const result = await probeOutbound(probeTargets());
    return { ok: true, result, status: getProxyStatus(readProxyPrefs()) };
  });
}
