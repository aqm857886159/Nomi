// multipart/form-data transport 执行器（P4 声明驱动，与 processOperation 同构：runtime 建好 context +
// 注入依赖，本模块只做「渲染 op.multipart → 取参考图字节 → 组 FormData → 发送」，不含 vendor 逻辑、
// 不 import runtime（避循环依赖）。为什么单开：Nomi 主路 requestJson 只发 JSON body，而 OpenAI 官方
// /v1/images/edits 图生图收的是 image[] 二进制文件字段——两种 wire，声明式各走各的（见 types.HttpOperation.multipart）。

import { renderTemplateValue } from "../ai/requestPipeline";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { templateContext, buildProfileHttpRequest } from "./profileHttpRequest";
import type { HttpOperation, Model, Vendor } from "./types";
import type { TaskRequest } from "../runtime";

type MultipartSpec = NonNullable<HttpOperation["multipart"]>;

/** 参考图 URL → 字节（nomi-local 读本地零网络 / http/data 取字节）。null = 取不到（调用方抛人话错误）。 */
export type MultipartImageResolver = (url: string) => Promise<{ bytes: Buffer; contentType: string; fileName: string } | null>;

/** 具体参考图取字节实现（runtime 注入 executeMultipartOperation）：nomi-local 直读本地字节；data: 解码；http(s) 取回。 */
export const resolveReferenceImageBytes: MultipartImageResolver = async (url) => {
  const local = readNomiLocalAsset(url);
  if (local) return { bytes: local.bytes, contentType: local.contentType, fileName: local.fileName };
  if (/^data:/i.test(url)) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(url);
    if (!match) return null;
    const contentType = match[1] || "image/png";
    const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { bytes, contentType, fileName: `image.${contentType.split("/").pop() || "png"}` };
  }
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    const fileName = url.split("/").pop()?.split("?")[0] || `image.${contentType.split("/").pop() || "png"}`;
    return { bytes, contentType, fileName };
  }
  return null;
};
/** 把组好的 FormData 发出去（runtime 注入 requestMultipart 闭包，带 vendor/apiKey/url/headers）。 */
export type MultipartSender = (form: FormData) => Promise<unknown>;

const REF_URL_RE = /^(https?:\/\/|nomi-local:\/\/|data:|blob:|\/)/i;

/** 渲染 multipart op → FormData → 发送。文本字段走模板；imageSource 解析出的参考图逐个取字节当文件上传。 */
export async function executeMultipartOperation(input: {
  multipart: MultipartSpec;
  context: Record<string, unknown>;
  resolveImage: MultipartImageResolver;
  send: MultipartSender;
}): Promise<{ response: unknown; request: unknown }> {
  const spec = input.multipart;

  // 1. 文本字段（与 body 同一套 renderTemplateValue；丢 undefined/null/空串——严格端点收到空字段会 400）。
  const rendered = renderTemplateValue(spec.fields || {}, input.context);
  const textFields: Record<string, string> = {};
  if (rendered && typeof rendered === "object" && !Array.isArray(rendered)) {
    for (const [key, value] of Object.entries(rendered as Record<string, unknown>)) {
      if (value === undefined || value === null || value === "") continue;
      textFields[key] = typeof value === "string" ? value : String(value);
    }
  }

  // 2. 参考图 URL(s)。整 token 渲染 → string | string[]；只留 URL 形状的值。
  const source = renderTemplateValue(spec.imageSource, input.context);
  const urls = (Array.isArray(source) ? source : [source]).filter(
    (u): u is string => typeof u === "string" && REF_URL_RE.test(u.trim()),
  );
  const picked = spec.multiple ? urls : urls.slice(0, 1);
  if (picked.length === 0) {
    // 到这一步没参考图=上游护栏漏了（imageEditGuardError 本应在付费前拦），诚实抛而非发一个无图的 edits。
    throw new Error("图生图缺参考图：/v1/images/edits 需要至少一张参考图");
  }

  // 3. 逐个取字节（顺序取，量小；失败即抛人话，不静默丢图发半套）。
  const files: Array<{ bytes: Buffer; contentType: string; fileName: string }> = [];
  for (const url of picked) {
    const asset = await input.resolveImage(url);
    if (!asset || !asset.bytes || asset.bytes.byteLength === 0) {
      throw new Error(`图生图参考图取字节失败：${url.slice(0, 96)}`);
    }
    files.push(asset);
  }

  // 4. 组 FormData（文本字段 + 二进制文件；不设 Content-Type，requestMultipart 里已剥、fetch 自动加 boundary）。
  const prefix = spec.filename || "image";
  const form = new FormData();
  for (const [key, value] of Object.entries(textFields)) form.append(key, value);
  files.forEach((file, i) => {
    const ab = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    const fileName = file.fileName || `${prefix}-${i}.png`;
    form.append(spec.imageField, new Blob([ab], { type: file.contentType || "image/png" }), fileName);
  });

  const response = await input.send(form);
  return {
    response,
    // preview（脱去字节，只留形状供诊断/日志，绝不落原图字节）。
    request: {
      multipart: true,
      fields: textFields,
      imageField: spec.imageField,
      images: files.map((f, i) => ({ fileName: f.fileName || `${prefix}-${i}.png`, contentType: f.contentType, byteLength: f.bytes.byteLength })),
    },
  };
}

/**
 * multipart profile op 的完整分发（runtime 只需一行委托即可，giant-shell 不再长胖）：自建 context + URL/头 +
 * 取字节 + 发送。与 executeProfileOperation 的 JSON 路同构（同一套 buildTemplateContext/buildHttpRequest），
 * 但走 FormData。requestMultipart 由 runtime 注入（避免反向依赖 vendorHttp 的 vendor 计费上下文）。
 */
export async function runMultipartProfileOperation(
  input: { vendor: Vendor; model: Model; apiKey: string; request: TaskRequest; operation: HttpOperation; providerMeta?: Record<string, unknown> },
  sendMultipart: (url: string, headers: Record<string, string>, query: Record<string, unknown>, form: FormData) => Promise<unknown>,
): Promise<{ response: unknown; request: unknown }> {
  // 与 JSON 路共用 profileHttpRequest 构造（P1 不另造一套）：context 渲染 multipart.fields，built 出 url/headers。
  const context = templateContext(input.request, input.model, input.apiKey, input.providerMeta || {}, input.operation.paramMap);
  const built = buildProfileHttpRequest(input);
  return executeMultipartOperation({
    multipart: input.operation.multipart!,
    context,
    resolveImage: resolveReferenceImageBytes,
    send: (form) => sendMultipart(built.url, built.headers, built.query, form),
  });
}
