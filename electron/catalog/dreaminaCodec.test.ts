import { describe, it, expect } from "vitest";
import {
  extractDreaminaJson,
  findSubmitId,
  findGenStatus,
  findFailReason,
  findQueueInfo,
  findTotalCredit,
  collectDreaminaMedia,
  normalizeDreaminaOutput,
  clampDreaminaDuration,
  normalizeDreaminaRatio,
  normalizeDreaminaVideoResolution,
  parseDeviceFlow,
  parseAccountStatus,
  isNotMaestroVip,
  isComplianceConfirmationRequired,
  describeDreaminaFailure,
} from "./dreaminaCodec";

describe("extractDreaminaJson", () => {
  it("解析干净 JSON", () => {
    expect(extractDreaminaJson('{"submit_id":"abc","gen_status":"querying"}')).toEqual({
      submit_id: "abc",
      gen_status: "querying",
    });
  });

  it("从「文本 + JSON」混合里抠出 JSON（CLI 常见输出形态）", () => {
    const out = '提交成功，正在生成…\n{"submit_id":"u-1","gen_status":"success","videos":[{"video_url":"https://x/y.mp4"}]}\n完成';
    const parsed = extractDreaminaJson(out) as Record<string, unknown>;
    expect(parsed.submit_id).toBe("u-1");
    expect(parsed.gen_status).toBe("success");
  });

  it("多个 JSON 候选时按结果键打分取最高（不被前面的小对象骗到）", () => {
    const out = '{"log":"start"}\n{"submit_id":"win","gen_status":"success","total_credit":80}';
    const parsed = extractDreaminaJson(out) as Record<string, unknown>;
    expect(parsed.submit_id).toBe("win");
  });

  it("尊重字符串内的花括号，不被骗", () => {
    const out = 'note\n{"prompt":"a {cat} on sofa","submit_id":"s1","gen_status":"querying"}';
    const parsed = extractDreaminaJson(out) as Record<string, unknown>;
    expect(parsed.submit_id).toBe("s1");
    expect(parsed.prompt).toBe("a {cat} on sofa");
  });

  it("纯文本（无 JSON）回落 { text }", () => {
    expect(extractDreaminaJson("current account is not maestro vip")).toEqual({
      text: "current account is not maestro vip",
    });
  });

  it("空串回落空对象", () => {
    expect(extractDreaminaJson("")).toEqual({});
  });
});

describe("字段提取", () => {
  it("submit_id 递归找（含 task_id 别名）", () => {
    expect(findSubmitId({ data: { task_id: "t-9" } })).toBe("t-9");
    expect(findSubmitId({ submit_id: "s-1", nested: { submit_id: "ignored" } })).toBe("s-1");
    expect(findSubmitId({ nothing: true })).toBe("");
  });

  it("gen_status 取小写", () => {
    expect(findGenStatus({ gen_status: "SUCCESS" })).toBe("success");
    expect(findGenStatus({ data: { status: "Querying" } })).toBe("querying");
  });

  it("fail_reason 仅在失败语境命中", () => {
    expect(findFailReason({ gen_status: "fail", fail_reason: "内容安全拦截" })).toBe("内容安全拦截");
    // 成功语境的 message 不应被误当失败原因
    expect(findFailReason({ gen_status: "success", message: "ok" })).toBe("");
    // 文本自身含 fail 也算
    expect(findFailReason({ error: "generation failed: invalid param duration" })).toMatch(/invalid param/);
  });

  it("queue_info 就近取出", () => {
    expect(findQueueInfo({ data: { queue_info: { queue_idx: 3, queue_length: 10 } } })).toEqual({
      queue_idx: 3,
      queue_length: 10,
    });
    expect(findQueueInfo({ no: "queue" })).toBeNull();
  });

  it("total_credit 取出（user_credit 响应）", () => {
    expect(findTotalCredit({ total_credit: 80, user_id: 1, vip_level: "" })).toBe(80);
    expect(findTotalCredit({ nope: 1 })).toBeNull();
  });
});

