import { describe, expect, it } from "vitest";
import {
  acceptVerdicts,
  buildDocSources,
  compareDocs,
  confirmChanged,
  emptyTable,
  extractKeyLines,
  fetchAll,
  fingerprintOf,
  isTransientFetchError,
  formatFullReport,
  formatSummary,
  normalizeDocText,
  offlineSampleName,
  type DocSource,
  type FetchedDoc,
  type FingerprintTable,
  type UnsourcedModel,
  bodyProblem as fetchedProblem,
} from "./model-doc-drift";

// 全部用内联假文档，不打网络。形状抄自 APIMart `.md` 页。
const URL_A = "https://docs.example.test/en/api-reference/videos/muse-video-ext/generation.md";
const URL_B = "https://docs.example.test/en/api-reference/images/other/generation.md";

const page = (duration: string, billing: string) => [
  "> ## Documentation Index",
  "> Fetch the complete documentation index at: https://docs.example.test/llms.txt",
  "# Muse Video Ext Video Generation",
  "",
  "Generate one MP4 video from text or up to 9 reference images, with sound, at 720p resolution for creators.",
  "| Parameter | Type | Description |",
  `| duration | integer | ${duration} |`,
  "| aspect_ratio | string | 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3. Default 16:9. |",
  `Billing: ${billing}`,
  "Example request body below shows the usual shape of a generation call for this model.",
].join("\n");

const OLD_PAGE = page("Fixed at about 10 seconds", "Priced per request");
const NEW_PAGE = page("2 to 10 seconds, default 5", "Priced per second of output");

const sources: DocSource[] = [{ url: URL_A, models: ["muse-video-ext"], declaredCheckedAt: "2026-11-07" }];

const tableFor = (text: string, status: "verified" | "pending-fix" | "unaudited" = "verified"): FingerprintTable => {
  const normalized = normalizeDocText(text);
  return {
    version: 1,
    entries: { [URL_A]: { fingerprint: fingerprintOf(normalized), status, checkedAt: "2026-11-07", keyLines: extractKeyLines(normalized) } },
    unsourcedAcknowledged: [],
  };
};

const ok = (text: string): FetchedDoc => ({ ok: true, text });
const run = (fetched: Map<string, FetchedDoc>, table: FingerprintTable, unsourced: UnsourcedModel[] = []) =>
  compareDocs({ sources, unsourced, table, fetched });

describe("文档漂移比对：四种情况", () => {
  it("没变：指纹一致 → 不报，只计数（站点样板 / 空白变化不算变）", () => {
    const noisy = `\n${OLD_PAGE.replace("# Muse", "#   Muse")}\n\n`.replace("> ## Documentation Index", "> ## Documentation Index  ");
    const result = run(new Map([[URL_A, ok(noisy)]]), tableFor(OLD_PAGE));
    expect(result.items).toEqual([]);
    expect(result.unchanged).toBe(1);
    expect(formatSummary(result, "/x")).toContain("⚠️ 变了 0");
  });

  it("正文变了：列出模型 · 地址 · 上次核对日 · 参数 / 计费行的前后差", () => {
    const result = run(new Map([[URL_A, ok(NEW_PAGE)]]), tableFor(OLD_PAGE));
    expect(result.items).toHaveLength(1);
    const [item] = result.items;
    expect(item).toMatchObject({ url: URL_A, models: ["muse-video-ext"], lastCheckedAt: "2026-11-07", status: "changed" });
    expect(item.removed.join("\n")).toContain("Fixed at about 10 seconds");
    expect(item.removed.join("\n")).toContain("Priced per request");
    expect(item.added.join("\n")).toContain("2 to 10 seconds");
    expect(item.added.join("\n")).toContain("Priced per second");
    const summary = formatSummary(result, "/x");
    expect(summary).toContain("变了 1");
    expect(summary).toContain("muse-video-ext");
    expect(summary).toContain("上次核对 2026-11-07");
  });

  it("抓不到：明说今天没查成，绝不落进「没变」（抓取失败 / 缺结果 / 空壳都算）", () => {
    for (const fetched of [
      new Map<string, FetchedDoc>([[URL_A, { ok: false, error: "HTTP 503" }]]),
      new Map<string, FetchedDoc>(), // 根本没有这个地址的结果
      new Map<string, FetchedDoc>([[URL_A, ok("<html><body><div id=root></div><script>x</script></body></html>")]]), // SPA 空壳
    ]) {
      const result = run(fetched, tableFor(OLD_PAGE));
      expect(result.unchanged).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe("unreachable");
      const summary = formatSummary(result, "/x");
      expect(summary).toContain("今天没查成 1");
      expect(summary).toContain("不是「没变」");
    }
  });

  it("新增一个没有来源地址的已接入模型：报新缺口；已登记的存量缺口只计数", () => {
    const stock: UnsourcedModel = { vendorKey: "apimart", modelKey: "old-model", kind: "image" };
    const fresh: UnsourcedModel = { vendorKey: "apimart", modelKey: "brand-new-video", kind: "video" };
    const table = { ...tableFor(OLD_PAGE), unsourcedAcknowledged: ["apimart/old-model"] };
    const result = run(new Map([[URL_A, ok(OLD_PAGE)]]), table, [stock, fresh]);
    expect(result.newUnsourced).toEqual([fresh]);
    expect(result.acknowledgedUnsourcedCount).toBe(1);
    const summary = formatSummary(result, "/x");
    expect(summary).toContain("新缺口 apimart/brand-new-video");
    expect(summary).not.toContain("apimart/old-model");
  });
});

