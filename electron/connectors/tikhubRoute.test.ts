import { describe, expect, it, vi, beforeEach } from "vitest";

// 锁双域名全球化选路：赛跑（locale 序探测）、sticky、主挂切备、两域全挂、手动强制优先。
// connectorPrefsStore（磁盘）用内存 fake 桩；hardenedFetch（探测出站）被 mock。不发真网络。
// 机制不变量（编排定稿）：locale 只影响探测**顺序**，绝不决定结果；手动锁定不切换。

const prefs: { store: Record<string, unknown> } = { store: {} };
vi.mock("./connectorPrefsStore", () => ({
  readConnectorPrefs: () => ({ ...prefs.store }),
  writeConnectorPrefs: (_id: string, patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete prefs.store[k];
      else prefs.store[k] = v;
    }
  },
}));

let localeValue: "zh-CN" | "en" = "en";
vi.mock("../desktopLocale", () => ({ getDesktopLocale: () => localeValue }));

const hardenedFetch = vi.fn();
vi.mock("../hardenedFetch", () => ({ hardenedFetch: (...args: unknown[]) => hardenedFetch(...args) }));

import {
  orderedCandidateHosts,
  probeTikhubHost,
  resolveTikhubHost,
  failoverTikhubHost,
  setTikhubRouteMode,
  getTikhubRouteStatus,
  readTikhubRoutePrefs,
} from "./tikhubRoute";

const IO = "api.tikhub.io";
const DEV = "api.tikhub.dev";

/** 健康响应（health/check → {status:'ok'}，http 200）。 */
function healthy(status = "ok") {
  return {
    bytes: Buffer.from(JSON.stringify({ status }), "utf8"),
    status: 200,
    contentType: "application/json",
    finalUrl: "https://api.tikhub.io/api/v1/health/check",
    truncated: false,
  };
}
function down(httpStatus = 503) {
  return {
    bytes: Buffer.from("<html>down</html>", "utf8"),
    status: httpStatus,
    contentType: "text/html",
    finalUrl: "https://api.tikhub.io/api/v1/health/check",
    truncated: false,
  };
}
/** 从 hardenedFetch 调用参数里取被探测的 host。 */
function probedHost(callIndex: number): string {
  const url = new URL(hardenedFetch.mock.calls[callIndex][0] as string);
  return url.hostname;
}

beforeEach(() => {
  prefs.store = {};
  localeValue = "en";
  hardenedFetch.mockReset();
});

describe("orderedCandidateHosts —— locale 只排序不决定结果", () => {
  it("en 系先探主域 .io，zh 系先探加速域 .dev；两域都在", () => {
    expect(orderedCandidateHosts("en")).toEqual([IO, DEV]);
    expect(orderedCandidateHosts("zh-CN")).toEqual([DEV, IO]);
  });
});

describe("probeTikhubHost —— 免费健康探测", () => {
  it("命中 /api/v1/health/check、无鉴权头、禁重定向；status:ok → 健康", async () => {
    hardenedFetch.mockResolvedValue(healthy());
    const ok = await probeTikhubHost(IO);
    expect(ok).toBe(true);
    const [url, opts] = hardenedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("https://api.tikhub.io/api/v1/health/check");
    // 免费健康探测：绝不带 Authorization（不触发计费/鉴权），禁重定向出域。
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(opts.allowRedirect).toBe(false);
    expect(opts.throwOnNon2xx).toBe(false);
  });
  it("非 2xx / 抛错 → 不健康（吞掉）", async () => {
    hardenedFetch.mockResolvedValueOnce(down(503));
    expect(await probeTikhubHost(IO)).toBe(false);
    hardenedFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await probeTikhubHost(DEV)).toBe(false);
  });
  it("status:degraded → 不健康", async () => {
    hardenedFetch.mockResolvedValue(healthy("degraded"));
    expect(await probeTikhubHost(IO)).toBe(false);
  });
});