describe("collectDreaminaMedia", () => {
  it("公网 URL 入 remoteUrls", () => {
    const raw = { videos: [{ video_url: "https://cdn/x.mp4" }], cover_image: "https://cdn/c.png" };
    const { remoteUrls, localPaths } = collectDreaminaMedia(raw);
    expect(remoteUrls).toContain("https://cdn/x.mp4");
    expect(remoteUrls).toContain("https://cdn/c.png");
    expect(localPaths).toEqual([]);
  });

  it("本地下载路径入 localPaths（--download_dir 产物）", () => {
    const raw = { results: [{ file_path: "/Users/me/proj/assets/dreamina_video_ab12.mp4" }] };
    const { remoteUrls, localPaths } = collectDreaminaMedia(raw);
    expect(localPaths).toContain("/Users/me/proj/assets/dreamina_video_ab12.mp4");
    expect(remoteUrls).toEqual([]);
  });

  it("file:// URL 解码成本地路径", () => {
    const { localPaths } = collectDreaminaMedia({ video: "file:///Users/me/out/v.mp4" });
    expect(localPaths).toContain("/Users/me/out/v.mp4");
  });

  it("深层嵌套也能挖到（对层级不敏感）", () => {
    const raw = { data: { item_list: [{ resource: { transcoded_video: "https://cdn/deep.mp4" } }] } };
    expect(collectDreaminaMedia(raw).remoteUrls).toContain("https://cdn/deep.mp4");
  });

  it("去重", () => {
    const raw = { a: "https://cdn/x.mp4", b: { video_url: "https://cdn/x.mp4" } };
    expect(collectDreaminaMedia(raw).remoteUrls).toEqual(["https://cdn/x.mp4"]);
  });
});

describe("normalizeDreaminaOutput（端到端）", () => {
  it("提交态：submit_id + querying，无媒体", () => {
    const out = '已提交\n{"submit_id":"u-123","gen_status":"querying"}';
    const n = normalizeDreaminaOutput(out);
    expect(n.submitId).toBe("u-123");
    expect(n.genStatus).toBe("querying");
    expect(n.remoteUrls).toEqual([]);
    expect(n.localPaths).toEqual([]);
  });

  it("成功态（远端 URL）", () => {
    const out = '{"submit_id":"u-1","gen_status":"success","videos":[{"video_url":"https://cdn/r.mp4"}]}';
    const n = normalizeDreaminaOutput(out);
    expect(n.genStatus).toBe("success");
    expect(n.remoteUrls).toEqual(["https://cdn/r.mp4"]);
  });

  it("成功态（本地下载文件）", () => {
    const out = '下载完成\n{"submit_id":"u-2","gen_status":"success","results":[{"file_path":"/tmp/dl/v.mp4"}]}';
    const n = normalizeDreaminaOutput(out);
    expect(n.localPaths).toEqual(["/tmp/dl/v.mp4"]);
  });

  it("失败态", () => {
    const out = '{"submit_id":"u-3","gen_status":"fail","fail_reason":"内容安全"}';
    const n = normalizeDreaminaOutput(out);
    expect(n.genStatus).toBe("fail");
    expect(n.failReason).toBe("内容安全");
  });

  it("非会员纯文本错误：不崩，原文留在 raw.text", () => {
    const n = normalizeDreaminaOutput("current account is not maestro vip");
    expect(n.submitId).toBe("");
    expect(n.genStatus).toBe("");
    expect((n.raw as { text?: string }).text).toMatch(/maestro vip/);
  });
});

describe("命令参数校验/归一", () => {
  it("clampDreaminaDuration 按区间夹取", () => {
    expect(clampDreaminaDuration(4)).toBe(4);
    expect(clampDreaminaDuration(99)).toBe(15);
    expect(clampDreaminaDuration(0)).toBe(4);
    expect(clampDreaminaDuration("abc")).toBe(5);
    expect(clampDreaminaDuration(undefined)).toBe(5);
    expect(clampDreaminaDuration(7, 3, 10)).toBe(7);
  });

  it("normalizeDreaminaRatio 非法回落空串", () => {
    expect(normalizeDreaminaRatio("16:9")).toBe("16:9");
    expect(normalizeDreaminaRatio("5:7")).toBe("");
    expect(normalizeDreaminaRatio(undefined)).toBe("");
  });

  it("normalizeDreaminaVideoResolution：1080p 仅 vip", () => {
    expect(normalizeDreaminaVideoResolution("seedance2.0_vip", "1080p")).toBe("1080p");
    expect(normalizeDreaminaVideoResolution("seedance2.0fast", "1080p")).toBe("720p");
    expect(normalizeDreaminaVideoResolution("seedance2.0", "720p")).toBe("720p");
  });
});

