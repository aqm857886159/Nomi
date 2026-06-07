import { describe, expect, it } from "vitest";
import {
  collectAssetUrls,
  firstMappedString,
  mappingCandidates,
  maybeParseJsonString,
  pathValues,
  providerMetaFromResponse,
  taskStatusFromResponse,
  valuesFromMapping,
} from "./responseParsing";

describe("maybeParseJsonString", () => {
  it("parses JSON-looking strings, passes through the rest", () => {
    expect(maybeParseJsonString('{"a":1}')).toEqual({ a: 1 });
    expect(maybeParseJsonString("[1,2]")).toEqual([1, 2]);
    expect(maybeParseJsonString("  {\"a\":1}  ")).toEqual({ a: 1 });
    expect(maybeParseJsonString("plain")).toBe("plain");
    expect(maybeParseJsonString("{bad json")).toBe("{bad json");
    expect(maybeParseJsonString(42)).toBe(42);
  });
});

describe("pathValues", () => {
  const res = { data: { items: [{ url: "a" }, { url: "b" }] }, status: "ok" };
  it("walks dotted paths", () => {
    expect(pathValues(res, "status")).toEqual(["ok"]);
    expect(pathValues(res, "data.items.0.url")).toEqual(["a"]);
  });
  it("expands [*] wildcards over arrays", () => {
    expect(pathValues(res, "data.items[*].url")).toEqual(["a", "b"]);
  });
  it("parses embedded JSON strings while walking", () => {
    expect(pathValues({ body: '{"x":{"y":7}}' }, "body.x.y")).toEqual([7]);
  });
  it("drops undefined segments", () => {
    expect(pathValues(res, "data.missing")).toEqual([]);
  });
});

describe("mappingCandidates", () => {
  it("normalizes array and scalar mapping entries", () => {
    expect(mappingCandidates({ status: ["a", " b ", ""] }, "status")).toEqual(["a", "b"]);
    expect(mappingCandidates({ status: "single" }, "status")).toEqual(["single"]);
    expect(mappingCandidates({}, "status")).toEqual([]);
    expect(mappingCandidates(null, "status")).toEqual([]);
  });
});

describe("valuesFromMapping / firstMappedString", () => {
  const response = { result: { video: "https://x/v.mp4" }, code: 200 };
  it("resolves values via the mapping's candidate paths", () => {
    expect(valuesFromMapping(response, { url: ["result.video"] }, "url")).toEqual(["https://x/v.mp4"]);
    expect(firstMappedString(response, { url: ["result.missing", "result.video"] }, "url")).toBe("https://x/v.mp4");
    expect(firstMappedString(response, { url: ["result.missing"] }, "url")).toBe("");
  });
});

describe("collectAssetUrls", () => {
  it("collects http/data/nomi-local urls from nested shapes", () => {
    expect(collectAssetUrls("https://x/a.png")).toEqual(["https://x/a.png"]);
    expect(collectAssetUrls("data:image/png;base64,zz")).toEqual(["data:image/png;base64,zz"]);
    expect(collectAssetUrls("nomi-local://p/a.png")).toEqual(["nomi-local://p/a.png"]);
    expect(collectAssetUrls("not a url")).toEqual([]);
    expect(collectAssetUrls([{ url: "https://x/1" }, { video_url: "https://x/2" }])).toEqual([
      "https://x/1",
      "https://x/2",
    ]);
    expect(collectAssetUrls({ image_url: "https://x/i", output_url: "https://x/o" })).toEqual([
      "https://x/i",
      "https://x/o",
    ]);
  });
});

describe("taskStatusFromResponse", () => {
  it("prefers the explicit statusMapping", () => {
    expect(
      taskStatusFromResponse({ state: "DONE" }, { status: ["state"] }, { succeeded: ["DONE"] }, []),
    ).toBe("succeeded");
  });
  it("falls back to common status vocabularies", () => {
    expect(taskStatusFromResponse({ status: "pending" }, null, undefined, [])).toBe("queued");
    expect(taskStatusFromResponse({ status: "in_progress" }, null, undefined, [])).toBe("running");
    expect(taskStatusFromResponse({ status: "completed" }, null, undefined, [])).toBe("succeeded");
    expect(taskStatusFromResponse({ status: "error" }, null, undefined, [])).toBe("failed");
  });
  it("understands kie verbs without an explicit statusMapping (waiting/generating/success/fail)", () => {
    // kie 视频（Seedance/HappyHorse/Kling）不再各自声明 statusMapping，靠默认词表归一。
    // 响应形如 { data: { state } }，经 response_mapping status:["data.state"] 取值。
    const m = { status: ["data.state"] };
    expect(taskStatusFromResponse({ data: { state: "waiting" } }, m, undefined, [])).toBe("queued");
    expect(taskStatusFromResponse({ data: { state: "generating" } }, m, undefined, [])).toBe("running");
    expect(taskStatusFromResponse({ data: { state: "success" } }, m, undefined, [])).toBe("succeeded");
    expect(taskStatusFromResponse({ data: { state: "fail" } }, m, undefined, [])).toBe("failed");
  });
  it("infers succeeded from presence of assets, failed from error field", () => {
    expect(taskStatusFromResponse({}, null, undefined, ["https://x/a"])).toBe("succeeded");
    expect(taskStatusFromResponse({ error: "boom" }, null, undefined, [])).toBe("failed");
  });
  it("defaults to queued when nothing matches", () => {
    expect(taskStatusFromResponse({}, null, undefined, [])).toBe("queued");
  });
});

describe("providerMetaFromResponse", () => {
  it("extracts mapped keys and backfills task id aliases", () => {
    const meta = providerMetaFromResponse({ task_id: "T1", extra: "kept" }, { task_id: ["task_id"], extra: ["extra"] });
    expect(meta.extra).toBe("kept");
    expect(meta.task_id).toBe("T1");
    expect(meta.query_id).toBe("T1");
  });
  it("returns empty meta when no mapping and no task id", () => {
    expect(providerMetaFromResponse({ nothing: 1 }, null)).toEqual({});
  });
});
