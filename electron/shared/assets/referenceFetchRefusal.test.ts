import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { enBrowserAssets, zhBrowserAssets } from "../../../src/i18n/locales/browserAssets";
import { desktopT } from "../../desktopStrings";
import { isReferenceFetchRefusal } from "./referenceFetchRefusal";

type Case = [label: string, input: { upstreamCode?: string; text?: string }];

// 判据的真实例子。每一条都是原话，出处写在 referenceFetchRefusal.ts 的表里。
const REPORTED = "An input media URL could not be fetched (403/404/410).";

const REFUSALS: Case[] = [
  // 用户反馈的那一句，四种报错形式：纯文字 / 带诊断前缀 / 结构化 400 里的 JSON 信封 / 换行和多空格
  ["用户反馈原句（纯文字）", { text: REPORTED }],
  ["带我们的诊断前缀", { text: `Provider request failed (HTTP 400) at relay POST https://relay.example.com/v1/videos: ${REPORTED}` }],
  ["JSON 信封里的 message", { text: `{"error":{"message":"${REPORTED}","type":"invalid_request_error"}}` }],
  ["换行和多空格", { text: "An input  media URL\ncould not be fetched." }],
  // 上游错误码：先认码，文字可以是任何话
  ["码 file_download_error", { upstreamCode: "file_download_error", text: "Unprocessable Entity" }],
  ["码 invalid_image_url（大小写与连字符不影响）", { upstreamCode: "Invalid-Image-URL", text: "" }],
  ["码 image_download_failed", { upstreamCode: "image_download_failed" }],
  ["码 failed_to_download_image", { upstreamCode: "failed_to_download_image" }],
  ["码 InvalidURL.Timeout", { upstreamCode: "InvalidURL.Timeout" }],
  ["码 InvalidURL.ConnectionRefused", { upstreamCode: "InvalidURL.ConnectionRefused" }],
  ["码 BadRequest.InputDownloadFailed", { upstreamCode: "BadRequest.InputDownloadFailed" }],
  // 码被原样带进了错误文字
  ["文字里的码（JSON 信封）", { text: '{"detail":[{"loc":["body","image_url"],"msg":"File download error","type":"file_download_error"}]}' }],
  ["文字里的码（带点的）", { text: '{"code":"InvalidURL.Timeout","message":"Download xxx timeout, please check network connection."}' }],
  // 一家模型 API 的文档与论坛
  ["参考图下载失败", { text: "Reference image download failed, please check image url." }],
  ["下载超时（带链接）", { text: "Timeout while downloading https://cdn.example.com/a.png." }],
  ["下载出错（带链接）", { text: "Error while downloading https://cdn.example.com/a.png." }],
  ["带签名的链接：链接里的 token、credential 不是证据", { text: "Timeout while downloading https://bucket.example.com/a.png?X-Amz-Credential=abc&X-Amz-Security-Token=def." }],
  // 一家云厂商模型平台的错误码文档
  ["多模态内容下载失败", { text: "Failed to download multimodal content." }],
  ["数据检查时下载超时", { text: "Download the media resource timed out during the data inspection process." }],
  ["数据检查时下载不了", { text: "Unable to download the media resource during the data inspection process." }],
  ["数据检查时找不到资源", { text: "Failed to find the requested media resource during the data inspection process." }],
  ["数据检查时没权限（签名过期）", { text: "Don't have authorization to access the media resource during the data inspection process." }],
  ["输入文件下载失败（复数）", { text: "Failed to download input files." }],
  ["输入文件下载失败（带详情）", { text: "Failed to download the input file: 403 Forbidden." }],
  ["连接被拒", { text: "Connection to cdn.example.com refused, please provide available URL." }],
  ["链接不可用", { text: "The request URL is invalid, please check the request URL is available" }],
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
  ["账户额度用完", { text: "The account has run out of credit for this request" }],
  ["不相关的错误码", { upstreamCode: "model_not_found", text: "" }],
  // 这个判据全 App 的错误都会问（画布节点、Agent 面板、分镜、浏览器提取），下面这些都不是「模型拉不到参考」
  ["本机读文件失败", { text: "Failed to read the file: ENOENT: no such file or directory" }],
  ["界面加载图片失败", { text: "Could not load the image preview" }],
  ["连不上接口地址", { text: "Failed to access the API URL" }],
  ["连不上 base URL", { text: "Could not reach the base URL" }],
  ["中转站连不上它的上游", { text: "Failed to fetch upstream URL" }],
  ["我们自己的转写报错（中文）", { text: desktopT("transcribe.unreachable", {}, "zh-CN") }],
  ["我们自己的转写报错（英文）", { text: desktopT("transcribe.unreachable", {}, "en") }],
  ["中文：接口地址无法访问", { text: "接口地址无法访问，请检查连接" }],
  ["中文：接口 URL 无法访问", { text: "接口 URL 无法访问" }],
  // 审核：下一步是换图，重试不会有用
  ["审核：输入图片未通过", { text: "输入图片未能通过审核" }],
  ["审核：参考图无法通过", { text: "参考图片无法通过内容审核，请更换" }],
  ["审核：不能包含敏感内容", { text: "输入图片不能包含敏感内容" }],
  ["审核：不能包含真人", { text: "参考图不能包含真人" }],
  ["审核：链接因内容政策被拒", { text: "The input image URL is forbidden due to content policy" }],
  ["审核：链接里是违禁内容", { text: "The reference image URL contains forbidden content" }],
  ["审核：法律原因", { text: "Input image URL returned 451 unavailable for legal reasons" }],
  ["审核：动词在前也不算", { text: "Failed to load input image: content policy violation" }],
  ["审核：拿到了但判敏感", { text: "Failed to access input image: sensitive content detected" }],
  ["审核：因为可能含敏感内容", { text: "Could not load the reference image because it may contain sensitive content" }],
  // 鉴权、配额：下一步是换 Key、等一等
  ["鉴权：Key 不对", { text: "Could not fetch input image: invalid api key" }],
  ["鉴权：401", { text: "Failed to fetch input image: 401 Unauthorized" }],
  ["配额：限流", { text: "Cannot load input: rate limit exceeded" }],
  ["配额：余额不足", { text: "Failed to access source: insufficient balance" }],
  // 模型、参数：说的不是参考素材
  ["模型：访问不了", { text: "Unable to access model, please check your input" }],
  ["模型：带着链接也不算", { text: "Unable to access this model with the provided link" }],
  ["模型：从源加载", { text: "Failed to load model from source" }],
  ["模型：列表", { text: "Failed to retrieve model list, see link" }],
  ["模型：权重", { text: "Error while downloading model weights" }],
  ["参数：输入参数", { text: "Failed to load input parameters" }],
  ["参数：输入结构", { text: "Cannot load input schema" }],
  ["参数：输入字段", { text: "Unable to access input field 'seed'" }],
  ["参数：格式", { text: "Could not load input: unsupported format" }],
  // 大小、为空、数量：我们自己的校验或服务商的限制，重试还是同一个错
  ["校验：参考图为空", { text: "参考图片不能为空" }],
  ["校验：大小", { text: "输入图片不能超过 10MB" }],
  ["校验：时长", { text: "参考视频不能超过 15 秒" }],
  ["校验：格式", { text: "输入图片格式不能为 webp" }],
  ["校验：图片本身过期（素材库的话，没说链接）", { text: "参考图片已过期" }],
  ["校验：解析不出源地址", { text: "参考素材 X 解析不出源地址，提示词里的 @ 引用无法投影" }],
  ["校验：别的连接器的下载地址", { text: "这条参考的下载地址已过期（平台给的是短时链接）。" }],
  // 没说是输入、也没有链接：可能是产物或界面，不猜
  ["没说是什么：下载图片", { text: "Failed to download image" }],
  ["没说是什么：下载视频", { text: "Failed to download video" }],
  ["没说是什么：下载文件", { text: "Unable to download the file" }],
  ["没说是什么：取图片", { text: "Failed to fetch image" }],
  ["没说是什么：取图片（缓存）", { text: "Failed to fetch the image from cache" }],
  ["没说是什么：视频状态", { text: "Could not fetch video status" }],
  ["没说是什么：下载超时", { text: "Timeout while downloading" }],
  ["没说是什么：取超时", { text: "Timed out while fetching" }],
  ["产物：后面跟着链接也不算", { text: "Failed to download video from https://cdn.example.com/out.mp4" }],
  ["内置浏览器：素材链接过期", { text: enBrowserAssets.capture.error.notFound }],
  ["内置浏览器：素材链接过期（中文）", { text: zhBrowserAssets.capture.error.notFound }],
  ["我们自己的本机检查：源文件缺失", { text: "This reference image is unavailable because its source file is missing or its link expired: https://cdn.example.com/a.png." }],
  // 通用规则曾经认错的：别的原因在上一句、排除词没列到、产物的链接
  ["审核在上一句", { text: "Request blocked by the safety system. Could not fetch input image." }],
  ["鉴权：token", { text: "Invalid token: could not fetch the image URL." }],
  ["配额：每日上限", { text: "You have reached your daily limit, could not fetch input image." }],
  ["大小：超过上限", { text: "Failed to load input image: file is bigger than 20MB" }],
  ["产物的链接过期", { text: "The generated video URL has expired" }],
  ["产物的链接过期（中文）", { text: "生成的图片链接已过期" }],
  // 真话，但没说是输入：取结果失败也可能这么说
  ["没说是输入：下载文件（带链接）", { text: "Failed to download file from https://cdn.example.com/out.mp4" }],
  ["没说是输入：下载图片", { text: "download image failed" }],
  ["没说是输入：对象存储", { text: "oss download error." }],
  ["没说是输入：链接错误", { text: "url error, please check url!" }],
  ["没说是输入：文件下载错误", { text: "File download error" }],
  ["没跟链接的下载失败", { text: "Error while downloading the result file." }],
  ["链接路径里的 tasks / results 也不是证据", { text: "GET https://relay.example.com/v1/tasks/9/results failed" }],
  ["空", { text: "" }],
];

