// 应用内代理设置的 IPC（见 docs/plan/2026-08-01-in-app-proxy-setting.md）。
// get 读状态、set 写偏好并**即时重装 dispatcher**（不用重启）、test 探连通。
import { app, ipcMain, session } from "electron";
import { normalizeProxyPrefs, readProxyPrefs, writeProxyPrefs, type ProxyPrefs } from "./proxySettings";
import { probeOutbound, probeTargets } from "./proxyProbe";
import { assertTrustedSender } from "./ipcSenderGuard";
import { applySystemProxy, getAppDispatcher, getProxyStatus } from "./systemProxy";
import { invalidateOutboundEnvironment, readOutboundEnvironment, seedLabTrustedPrivateOrigins } from "./networkOutboundPolicy";

/**
 * 启动时按已存偏好装一次代理。
 * 住在这里而不是 main.ts：① main.ts 只剩个位数行数余量（filesize 门岗 800 行）；
 * ② systemProxy 刻意不引 proxySettings（那条链 → runtimePaths → electron，会让它没法纯 Node 单测），
 * 所以"读盘 + 注入"这一步必须由本来就在 electron 里的模块干，这里正合适。
 */
export async function applyProxyAtBoot(): Promise<void> {
  // 实验室 loopback 夹具的精确 origin 与代理线路同属「启动时装网络配置」这一步，一并在这里落实；
  // 打包版本里整体空操作（见 networkOutboundPolicy.seedLabTrustedPrivateOrigins）。
  seedLabTrustedPrivateOrigins(app.isPackaged);
  await applySystemProxy(session.defaultSession, readProxyPrefs());
}

export function registerProxyIpc(): void {
  // 必须传 readProxyPrefs()：getProxyStatus 不传参会退回「跟随系统」默认值，
  // 面板一打开就把用户存的档显示错（拆分模块时差点漏掉这个默认参数的陷阱）。
  // 代理设置能把全应用出站流量改道到攻击者的服务器；三条都只认主窗口。
  ipcMain.handle("nomi:proxy:get", async (event) => {
    assertTrustedSender(event);
    await getAppDispatcher().catch(() => undefined); // status carries boot/application failure
    // 面板要显示「检测到本地代理（fake-ip）」这一行，所以在这里把那次有界探测（≤1.5s、进程内
    // 只跑一次）落实到位——生成路径读的是同一份缓存，不会因为面板没开过就判得不一样。
    await readOutboundEnvironment().catch(() => undefined);
    return { ok: true, status: getProxyStatus(readProxyPrefs()) };
  });

  ipcMain.handle("nomi:proxy:set", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const prefs = writeProxyPrefs(normalizeProxyPrefs(payload));
    // 即时重装：热切换是这个设置成立的前提，否则用户改完还得重启（那这设置就废了一半）。
    await applySystemProxy(session.defaultSession, prefs as ProxyPrefs);
    // 线路换了，合成解析器的判定可能跟着换：作废旧快照并立刻重探，别让面板显示上一条线路的结论。
    invalidateOutboundEnvironment();
    await readOutboundEnvironment().catch(() => undefined);
    // A newer user preference may have arrived while this operation was
    // resolving. Return that latest committed state, never an obsolete pair.
    await getAppDispatcher().catch(() => undefined);
    const status = getProxyStatus(readProxyPrefs());
    return { ok: !status.unsupported, status, ...(status.unsupported ? { error: status.unsupported } : {}) };
  });

  ipcMain.handle("nomi:proxy:test", async (event) => {
    assertTrustedSender(event);
    const result = await probeOutbound(probeTargets());
    return { ok: true, result, status: getProxyStatus(readProxyPrefs()) };
  });
}
