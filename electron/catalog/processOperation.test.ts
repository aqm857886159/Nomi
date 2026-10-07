import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AntigravityResult } from "../ai/antigravityProtocol";

// 把 dreaminaCli（spawn IO）整体 mock 掉，喂合成 stdout，验进程路径端到端不需真二进制。
const runDreaminaCli = vi.fn();
const resolveDreaminaBin = vi.fn(() => "/fake/bin/dreamina");
vi.mock("./dreaminaCli", () => ({
  runDreaminaCli: (...args: unknown[]) => runDreaminaCli(...args),
  resolveDreaminaBin: () => resolveDreaminaBin(),
}));
const runAntigravityTask = vi.fn();
const consumedPreflights = new WeakSet<object>();
const assertPreparedAntigravityTaskMatches = vi.fn((prepared: Record<string, unknown>, expected: {
  prompt: string; modelId: string; capability: string; imageUrls: string[];
}) => {
  if (prepared.prompt !== expected.prompt || prepared.modelId !== expected.modelId
    || prepared.capability !== expected.capability
    || JSON.stringify(prepared.imageUrls) !== JSON.stringify(expected.imageUrls)) {
    throw new Error("ANTIGRAVITY_PREFLIGHT_MISMATCH");
  }
});
const consumePreparedAntigravityTask = vi.fn((prepared: Record<string, unknown>, expected: {
  prompt: string; modelId: string; capability: string; imageUrls: string[];
}) => {
  assertPreparedAntigravityTaskMatches(prepared, expected);
  if (consumedPreflights.has(prepared)) throw new Error("ANTIGRAVITY_PREPARED_TASK_INVALID");
  consumedPreflights.add(prepared);
});
vi.mock("../ai/antigravityTask", () => ({
  runPreparedAntigravityTask: (...args: unknown[]) => runAntigravityTask(...args),
  assertPreparedAntigravityTaskMatches: (...args: Parameters<typeof assertPreparedAntigravityTaskMatches>) =>
    assertPreparedAntigravityTaskMatches(...args),
  consumePreparedAntigravityTask: (...args: Parameters<typeof consumePreparedAntigravityTask>) =>
    consumePreparedAntigravityTask(...args),
}));