describe("登录 / 账户状态解析", () => {
  it("parseDeviceFlow 抠出设备码材料（真实输出形态）", () => {
    const out = [
      "请使用浏览器完成 OAuth Device Flow 登录。",
      "verification_uri: https://jimeng.jianying.com/ai-tool/cli-auth?x=1",
      "user_code: c8c9210b04f4",
      "device_code: dfe55f0b390a",
      "poll_interval: 1s",
      "expires_at: 2026-06-24T20:22:13+08:00",
    ].join("\n");
    const flow = parseDeviceFlow(out);
    expect(flow?.userCode).toBe("c8c9210b04f4");
    expect(flow?.deviceCode).toBe("dfe55f0b390a");
    expect(flow?.verificationUri).toMatch(/^https:\/\/jimeng/);
    expect(flow?.expiresAt).toMatch(/2026-06-24/);
  });

  it("parseDeviceFlow 缺字段返回 null", () => {
    expect(parseDeviceFlow("登录失败，请重试")).toBeNull();
  });

  it("parseAccountStatus 已登录（真实 user_credit JSON）", () => {
    const s = parseAccountStatus('{"total_credit":80,"user_id":682162091204269,"user_name":"","vip_level":""}');
    expect(s.loggedIn).toBe(true);
    expect(s.totalCredit).toBe(80);
    expect(s.userId).toBe("682162091204269");
    expect(s.vipLevel).toBe("");
  });

  it("parseAccountStatus 未登录（纯文本）", () => {
    const s = parseAccountStatus("未检测到有效登录态，请先执行 dreamina login");
    expect(s.loggedIn).toBe(false);
    expect(s.totalCredit).toBeNull();
  });

  it("isNotMaestroVip 识别非会员闸", () => {
    expect(isNotMaestroVip("current account is not maestro vip")).toBe(true);
    expect(isNotMaestroVip("当前账号没有 dreamina_cli 使用权限")).toBe(true);
    expect(isNotMaestroVip("success")).toBe(false);
  });
});

describe("describeDreaminaFailure（治「用不了」黑洞）", () => {
  it("静默失败（exit≠0 + 输出全空）→ 给会员/网页授权两条最可能原因，不甩 exit=1", () => {
    const msg = describeDreaminaFailure(1, "", "");
    expect(msg).not.toMatch(/^即梦 CLI 调用失败：exit=1$/);
    expect(msg).toMatch(/会员/);
    expect(msg).toMatch(/授权/);
    expect(msg).toMatch(/exit=1/); // 仍带原始码便于排错
  });

  it("命中 AigcComplianceConfirmationRequired → 指引网页端授权", () => {
    const msg = describeDreaminaFailure(1, "", "submit failed: AigcComplianceConfirmationRequired");
    expect(msg).toMatch(/网页端|jimeng\.jianying\.com/);
    expect(msg).toMatch(/授权/);
  });

  it("命中非会员闸 → 指引开通会员", () => {
    expect(describeDreaminaFailure(1, "", "current account is not maestro vip")).toMatch(/会员/);
  });

  it("有原始错误文本时透传（截断保护）", () => {
    expect(describeDreaminaFailure(2, "", "invalid param: duration out of range")).toMatch(/invalid param/);
  });

  it("isComplianceConfirmationRequired 识别授权闸", () => {
    expect(isComplianceConfirmationRequired("AigcComplianceConfirmationRequired")).toBe(true);
    expect(isComplianceConfirmationRequired("一切正常")).toBe(false);
  });
});
