import { describe, expect, it } from "vitest";

import { isReferenceFetchRefusal } from "./referenceFetchRefusal";

type Case = [label: string, input: { upstreamCode?: string; text?: string }];

// 判据的真实例子。每条旁边写它的来源形态（服务商文档 / 社区里的原话 / 用户反馈里的整句）。
const REPORTED = "An input media URL could not be fetched (403/404/410).";

const REFUSALS: Case[] = [
  // 用户反馈的那一句，三种报错形式：纯文字 / 带诊断前缀 / 结构化 400 里的 JSON 信封
  ["用户反馈原句（纯文字）", { text: REPORTED }],
  ["带我们的诊断前缀", { text: `Provider request failed (HTTP 400) at relay POST https://relay.example.com/v1/videos: ${REPORTED}` }],
  ["JSON 信封里的 message", { text: `{"error":{"message":"${REPORTED}","type":"invalid_request_error"}}` }],
  // 上游错误码：先认码，文字可以是任何话
  ["码 file_download_error", { upstreamCode: "file_download_error", text: "Unprocessable Entity" }],
  ["码 invalid_image_url（大小写与连字符不影响）", { upstreamCode: "Invalid-Image-URL", text: "" }],
  // 通用英文说法
  ["输入图片下载失败", { text: "Failed to download input image from URL" }],
  ["拉不到提供的链接", { text: "Cannot fetch content from the provided URL." }],
  ["只说文件（无链接词）", { text: "Unable to download the file. Please verify the URL and try again." }],
  ["下载超时（带链接，链接被抠掉）", { text: "Timeout while downloading https://cdn.example.com/a.png." }],
  ["下载出错", { text: "Error while downloading https://cdn.example.com/a.png." }],
  ["参考图链接不可访问", { text: "The reference image URL is not accessible." }],
  ["输入链接返回 403", { text: "input_image URL returned 403 Forbidden" }],
  ["参考视频链接已过期", { text: "The reference video link has expired" }],
  ["同一句里带了任务号，但说的是输入", { text: "Task failed: could not download input image" }],
  // 中文
  ["中文：无法获取参考图", { text: "无法获取参考图片，请检查链接是否可访问" }],
  ["中文：下载输入图片失败", { text: "下载输入图片失败（HTTP 403）" }],
  ["中文：参考图链接已过期", { text: "参考图链接已过期或无法访问" }],
  ["中文：输入媒体 URL 无法获取", { text: "输入媒体 URL 无法获取（403/404/410）" }],
];

// 说法长得像、但说的是别的失败：取结果 / 下载产物 / 任务 / 上传 / 模型 / 拦截。它们的下一步各不相同，不能进这张卡。
const NOT_REFUSALS: Case[] = [
  ["我们自己取结果失败", { text: "Fetch failed: HTTP 403" }],
  ["下载生成产物失败", { text: "Failed to download the generated video from https://cdn.example.com/out.mp4" }],
  ["取任务结果失败", { text: "Failed to fetch task result from the URL" }],
  ["下载结果失败（HTTP 502）", { text: "Download of the result failed (HTTP 502)" }],
  ["产物链接拉不到", { text: "The output URL could not be fetched." }],
  ["模型不存在", { text: "The model `x-pro` does not exist or you do not have access to it" }],
  ["任务超时", { text: "Task timed out after 600s" }],
  ["中文：任务超时", { text: "任务超时，请稍后重试" }],
  ["内容拦截（输入图可能含真人）", { text: "The request failed because the input image 'content[1]' may contain real person" }],
  ["素材上传失败", { text: "素材上传失败：a.png（1.2MB）的所有上传通道都没成功，所以还没请求这次选的服务商。" }],
  ["中文：参考素材读不到（我们本机检查）", { text: "参考素材的本地文件读取失败（可能已被删除或随项目迁移）。" }],
  ["网络层 fetch failed", { text: "Provider request failed (network) at relay GET https://relay.example.com/v1/tasks/abc: fetch failed" }],
  ["余额不足", { text: "Insufficient balance" }],
  ["不相关的错误码", { upstreamCode: "model_not_found", text: "" }],
  ["空", { text: "" }],
];

describe("isReferenceFetchRefusal：模型拉不到参考链接", () => {
  it.each(REFUSALS)("%s → 是", (_label, input) => {
    expect(isReferenceFetchRefusal(input)).toBe(true);
  });

  it.each(NOT_REFUSALS)("%s → 否", (_label, input) => {
    expect(isReferenceFetchRefusal(input)).toBe(false);
  });

  it("没有说法也没有码 → 否", () => {
    expect(isReferenceFetchRefusal({})).toBe(false);
  });

  it("两张表的体量：真实说法至少 12 条为真，别的失败至少 8 条为假（判据去掉排除词时假例会变真）", () => {
    expect(REFUSALS.length).toBeGreaterThanOrEqual(12);
    expect(NOT_REFUSALS.filter(([, input]) => Boolean(input.text || input.upstreamCode)).length).toBeGreaterThanOrEqual(8);
  });

  it("排除词只看同一句：下一句里的 task 不拖累「下载超时」这句；同一句明说下载的是结果就不算", () => {
    expect(isReferenceFetchRefusal({ text: "Timeout while downloading https://cdn.example.com/a.png. The task was queued again." })).toBe(true);
    expect(isReferenceFetchRefusal({ text: "Error while downloading the result file." })).toBe(false);
  });

  it("链接路径里的 tasks / results 不是证据（整段 URL 先抠掉）", () => {
    expect(isReferenceFetchRefusal({ text: "Failed to download input image from https://relay.example.com/v1/tasks/results/9" })).toBe(true);
    expect(isReferenceFetchRefusal({ text: "GET https://relay.example.com/v1/tasks/9/results failed" })).toBe(false);
  });
});