import { executeProcessOperation } from "./processOperation";
import { DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import {
  valuesFromMapping,
  taskStatusFromResponse,
  collectAssetUrls,
} from "../tasks/responseParsing";
import type { JsonRecord } from "../jsonUtils";
import { antigravityImageJobs } from "./antigravityImageOperation";
import { withTaskOwner } from "../tasks/localTaskJobs";
import type { ProcessOperationInput } from "./processOperation";

const writeAsset = vi.fn(() => ({ data: { url: "nomi-local://asset/proj/assets/v.mp4" } }));
const proc = (args: string[], appendDownloadDir = false) => ({ bin: "dreamina", parser: "dreamina-cli" as const, appendDownloadDir, args });
const call = (args: string[], opts: { projectId?: string; appendDownloadDir?: boolean } = {}) =>
  executeProcessOperation({ process: proc(args, opts.appendDownloadDir), context: {}, projectId: opts.projectId ?? "", writeAsset });

beforeEach(() => {
  runDreaminaCli.mockReset();
  runAntigravityTask.mockReset();
  writeAsset.mockClear();
  resolveDreaminaBin.mockReturnValue("/fake/bin/dreamina");
});

describe("Antigravity image process application route", () => {
  const artifact = { bytes: Buffer.from("decoded image bytes"), filename: "crane.jpg", mimeType: "image/jpeg", width: 64, height: 64 };
  const result: AntigravityResult = { text: "done", conversationId: "conversation", usage: { inputTokens: 1, outputTokens: 2 }, artifacts: [artifact] };
  const preflight = {
    discovery: { version: "1.1.21", models: [] }, invocation: { command: "/probe/agy", args: [] }, env: {},
    identity: { realpath: "/probe/agy", dev: "1", ino: "2", size: "3", mtimeNs: "4", ctimeNs: "5" },
    capability: "image" as const, modelId: "auto",
  };
  const deterministicWrite = vi.fn(() => ({ data: { url: "nomi-local://asset/project/crane.jpg" } }));
  const input = (mode: string, context: JsonRecord): ProcessOperationInput & { stage: "create" | "query" } => {
    const refs = ((context.request as JsonRecord)?.params as JsonRecord | undefined)?.reference_images;
    const fakePreflight = { ...preflight, prompt: String((context.request as JsonRecord)?.prompt ?? ""), model: "auto",
      images: mode === "image_edit" ? [{ bytes: Buffer.from("prepared"), mimeType: "image/png" }] : [],
      imageUrls: mode === "image_edit"
        ? (typeof refs === "string" ? [refs] : Array.isArray(refs) ? refs : []) : [],
      capability: mode === "image_edit" ? "edit" as const : "image" as const };
    return {
      process: { bin: "agy", parser: "antigravity-cli-image", args: [mode] }, context,
      projectId: "project", writeAsset, writeDeterministicAsset: deterministicWrite,
      identity: { vendorKey: "antigravity-cli", modelKey: "generate_image", taskKind: mode === "query_result" ? "text_to_image" : mode },
      stage: mode === "query_result" ? "query" : "create",
      ...(mode === "query_result" ? {} : { antigravityPreflight: fakePreflight as unknown as NonNullable<ProcessOperationInput["antigravityPreflight"]> }),
    };
  };
  beforeEach(() => { deterministicWrite.mockClear(); runAntigravityTask.mockReset().mockResolvedValue(result);
    assertPreparedAntigravityTaskMatches.mockClear(); });
  const submit = async (mode: string, refs?: unknown) => {
    const started = await withTaskOwner(71, () => executeProcessOperation(input(mode, { request: { prompt: "make a crane", params: { reference_images: refs } } })));
    const id = (started.response as { task_id: string }).task_id;
    await antigravityImageJobs.settled(id);
    return { id, started };
  };
  const query = (id: string, owner = 71, projectId = "project") => withTaskOwner(owner, () => executeProcessOperation({
    ...input("query_result", { providerMeta: { task_id: id } }), projectId,
  }));
  it.each([
    ["text_to_image", undefined, "image", []],
    ["image_edit", "nomi-local://asset/project/reference.jpg", "edit", ["nomi-local://asset/project/reference.jpg"]],
  ])("routes %s to its exact CLI capability and imports the result once", async (mode, refs, capability, imageUrls) => {
    const { id, started } = await submit(mode as string, refs);
    expect(started.response).toMatchObject({ task_id: id, status: "queued", image_urls: [] });
    expect(runAntigravityTask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: "make a crane", capability }),
      { signal: expect.any(AbortSignal) });
    expect(runAntigravityTask.mock.calls[0][0].images).toHaveLength(imageUrls.length);
    expect(deterministicWrite).not.toHaveBeenCalled();
    expect((await query(id)).response).toMatchObject({ status: "succeeded", image_urls: ["nomi-local://asset/project/crane.jpg"] });
    await query(id);
    expect(deterministicWrite).toHaveBeenCalledExactlyOnceWith("project", artifact.bytes, "crane.jpg", "image/jpeg", {
      kind: "generated", provider: "antigravity-cli", conversationId: "conversation", localTaskId: id, width: 64, height: 64,
    }, `antigravity:${id}`);
    expect(writeAsset).not.toHaveBeenCalled();
    expect(runDreaminaCli).not.toHaveBeenCalled();
  });
  it("checks owner and project before writing generated output", async () => {
    const { id } = await submit("text_to_image");
    await expect(query(id, 72)).rejects.toThrow("OWNER_MISMATCH");
    await expect(query(id, 71, "other-project")).rejects.toThrow("PROJECT_MISMATCH");
    expect(deterministicWrite).not.toHaveBeenCalled();
    await antigravityImageJobs.cancel(id, 71);
    expect((await query(id)).response).toMatchObject({ status: "cancelled", image_urls: [] });
  });
  it("retries an interrupted import with the same materialization identity", async () => {
    const { id } = await submit("text_to_image");
    deterministicWrite.mockImplementationOnce(() => { throw new Error("sidecar interrupted"); });
    await expect(query(id)).rejects.toThrow("sidecar interrupted");
    await query(id); await query(id);
    expect(deterministicWrite).toHaveBeenCalledTimes(2);
    expect(deterministicWrite.mock.calls[0]).toEqual(deterministicWrite.mock.calls[1]);
    expect(runAntigravityTask).toHaveBeenCalledOnce();
  });
  it.each([
    ["image_edit", [], "ANTIGRAVITY_INVALID_IMAGES"],
    ["text_to_image", ["nomi-local://reference"], "ANTIGRAVITY_INVALID_IMAGES"],
    ["image_edit", [null], "ANTIGRAVITY_INVALID_IMAGES"],
    ["image_edit", ["  "], "ANTIGRAVITY_INVALID_IMAGES"],
    ["image_edit", Array(5).fill("nomi-local://reference"), "ANTIGRAVITY_INVALID_IMAGES"],
    ["shell", [], "ANTIGRAVITY_INVALID_CONFIG"],
  ])("rejects invalid %s inputs before starting work", async (mode, refs, code) => {
    await expect(submit(mode as string, refs)).rejects.toThrow(code as string);
    expect(runAntigravityTask).not.toHaveBeenCalled();
  });
  it("requires exact operation args and an idempotent asset writer before submission", async () => {
    const raw = input("text_to_image", { request: { prompt: "crane" } });
    await expect(executeProcessOperation({ ...raw, process: { ...raw.process, args: ["text_to_image", "extra"] } })).rejects.toThrow("ANTIGRAVITY_INVALID_CONFIG");
    await expect(executeProcessOperation({ ...raw, writeDeterministicAsset: undefined })).rejects.toThrow("ANTIGRAVITY_ASSET_WRITER_REQUIRED");
    await expect(executeProcessOperation({ ...raw, context: { request: { prompt: " " } } })).rejects.toThrow("ANTIGRAVITY_EMPTY_PROMPT");
    expect(runAntigravityTask).not.toHaveBeenCalled();
  });
  it("rejects a prepared task bound to different prompt or media before local admission", async () => {
    const raw = input("image_edit", { request: { prompt: "crane", params: { reference_images: ["nomi-local://reference"] } } });
    await expect(executeProcessOperation({ ...raw, antigravityPreflight: { ...raw.antigravityPreflight!, prompt: "other" } }))
      .rejects.toThrow("ANTIGRAVITY_PREFLIGHT_MISMATCH");
    await expect(executeProcessOperation({ ...raw, antigravityPreflight: {
      ...raw.antigravityPreflight!, imageUrls: [] } as unknown as NonNullable<ProcessOperationInput["antigravityPreflight"]> }))
      .rejects.toThrow("ANTIGRAVITY_PREFLIGHT_MISMATCH");
    expect(runAntigravityTask).not.toHaveBeenCalled();
  });
  it("rejects replay of one prepared task before a second local job is admitted", async () => {
    const raw = input("image_edit", { request: { prompt: "crane",
      params: { reference_images: ["nomi-local://reference"] } } });
    const start = vi.spyOn(antigravityImageJobs, "start");
    const first = await withTaskOwner(71, () => executeProcessOperation(raw));
    await expect(withTaskOwner(71, () => executeProcessOperation(raw)))
      .rejects.toThrow("ANTIGRAVITY_PREPARED_TASK_INVALID");
    expect(start).toHaveBeenCalledOnce();
    await antigravityImageJobs.settled((first.response as { task_id: string }).task_id);
  });
  it("rejects a reserved parser from an old poisoned catalog before dispatch", async () => {
    const raw = input("text_to_image", { request: { prompt: "crane" } });
    await expect(executeProcessOperation({
      ...raw,
      identity: { ...raw.identity!, vendorKey: "attacker" },
    })).rejects.toThrow("ANTIGRAVITY_INVALID_CONFIG");
    expect(runAntigravityTask).not.toHaveBeenCalled();
  });
  it.each([
    ["create", "query_result"],
    ["query", "text_to_image"],
  ] as const)("rejects a %s stage carrying the other stage's process", async (stage, mode) => {
    const raw = input(mode, stage === "create" ? { request: { prompt: "crane" } } : { providerMeta: { task_id: "task" } });
    await expect(executeProcessOperation({ ...raw, stage })).rejects.toThrow("ANTIGRAVITY_INVALID_CONFIG");
    expect(runAntigravityTask).not.toHaveBeenCalled();
  });
});

