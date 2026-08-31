// 本地 ComfyUI 健康探测（接入卡「启用/重新检测」调用）。GET {baseUrl}/system_stats → 归一成一句人话摘要。
// 用全局 fetch（undici，不认系统代理 → 直连 127.0.0.1，对本地服务正是要的：不被 Clash 等代理绕开）。
// 探测是**建议性**的：失败只提示「没连上」，不阻断启用（用户可能先启用、再起 ComfyUI）。
import { getComfyuiCapabilities } from "./comfyui/capabilityStore";
import { comfyuiEndpoint, normalizeComfyuiBaseUrl } from "./comfyui/endpointResolver";

export type ComfyuiProbeResult =
  | { ok: true; summary: string; version?: string; protocol: "enhanced" | "compatibility" }
  | { ok: false; error: string };

/** ComfyUI /system_stats（字段随版本变，全部防御式读）。 */
type SystemStats = {
  system?: { os?: unknown; python_version?: unknown; comfyui_version?: unknown; ram_total?: unknown };
  devices?: Array<{ name?: unknown; type?: unknown; vram_total?: unknown }>;
};

export async function probeComfyuiSystemStats(baseUrl: string): Promise<ComfyuiProbeResult> {
  const base = normalizeComfyuiBaseUrl(baseUrl);
  try {
    const capabilitiesPromise = getComfyuiCapabilities(base, true);
    const res = await fetch(comfyuiEndpoint(base, "systemStats"), { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return { ok: false, error: `ComfyUI 返回 HTTP ${res.status}` };
    const data = (await res.json()) as SystemStats;
    const sys = data.system || {};
    const dev = Array.isArray(data.devices) ? data.devices[0] : undefined;
    const parts: string[] = [];
    const py = typeof sys.python_version === "string" ? sys.python_version.split(" ")[0] : "";
    if (py) parts.push(`Python ${py}`);
    if (dev) {
      const name = typeof dev.name === "string" ? dev.name.replace(/^cuda:\d+\s*/i, "").trim() : "";
      if (name) parts.push(name);
      const vram = Number(dev.vram_total);
      if (Number.isFinite(vram) && vram > 0) parts.push(`${Math.round(vram / 1024 / 1024 / 1024)}GB 显存`);
    }
    const version = typeof sys.comfyui_version === "string" ? sys.comfyui_version : undefined;
    const capabilities = await capabilitiesPromise;
    return {
      ok: true,
      summary: parts.join(" · ") || "已连上 ComfyUI",
      version,
      protocol: capabilities.featuresEndpoint ? "enhanced" : "compatibility",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout|ECONNREFUSED|fetch failed|network/i.test(msg)) {
      return { ok: false, error: "没连上（确认 ComfyUI 已在该地址启动）" };
    }
    return { ok: false, error: msg };
  }
}