// 查不到出处的说法：不猜，卡片和以前一样，发送前的试探还在。查实了就加进表里，把这一行删掉。
const UNSOURCED: string[] = [
  "Failed to download input image from URL",
  "Cannot fetch content from the provided URL.",
  "Unable to download the file. Please verify the URL and try again.",
  "Failed to download the file. Please check if the URL is accessible and try again.",
  "The parameter `image_url` specified in the request is not valid: failed to download",
  "Image fetch failed. Check access settings or use our File Upload API instead.",
  "The reference image URL is not accessible.",
  "input_image URL returned 403 Forbidden",
  "The reference video link has expired",
  "Task failed: could not download input image",
  "Failed to retrieve the image from the provided address.",
  "The image at the given URL could not be downloaded.",
  "Error fetching image from URL: 403",
  "Download failed for the input image",
  "无法获取参考图片，请检查链接是否可访问",
  "下载输入图片失败（HTTP 403）",
  "参考图链接已过期或无法访问",
  "输入媒体 URL 无法获取（403/404/410）",
  "图片地址无法访问，请检查后重试",
  "无法访问该图片链接",
];

describe("isReferenceFetchRefusal：模型拉不到参考链接", () => {
  it.each(REFUSALS)("%s → 是", (_label, input) => {
    expect(isReferenceFetchRefusal(input)).toBe(true);
  });

  it.each(NOT_REFUSALS)("%s → 否", (_label, input) => {
    expect(isReferenceFetchRefusal(input)).toBe(false);
  });

  it.each(UNSOURCED)("查不到出处的说法：%s → 否", (text) => {
    expect(isReferenceFetchRefusal({ text })).toBe(false);
  });

  it.each([
    ["minimaxH3.mixedReferences", {}],
    ["minimaxH3.audioOnly", {}],
    ["runway.seedanceEmptyImage", {}],
    ["outbound.referenceUrlInvalid", { field: "image", detail: "bad" }],
  ] as const)("我们自己的发送前校验 %s（中英）→ 否，重试还是同一个错", (key, values) => {
    expect(isReferenceFetchRefusal({ text: desktopT(key, values, "zh-CN") })).toBe(false);
    expect(isReferenceFetchRefusal({ text: desktopT(key, values, "en") })).toBe(false);
  });

  it("只看开头一段：几十 KB 的错误文本也只比开头，4000 字之后的话不算", () => {
    expect(isReferenceFetchRefusal({ text: "a".repeat(200_000) })).toBe(false);
    expect(isReferenceFetchRefusal({ text: `${"a1.".repeat(70_000)} An input media URL could not be fetched.` })).toBe(false);
    expect(isReferenceFetchRefusal({ text: `An input media URL could not be fetched. ${"a1.".repeat(70_000)}` })).toBe(true);
  });

  it("没有说法也没有码 → 否", () => {
    expect(isReferenceFetchRefusal({})).toBe(false);
  });

  it("判句子不用正则：读的是别人写的文字，写错一个量词就能把整个 App 卡死", () => {
    const source = fs.readFileSync(new URL("./referenceFetchRefusal.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/new RegExp|\.test\(|\.exec\(|\.match\(|\.matchAll\(|\.search\(/);
  });

  it("把第 3 轮卡死的那些文字喂进来，只是一次字符串比对", () => {
    for (const text of [`input ${"-".repeat(3990)}`, `input_${"_".repeat(3990)}`, `reference ${"_".repeat(3990)}`, `source ${"-_".repeat(1990)}`, `input ${" ".repeat(3990)}url`]) {
      expect(isReferenceFetchRefusal({ text })).toBe(false);
    }
  });

  it("两张表的体量：真实说法至少 12 条为真，别的失败至少 8 条为假", () => {
    expect(REFUSALS.length).toBeGreaterThanOrEqual(12);
    expect(NOT_REFUSALS.filter(([, input]) => Boolean(input.text || input.upstreamCode)).length).toBeGreaterThanOrEqual(8);
  });

  it("链接后面跟着别的话不影响，链接路径里的 tasks / results 也不影响", () => {
    expect(isReferenceFetchRefusal({ text: "Timeout while downloading https://cdn.example.com/a.png. The task was queued again." })).toBe(true);
    expect(isReferenceFetchRefusal({ text: "Timeout while downloading https://relay.example.com/v1/tasks/results/9" })).toBe(true);
  });
});