describe("executeProcessOperation", () => {
  it("提交态：querying + submit_id，无媒体", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: '已提交\n{"submit_id":"u-1","gen_status":"querying"}', stderr: "" });
    const { response } = await call(["text2video", "--prompt=cat"]);
    const r = response as JsonRecord;
    expect(r.submit_id).toBe("u-1");
    expect(r.gen_status).toBe("querying");
    expect(r.video_url).toEqual([]);
  });

  it("提交类子命令不自动重跑（跑起来后超时可能已扣积分）；只有取结果 query_result 允许重跑一次", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: '{"submit_id":"u-1","gen_status":"querying"}', stderr: "" });
    await call(["text2video", "--prompt=cat"]);
    expect(runDreaminaCli).toHaveBeenLastCalledWith(["text2video", "--prompt=cat"], expect.objectContaining({ retries: 0 }));
    await call(["query_result"]);
    expect(runDreaminaCli).toHaveBeenLastCalledWith(["query_result"], expect.objectContaining({ retries: 1 }));
  });

  it("空值参数（--flag=）被丢弃，不发给 CLI", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: '{"submit_id":"u-1","gen_status":"querying"}', stderr: "" });
    await call(["text2video", "--prompt=cat", "--ratio="]);
    expect(runDreaminaCli).toHaveBeenCalledWith(["text2video", "--prompt=cat"], expect.anything());
  });

  it("成功态（远端 URL）→ video_url 带公网链接", async () => {
    runDreaminaCli.mockResolvedValue({
      code: 0,
      stdout: '{"submit_id":"u-2","gen_status":"success","videos":[{"video_url":"https://cdn/r.mp4"}]}',
      stderr: "",
    });
    const { response } = await call(["query_result"]);
    expect((response as JsonRecord).video_url).toEqual(["https://cdn/r.mp4"]);
  });

  it("成功态（本地下载文件，路径不存在）→ existsSync 拦，不假装有结果", async () => {
    runDreaminaCli.mockResolvedValue({
      code: 0,
      stdout: '{"submit_id":"u-3","gen_status":"success","results":[{"file_path":"/tmp/nope/v.mp4"}]}',
      stderr: "",
    });
    const { response } = await call(["query_result"], { projectId: "proj", appendDownloadDir: true });
    expect((response as JsonRecord).video_url).toEqual([]);
    expect(writeAsset).not.toHaveBeenCalled();
  });

  it("非会员（CLI 显式报 not maestro vip）：退出码非 0 → 抛会员引导错误", async () => {
    runDreaminaCli.mockResolvedValue({ code: 1, stdout: "", stderr: "current account is not maestro vip" });
    await expect(call(["text2video", "--prompt=cat"])).rejects.toThrow(/会员/);
  });

  it("静默失败（exit≠0 + 输出全空，现役 CLI 非会员行为）→ 抛会员/网页授权两条原因，不甩 exit=1", async () => {
    runDreaminaCli.mockResolvedValue({ code: 1, stdout: "", stderr: "" });
    await expect(call(["text2video", "--prompt=cat"])).rejects.toThrow(/会员.*授权|授权.*会员|开通即梦会员/);
  });

  it("exit=0 但只吐错误行（登录态失效 authsdk）→ 抛登录指引，不再当「仍在生成」空转（2026-07-06 群反馈根因）", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: "", stderr: "authsdk: refresh failed: protocol transport: do request" });
    await expect(call(["text2video", "--prompt=cat"])).rejects.toThrow(/登录/);
  });

  it("exit=0 但输出是合规拦截（AigcComplianceConfirmationRequired）→ 抛网页授权指引", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: "AigcComplianceConfirmationRequired", stderr: "" });
    await expect(call(["text2video", "--prompt=cat"])).rejects.toThrow(/网页端|授权/);
  });

  it("只有 submit_id（无 gen_status）仍算有效受理，不误伤", async () => {
    runDreaminaCli.mockResolvedValue({ code: 0, stdout: '{"submit_id":"u-9"}', stderr: "" });
    const { response } = await call(["text2video", "--prompt=cat"]);
    expect((response as JsonRecord).submit_id).toBe("u-9");
  });

  it("未装 CLI → 抛安装引导错误", async () => {
    resolveDreaminaBin.mockReturnValue("");
    await expect(call(["text2video"])).rejects.toThrow(/未找到即梦 CLI|一键安装/);
  });
});

