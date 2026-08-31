import { describe, it, expect, vi, beforeEach } from "vitest";

// 把 dreaminaCli（spawn IO）整体 mock 掉，喂合成 stdout，验进程路径端到端不需真二进制。
const runDreaminaCli = vi.fn();
const resolveDreaminaBin = vi.fn(() => "/fake/bin/dreamina");
vi.mock("./dreaminaCli", () => ({
  runDreaminaCli: (...args: unknown[]) => runDreaminaCli(...args),
  resolveDreaminaBin: () => resolveDreaminaBin(),
}));

import { executeProcessOperation } from "./processOperation";
import { DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import {
  valuesFromMapping,
  taskStatusFromResponse,
  collectAssetUrls,
} from "../tasks/responseParsing";
import type { JsonRecord } from "../jsonUtils";

const writeAsset = vi.fn(() => ({ data: { url: "nomi-local://asset/proj/assets/v.mp4" } }));
const proc = (args: string[], appendDownloadDir = false) => ({ bin: "dreamina", parser: "dreamina-cli" as const, appendDownloadDir, args });
const call = (args: string[], opts: { projectId?: string; appendDownloadDir?: boolean } = {}) =>
  executeProcessOperation({ process: proc(args, opts.appendDownloadDir), context: {}, projectId: opts.projectId ?? "", writeAsset });

beforeEach(() => {
  runDreaminaCli.mockReset();
  writeAsset.mockClear();
  resolveDreaminaBin.mockReturnValue("/fake/bin/dreamina");
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