describe("文档漂移比对：反例（改坏必红）", () => {
  it("同一处变化在有人核对前每天都报，不只报一次", () => {
    const table = tableFor(OLD_PAGE);
    const fetched = new Map([[URL_A, ok(NEW_PAGE)]]);
    for (let day = 0; day < 3; day += 1) {
      expect(run(fetched, table).items.map((i) => i.status)).toEqual(["changed"]);
    }
  });

  it("核对并落表（verified）之后才不再报", () => {
    const fetched = new Map([[URL_A, ok(NEW_PAGE)]]);
    const { table } = acceptVerdicts({ table: tableFor(OLD_PAGE), verdicts: { [URL_A]: { status: "verified" } }, fetched, unsourced: [], today: "2026-11-16" });
    expect(table.entries[URL_A]).toMatchObject({ status: "verified", checkedAt: "2026-11-16" });
    expect(run(fetched, table).items).toEqual([]);
  });

  it("有差异的记 pending-fix：不再当「变了」，但每天出现在待修里，不许当成已核对", () => {
    const fetched = new Map([[URL_A, ok(NEW_PAGE)]]);
    const { table } = acceptVerdicts({ table: emptyTable(), verdicts: { [URL_A]: { status: "pending-fix", note: "时长 2–10 秒，档案还写固定 10 秒" } }, fetched, unsourced: [], today: "2026-11-16" });
    expect(table.entries[URL_A].status).toBe("pending-fix");
    const result = run(fetched, table);
    expect(result.items).toEqual([]);
    expect(result.pendingFix).toEqual([{ url: URL_A, models: ["muse-video-ext"], note: "时长 2–10 秒，档案还写固定 10 秒" }]);
    expect(formatSummary(result, "/x")).toContain("待修 1");
  });

  it("没抓到的地址不能被落表记成「已核对」", () => {
    const { table, skipped } = acceptVerdicts({ table: emptyTable(), verdicts: { [URL_A]: { status: "verified" } }, fetched: new Map([[URL_A, { ok: false, error: "HTTP 500" }]]), unsourced: [], today: "2026-11-16" });
    expect(skipped).toEqual([URL_A]);
    expect(table.entries[URL_A]).toBeUndefined();
  });

  it("指纹表里没有这个地址：报「没基线」，不当成「没变」", () => {
    const result = run(new Map([[URL_A, ok(OLD_PAGE)]]), emptyTable());
    expect(result.items.map((i) => i.status)).toEqual(["no-baseline"]);
    expect(result.unchanged).toBe(0);
  });

  it("完整报告也带「今天没查成」与上次核对日", () => {
    const text = formatFullReport(run(new Map([[URL_A, { ok: false, error: "HTTP 404" }]]), tableFor(OLD_PAGE)));
    expect(text).toContain("今天没查成");
    expect(text).toContain("HTTP 404");
  });
});