describe("resolveTikhubHost —— 赛跑 + sticky", () => {
  it("auto 无 sticky：按 locale 序探测，第一个健康的用它并写 sticky", async () => {
    localeValue = "zh-CN"; // 中文系统先探 .dev
    hardenedFetch.mockResolvedValue(healthy());
    const host = await resolveTikhubHost();
    expect(host).toBe(DEV); // 先探到的健康域
    expect(probedHost(0)).toBe(DEV); // 探测顺序：.dev 在前
    expect(prefs.store.stickyHost).toBe(DEV); // sticky 已落
  });

  it("auto 有 sticky：直接用 sticky，不再探测", async () => {
    prefs.store = { routeMode: "auto", stickyHost: IO };
    const host = await resolveTikhubHost();
    expect(host).toBe(IO);
    expect(hardenedFetch).not.toHaveBeenCalled(); // sticky 命中，零探测
  });

  it("auto 首选域不通 → 跳到下一域并 sticky 到它", async () => {
    localeValue = "en"; // 先探 .io
    hardenedFetch.mockResolvedValueOnce(down(503)); // .io 不通
    hardenedFetch.mockResolvedValueOnce(healthy()); // .dev 通
    const host = await resolveTikhubHost();
    expect(host).toBe(DEV);
    expect(probedHost(0)).toBe(IO);
    expect(probedHost(1)).toBe(DEV);
    expect(prefs.store.stickyHost).toBe(DEV);
  });

  it("两域全不通 → null（上层报 no-route）", async () => {
    hardenedFetch.mockResolvedValue(down(503));
    expect(await resolveTikhubHost()).toBeNull();
    expect(prefs.store.stickyHost).toBeUndefined(); // 没健康域，不写 sticky
  });
});

describe("resolveTikhubHost —— 手动强制优先于赛跑/sticky", () => {
  it("mode=io：直接主域，不探测（即便 sticky 指向别处）", async () => {
    prefs.store = { routeMode: "io", stickyHost: DEV };
    const host = await resolveTikhubHost();
    expect(host).toBe(IO); // 手动锁定压过 sticky
    expect(hardenedFetch).not.toHaveBeenCalled();
  });
  it("mode=dev：直接加速域，不探测", async () => {
    prefs.store = { routeMode: "dev" };
    expect(await resolveTikhubHost()).toBe(DEV);
    expect(hardenedFetch).not.toHaveBeenCalled();
  });
});

describe("failoverTikhubHost —— 主挂自动切备", () => {
  it("换另一域并探测；健康则更新 sticky 并返回它", async () => {
    prefs.store = { routeMode: "auto", stickyHost: IO };
    hardenedFetch.mockResolvedValue(healthy());
    const next = await failoverTikhubHost(IO);
    expect(next).toBe(DEV); // 切到另一域
    expect(probedHost(0)).toBe(DEV);
    expect(prefs.store.stickyHost).toBe(DEV); // sticky 更新
  });
  it("另一域也不健康 → null", async () => {
    prefs.store = { routeMode: "auto", stickyHost: IO };
    hardenedFetch.mockResolvedValue(down(503));
    expect(await failoverTikhubHost(IO)).toBeNull();
  });
  it("手动锁定（io/dev）不切换 → null", async () => {
    prefs.store = { routeMode: "io" };
    expect(await failoverTikhubHost(IO)).toBeNull();
    expect(hardenedFetch).not.toHaveBeenCalled(); // 手动锁定：连探都不探
  });
});

describe("setTikhubRouteMode / getTikhubRouteStatus", () => {
  it("切手动锁定：写 mode，activeHost = 锁定域", () => {
    setTikhubRouteMode("dev");
    expect(readTikhubRoutePrefs().mode).toBe("dev");
    expect(getTikhubRouteStatus()).toMatchObject({ mode: "dev", activeHost: DEV, hosts: [IO, DEV] });
  });
  it("回 auto：清掉 sticky（下次重新赛跑），activeHost 恢复空串", () => {
    prefs.store = { routeMode: "io", stickyHost: DEV };
    setTikhubRouteMode("auto");
    expect(prefs.store.stickyHost).toBeUndefined(); // sticky 被清
    expect(getTikhubRouteStatus()).toMatchObject({ mode: "auto", activeHost: "" });
  });
  it("脏 mode 值回落 auto", () => {
    expect(setTikhubRouteMode("garbage")).toBe("auto");
  });
});
