// 出站连通探测（纯逻辑，**不引 electron**，故可零网络单测）。
// 从 proxyIpc 抽出来的原因同 systemProxy：那个模块 import 了 ipcMain/session，
// 一旦把纯函数留在里面就再也没法在纯 Node 下直测。
import { LITTERBOX_INGESTION, TMPFILES_INGESTION } from "./catalog/assetLocalization";
import { describeNetworkError } from "./systemProxy";

/** 单次探测超时：够慢网络握手，又不至于让用户对着转圈干等。 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * 探测目标 = 免配置上传链那两个 host 的 origin，**从声明 derive、不另抄一份地址**。
 * 为什么测它们而不是测某家厂商：本机图 → 公网 URL 这一跳是全链最先断的一环
 *（2026-08-01 实测 tmpfiles.org 国内直连 000、走代理 405），也是最有诊断价值的一环。
 * 厂商能不能连是「那家厂商」的事，图床能不能连是「代理配没配对」的事。
 */
export function probeTargets(): string[] {
  const endpoints = [LITTERBOX_INGESTION, TMPFILES_INGESTION]
    .map((ing) => (ing.strategy === "upload-multipart" ? ing.endpoint : ""))
    .filter(Boolean);
  const origins: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const origin = new URL(endpoint).origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      /* 声明里的地址坏了就跳过，探测不该因此抛 */
    }
  }
  return origins;
}

export type ProxyProbeAttempt = { target: string; ok: boolean; ms: number; error: string };
export type ProxyProbeResult = { ok: boolean; ms: number; target: string; error: string; tried: ProxyProbeAttempt[] };

/**
 * **逐个都探完**，聚合口径是「任意一个通就算通」——因为上传链本来就是有序 fallback，
 * 一个能用就出得了片。用户问的是「我的图送不送得出去」，不是「代理生效没」。
 *
 * 但 `tried` 必须逐项留痕：2026-08-01 实测 litterbox 国内直连通（412）、tmpfiles 不通（000），
 * 只看聚合值会得出「不开代理也可达」——结论没错，却掩盖了「其中一个已经断了」这件事。
 * 昨天那次整链失败正是「litterbox 自己 500 + 没代理够不到 tmpfiles」同时发生。
 *
 * fetchImpl 注入以便直测。
 */
export async function probeOutbound(
  targets: string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProxyProbeResult> {
  const tried: ProxyProbeAttempt[] = [];
  for (const target of targets) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 只要握手 + 拿到任意 HTTP 响应就算「通」——4xx/5xx 说明网络到得了，正是我们要判的。
      await fetchImpl(target, { method: "GET", signal: controller.signal });
      tried.push({ target, ok: true, ms: Date.now() - startedAt, error: "" });
    } catch (error) {
      tried.push({ target, ok: false, ms: Date.now() - startedAt, error: describeNetworkError(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  const first = tried.find((attempt) => attempt.ok);
  if (first) return { ok: true, ms: first.ms, target: first.target, error: "", tried };
  const last = tried[tried.length - 1];
  return { ok: false, ms: 0, target: last?.target || "", error: last?.error || "no target", tried };
}
