import { describe, expect, it } from "vitest";
import {
  collectAssetUrls,
  firstMappedString,
  mappingCandidates,
  maybeParseJsonString,
  pathValues,
  providerMetaFromResponse,
  resolveTaskStatus,
  taskFailureMessageFromResponse,
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

// 病根回归：不认得的动词曾被静默压成 queued（= 继续轮询的指令），于是上游已经失败的任务
// 在用户眼里永远转圈。这里钉死「不知道」不再冒充「排队中」——它必须留下原始动词。
// 判定何时把它翻成失败是 taskResultQuery 的事（见 unrecognizedTaskStatus.test.ts）。
describe("resolveTaskStatus：未登记动词必须留痕，而不是静默乐观", () => {
  it("认得的动词不留痕（各档都要，含 statusMapping 与通用词表）", () => {
    expect(resolveTaskStatus({ status: "pending" }, null, undefined, [])).toEqual({ status: "queued", unrecognizedStatus: "" });
    expect(resolveTaskStatus({ status: "processing" }, null, undefined, [])).toEqual({ status: "running", unrecognizedStatus: "" });
    expect(resolveTaskStatus({ state: "DONE" }, { status: ["state"] }, { succeeded: ["DONE"] }, [])).toEqual({
      status: "succeeded",
      unrecognizedStatus: "",
    });
  });

  it("不认得的动词 → 仍返回 queued（不误杀），但带出原始动词（大小写原样）", () => {
    // "failure"/"rejected" 当年（2026-08-11）就是这样的词；如今已进共享词表（shared/taskStatus），
    // 这里换成仍没人认得的词来钉「认不出 ≠ 失败、但要留痕」。
    expect(resolveTaskStatus({ status: "cooking" }, null, undefined, [])).toEqual({
      status: "queued",
      unrecognizedStatus: "cooking",
    });
    expect(resolveTaskStatus({ status: "Marinating" }, null, undefined, [])).toEqual({
      status: "queued",
      unrecognizedStatus: "Marinating",
    });
  });

  it("上游压根没给状态 ≠ 未知动词（否则每个只回 task_id 的 create 响应都会被误计）", () => {
    expect(resolveTaskStatus({}, null, undefined, [])).toEqual({ status: "queued", unrecognizedStatus: "" });
    expect(resolveTaskStatus({ task_id: "t-1" }, null, undefined, [])).toEqual({ status: "queued", unrecognizedStatus: "" });
  });

  it("有硬证据就定案，不算未知（有产物=成了 / 有 error 字段=挂了）", () => {
    expect(resolveTaskStatus({ status: "cooking" }, null, undefined, ["https://x/a.mp4"])).toEqual({
      status: "succeeded",
      unrecognizedStatus: "",
    });
    expect(resolveTaskStatus({ status: "cooking", error: "boom" }, null, undefined, [])).toEqual({
      status: "failed",
      unrecognizedStatus: "",
    });
  });

  it("taskStatusFromResponse 与 resolveTaskStatus 同源（投影，不是第二套实现）", () => {
    for (const response of [{ status: "failure" }, { status: "pending" }, {}, { error: "x" }]) {
      expect(taskStatusFromResponse(response, null, undefined, [])).toBe(resolveTaskStatus(response, null, undefined, []).status);
    }
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

describe("taskFailureMessageFromResponse", () => {
  // 真实抓包（2026-07-30 直连 apimart，apib.ai 备用域）：apimart 把 Google 的错误 JSON
  // **当字符串**塞进 data.error.message；profile 声明 error_message: "data.error.message"。
  const APIMART_IMAGEN_FAILURE = {
    code: 200,
    data: {
      credits_cost: 0,
      error: {
        code: "task_failed",
        message:
          '{\n  "error": {\n    "code": 404,\n    "message": "Requested entity was not found.",\n    "status": "NOT_FOUND"\n  }\n}\n',
        param: "",
        type: "task_failed",
      },
      id: "task_01KYRKKK35KCAASMFC7ND2PR6P",
      progress: 100,
      status: "failed",
    },
  };

  it("读 profile 声明的 error_message 映射，并解开被当字符串二次嵌套的上游 JSON", () => {
    expect(
      taskFailureMessageFromResponse(APIMART_IMAGEN_FAILURE, { status: "data.status", error_message: "data.error.message" }),
    ).toBe("Requested entity was not found.");
  });

  it("没声明映射也能按形状下钻到对象型 error（渲染层旧副本正是漏在这）", () => {
    expect(taskFailureMessageFromResponse(APIMART_IMAGEN_FAILURE, null)).toBe("Requested entity was not found.");
  });

  it("认得各家专属字段名：kie failMsg / runninghub errorMessage / modelscope errors.message", () => {
    expect(taskFailureMessageFromResponse({ data: { failMsg: "content blocked" } }, { error_message: "data.failMsg" })).toBe(
      "content blocked",
    );
    expect(taskFailureMessageFromResponse({ errorMessage: "node 12 crashed" }, { error_message: "errorMessage" })).toBe(
      "node 12 crashed",
    );
    expect(taskFailureMessageFromResponse({ errors: { message: "size invalid" } }, null)).toBe("size invalid");
  });

  it("不把成功态包裹的 message:'success' 当失败原因报给用户", () => {
    expect(taskFailureMessageFromResponse({ code: 200, message: "success", data: {} }, null)).toBe("");
  });

  it("扒不出原因就返回空串（由渲染层落兜底文案，不编造）", () => {
    expect(taskFailureMessageFromResponse({ data: { status: "failed" } }, null)).toBe("");
    expect(taskFailureMessageFromResponse(null, null)).toBe("");
  });
});