describe("来源收集", () => {
  const archetypes = [
    { id: "a1", sources: [{ url: URL_A, checkedAt: "2026-11-07" }] },
    { id: "a2", sources: [{ url: URL_A, checkedAt: "2026-11-10" }, { url: URL_B, checkedAt: "2026-10-01" }] },
    { id: "a3" },
  ];
  const models = [
    { vendorKey: "v", modelKey: "m1", kind: "video" },
    { vendorKey: "v", modelKey: "m3", kind: "image" },
    { vendorKey: "v", modelKey: "m-text", kind: "text", tokenPricing: { source: { url: "https://p.example.test/pricing", checkedAt: "2026-09-01" } } },
    { vendorKey: "local", modelKey: "mlocal", kind: "image" },
  ];
  const idFor = (modelKey: string) => ({ m1: "a1", m3: "a3" })[modelKey as "m1"] ?? null;

  it("去重、取最晚核对日、没有来源的单列、本机模型不算缺口、token 价目出处算来源", () => {
    const { sources: built, unsourced } = buildDocSources({ archetypes, models, archetypeIdForModel: idFor, isLocalVendor: (k) => k === "local" });
    expect(built.map((s) => s.url)).toEqual([URL_B, URL_A, "https://p.example.test/pricing"].sort());
    expect(built.find((s) => s.url === URL_A)).toMatchObject({ models: ["a1", "a2"], declaredCheckedAt: "2026-11-10" });
    expect(unsourced).toEqual([{ vendorKey: "v", modelKey: "m3", kind: "image" }]);
  });
});

describe("抓取", () => {
  it("同一主机串行，一个失败不拖累别的", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchDoc = async (url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (url.endsWith("bad")) throw new Error("HTTP 500");
      return `body ${url}`;
    };
    const out = await fetchAll(["https://h.test/a", "https://h.test/bad", "https://h.test/c"], fetchDoc, 0, 1);
    expect(maxInFlight).toBe(1);
    expect(out.get("https://h.test/bad")).toEqual({ ok: false, error: "HTTP 500" });
    expect(out.get("https://h.test/c")).toMatchObject({ ok: true });
  });
});

describe("未逐项对账 / 没公开 / 比不了：三种基线都不许伪装成「已核对」或「没变」", () => {
  it("unaudited：指纹没变只计数「未逐项对账」，变了照样报", () => {
    const table = tableFor(OLD_PAGE, "unaudited");
    const same = run(new Map([[URL_A, ok(OLD_PAGE)]]), table);
    expect(same.unaudited).toBe(1);
    expect(formatSummary(same, "/x")).toContain("未逐项对账 1");
    expect(run(new Map([[URL_A, ok(NEW_PAGE)]]), table).items.map((i) => i.status)).toEqual(["changed"]);
  });

  it("not-published：基线是 404，今天仍 404 = 没变；冒出正文 = 变了；换成别的错 = 没查成", () => {
    const table: FingerprintTable = { ...emptyTable(), entries: { [URL_A]: { fingerprint: "http-404", status: "not-published", checkedAt: "2026-11-16", keyLines: [] } } };
    expect(run(new Map([[URL_A, { ok: false, error: "HTTP 404" }]]), table).unchanged).toBe(1);
    expect(run(new Map([[URL_A, ok(OLD_PAGE)]]), table).items.map((i) => i.status)).toEqual(["changed"]);
    expect(run(new Map([[URL_A, { ok: false, error: "HTTP 503" }]]), table).items.map((i) => i.status)).toEqual(["unreachable"]);
  });

  it("not-comparable：读不出正文时单独计数「无法比对」，不进「没变」；读出正文了 = 变了；读得出的不许躲进这一档", () => {
    const shell = ok("<html><body><div id=root></div></body></html>");
    const { table, skipped } = acceptVerdicts({ table: emptyTable(), verdicts: { [URL_A]: { status: "not-comparable" } }, fetched: new Map([[URL_A, shell]]), unsourced: [], today: "2026-11-16" });
    expect(skipped).toEqual([]);
    const r = run(new Map([[URL_A, shell]]), table);
    expect(r).toMatchObject({ unchanged: 0, notComparable: 1, items: [] });
    expect(formatSummary(r, "/x")).toContain("无法比对 1");
    expect(run(new Map([[URL_A, ok(OLD_PAGE)]]), table).items.map((i) => i.status)).toEqual(["changed"]);
    const readable = acceptVerdicts({ table: emptyTable(), verdicts: { [URL_A]: { status: "not-comparable" } }, fetched: new Map([[URL_A, ok(OLD_PAGE)]]), unsourced: [], today: "2026-11-16" });
    expect(readable.skipped).toEqual([URL_A]);
  });
});

