import { describe, expect, it } from "vitest";
import { probeOutbound, probeTargets } from "./proxyProbe";

const ok = () => Promise.resolve(new Response("", { status: 412 }));
const boom = () => Promise.reject(new TypeError("fetch failed"));

describe("probeTargets — 从图床声明 derive，不另抄一份地址", () => {
  it("给出免配置上传链两个 host 的 origin（去重、无路径）", () => {
    const targets = probeTargets();
    expect(targets).toEqual(["https://litterbox.catbox.moe", "https://tmpfiles.org"]);
  });
});

describe("probeOutbound — 聚合「任一通即通」，但逐项留痕", () => {
  it("全通 → ok，tried 两项都 ok", async () => {
    const r = await probeOutbound(["https://a", "https://b"], ok as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(r.tried.map((t) => t.ok)).toEqual([true, true]);
  });

  it("全不通 → fail，带最后一条人话错误（不是裸 fetch failed）", async () => {
    const r = await probeOutbound(["https://a", "https://b"], boom as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.tried.map((t) => t.ok)).toEqual([false, false]);
    expect(r.error).not.toBe("fetch failed");
    expect(r.error).toMatch(/网络请求失败|超时|连接/);
  });

  /**
   * 这条是本模块存在的理由。2026-08-01 实测：litterbox 国内直连通（412）、tmpfiles 不通（000）。
   * 聚合值「任一通即通」是对的（图确实还送得出去），但只看它就会把「兜底已经没了」藏起来——
   * 而 07-31 那次整链失败正是「litterbox 自己 500 + 没代理够不到 tmpfiles」同时发生。
   * 所以必须**探完全部**、逐项留痕，UI 才说得出「可达 1/2 · 少一个兜底」。
   */
  it("部分可达 → 聚合仍 ok，但 tried 必须暴露另一个已断（且不许提前 return）", async () => {
    const calls: string[] = [];
    const mixed = ((url: string) => {
      calls.push(url);
      return url.includes("blocked") ? boom() : ok();
    }) as unknown as typeof fetch;
    const r = await probeOutbound(["https://reachable", "https://blocked"], mixed);
    expect(r.ok).toBe(true);
    expect(r.target).toBe("https://reachable");
    expect(r.tried.map((t) => [t.target, t.ok])).toEqual([
      ["https://reachable", true],
      ["https://blocked", false],
    ]);
    // 第一个就通了也得把第二个探完——否则永远看不见「另一半断了」。
    expect(calls).toHaveLength(2);
  });

  it("空目标列表 → fail，不抛", async () => {
    const r = await probeOutbound([], ok as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.tried).toEqual([]);
  });
});