describe("DREAMINA_CURATED_MAPPINGS：归一响应 → 状态/资产提取（mapping 接线正确）", () => {
  const mapping = DREAMINA_CURATED_MAPPINGS[0];
  const rm = mapping.create.response_mapping as JsonRecord;

  it("querying → running（会被 admitTask 续查）", () => {
    const resp = { submit_id: "u-1", gen_status: "querying", video_url: [] };
    expect(taskStatusFromResponse(resp, rm, mapping.statusMapping, [])).toBe("running");
  });

  it("success + video_url → succeeded + 抽到资产", () => {
    const resp = { submit_id: "u-2", gen_status: "success", video_url: ["https://cdn/r.mp4"] };
    const assetUrls = valuesFromMapping(resp, rm, "video_url").flatMap(collectAssetUrls);
    expect(assetUrls).toEqual(["https://cdn/r.mp4"]);
    expect(taskStatusFromResponse(resp, rm, mapping.statusMapping, assetUrls)).toBe("succeeded");
  });

  it("fail → failed", () => {
    const resp = { submit_id: "u-3", gen_status: "fail", fail_reason: "内容安全", video_url: [] };
    expect(taskStatusFromResponse(resp, rm, mapping.statusMapping, [])).toBe("failed");
  });

  it("task_id 从 submit_id 映射", () => {
    const resp = { submit_id: "u-9", gen_status: "querying" };
    const pm = mapping.create.provider_meta_mapping as JsonRecord;
    expect(valuesFromMapping(resp, pm, "task_id")).toEqual(["u-9"]);
  });
});