describe("价目接口 JSON：只随标价变，不随促销 / 会员 / 实付折扣变", () => {
  const price = (listed: number, discount: number) => JSON.stringify({ data: { billing_type: "per_second", model_price: listed, paid_price: listed * discount, discount_percent: Math.round((1 - discount) * 100), membership: { levels: [{ level: "gold", factor: discount }] }, resolution_prices: { "720P": listed } }, success: true });
  it("折扣 / 实付变了指纹不变；计费单位或标价变了指纹就变", () => {
    const fp = (raw: string) => fingerprintOf(normalizeDocText(raw));
    expect(fp(price(0.084, 0.8))).toBe(fp(price(0.084, 0.7)));
    expect(fp(price(0.084, 0.8))).not.toBe(fp(price(0.1, 0.8)));
    expect(fp(price(0.084, 0.8))).not.toBe(fp(price(0.084, 0.8).replace("per_second", "per_request")));
  });
  it("短价目 JSON 不算空壳", () => {
    expect(fetchedProblem(price(0.084, 0.8))).toBeNull();
  });
  it("离线样本文件名带查询串（价目靠它区分模型）", () => {
    expect(offlineSampleName("https://api.example.test/api/pricing/model?model=a")).not.toBe(offlineSampleName("https://api.example.test/api/pricing/model?model=b"));
  });
});

describe("抓取重试只给临时性错误", () => {
  it("网络抖动 / 超时 / 限流 / 5xx 重试；404 / 405 / 403 这类地址本身的答案不重试", () => {
    for (const m of ["fetch failed", "The operation was aborted due to timeout", "HTTP 503", "HTTP 429", "HTTP 408"]) expect(isTransientFetchError(m)).toBe(true);
    for (const m of ["HTTP 404", "HTTP 405", "HTTP 403", "HTTP 410"]) expect(isTransientFetchError(m)).toBe(false);
  });
});

describe("复核：抖动不报，真改了照报", () => {
  it("第一次抓到的和基线不一致、再抓一次对上了 → 用对上的那次（不报变了）", async () => {
    const fetched = new Map<string, FetchedDoc>([[URL_A, ok(NEW_PAGE)]]);
    const settled = await confirmChanged({ sources, table: tableFor(OLD_PAGE), fetched, fetchDoc: async () => OLD_PAGE, gapMs: 0 });
    expect(settled).toBe(1);
    expect(run(fetched, tableFor(OLD_PAGE)).items).toEqual([]);
  });

  it("再抓还是新内容（真改了）→ 保持「变了」；复核抓不到也保持第一次的结果", async () => {
    for (const fetchDoc of [async () => NEW_PAGE, async () => { throw new Error("HTTP 503"); }]) {
      const fetched = new Map<string, FetchedDoc>([[URL_A, ok(NEW_PAGE)]]);
      expect(await confirmChanged({ sources, table: tableFor(OLD_PAGE), fetched, fetchDoc, gapMs: 0 })).toBe(0);
      expect(run(fetched, tableFor(OLD_PAGE)).items.map((i) => i.status)).toEqual(["changed"]);
    }
  });
});
