// 类级测试（出站参考链接第 2 轮）：出站参考链接在参数层统一序列化——全部内置 mapping × 模板读到的每个参考参数。
//
// 认「哪些参数是参考」只用共享键表 GENERIC_REFERENCE_KEYS（shared/modelArchetypes/referenceKeys.ts，由档案声明推导，
// 完整性由 referenceSentWithinInUse.property.test.ts 的「键表完整性」普查守），**不用被测代码自己的判据过滤**。
// 每条 mapping：取它的模板（body / query / path / headers / multipart / 进程 args）读到的参考参数，每个参数塞一条
// 带空格的链接（按这个键真实的值形状：字符串 / 数组 / [{url, role}] / 火山 content 项），和 runtime.runTask 同顺序
// 走真实的参数构建（assertNoReferenceResidueBeforeSend → applyHeadlessParamDefaults → buildProfileHttpRequest，
// 即 templateContext → taskTemplateParams → applyParamMap → 模板渲染），断言渲染出的请求里没有原样空格、
// 序列化后的链接到了。认得出档案的模型再把同样的值放进 archetypeInput（渲染层交给主进程的形状）各走一遍。
//
// 第三条路：headless / MCP 调用方只给标准输入键（referenceImages / firstFrameUrl …），参考由主进程投影落位。
//
// 拿这份测试跑 main（没有这条修复）：373 格红 368 格。跑第 1 轮（d2ad49331：按「发出去的字段名」另写一张键表、
// 在请求体 / multipart 上补救）：红 51 格——平铺 18 条 mapping、archetypeInput 路同一批 18 条、标准输入键路 14 条 +
// 覆盖面 1 格。红的都是字段名不在那张表里的（video_list / audio_ids / uploadUrl / firstImageUrl / input_urls /
// audio_setting …）：seed-elevenlabs-scribe-v2 的 multipart 取字节源由第 1 轮另一道门在取字节时补上，其余都把原样
// 空格发了出去。改后参数层一处收口，全绿。
import { describe, expect, it } from "vitest";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { buildProfileHttpRequest, templateContext } from "./profileHttpRequest";
import { applyHeadlessParamDefaults } from "./taskParams";
import { bodyReferencedParamKeys } from "./paramTranslate";
import { renderTemplateValue } from "../ai/requestPipeline";
import { assertNoReferenceResidueBeforeSend } from "../tasks/referenceResidueGuard";
import { GENERIC_REFERENCE_KEYS } from "../shared/modelArchetypes/referenceKeys";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import type { CatalogState, HttpOperation, Mapping, Model, Vendor } from "./types";
import type { TaskRequest } from "../runtime";

/** 用户报的形状：Windows 文件名里的空格（0.23.1，APIMart MiniMax-H3 图生视频）。 */
const RAW = "https://cdn.example.com/Windows ref.png";
const SERIALIZED = "https://cdn.example.com/Windows%20ref.png";
const LOOPBACK = "http://127.0.0.1:9";

const SEEDED = applyBuiltinSeeds(
  { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState,
  "2026-10-25T00:00:00.000Z",
).state;

/** 一条 create op 的全部模板位置（HTTP 的 path / headers / query / body，multipart 的文本字段与取字节源，进程 args）。 */
function templateParts(op: HttpOperation): Record<string, unknown> {
  return {
    path: op.path,
    headers: op.headers,
    query: op.query,
    body: op.body,
    multipartFields: op.multipart?.fields,
    multipartSource: op.multipart?.fileSource ?? op.multipart?.imageSource,
    processArgs: op.process?.args,
  };
}

/** 模板读到的参考参数——判据只用共享键表，不用被测代码的。 */
function referenceParamsRead(op: HttpOperation): string[] {
  return [...new Set(bodyReferencedParamKeys(templateParts(op)))].filter((key) => GENERIC_REFERENCE_KEYS.has(key)).sort();
}

/** 这个参考键真实的值形状（同 referenceSentWithinInUse.property.test.ts 的 strayValueFor）。 */
function referenceValue(key: string, url: string): unknown {
  if (/with_?roles$/i.test(key)) return [{ url, role: "reference_image" }];
  if (/_contents$/.test(key)) return [{ type: "image_url", image_url: { url }, role: "reference_image" }];
  if (/_content$/.test(key)) return { type: "image_url", image_url: { url }, role: "first_frame" };
  return /(s|_list|_ids)$/.test(key) ? [url] : url;
}

function transportFor(mapping: Mapping): { vendor: Vendor; model: Model; archetypeId?: string } {
  const vendor = SEEDED.vendors.find((candidate) => candidate.key === mapping.vendorKey);
  const model = SEEDED.models.find((candidate) => candidate.vendorKey === mapping.vendorKey && candidate.modelKey === mapping.modelKey)
    ?? ({ vendorKey: mapping.vendorKey, modelKey: mapping.modelKey || "generic", labelZh: mapping.modelKey || "generic", kind: "video", enabled: true } as Model);
  const archetypeId = (model.meta as { archetypeId?: unknown } | undefined)?.archetypeId;
  return {
    vendor: { ...(vendor ?? { key: mapping.vendorKey, name: mapping.vendorKey, enabled: true, authType: "bearer" }), baseUrlHint: LOOPBACK } as Vendor,
    model,
    ...(typeof archetypeId === "string" ? { archetypeId } : {}),
  };
}

/** 和 runtime.runTask 同顺序建出这条 mapping 要发的东西（渲染结果，传输层之前）。 */
function renderedRequest(mapping: Mapping, extras: Record<string, unknown>): string {
  const { vendor, model, archetypeId } = transportFor(mapping);
  const guarded = assertNoReferenceResidueBeforeSend(structuredClone(extras), mapping.id);
  const defaulted = applyHeadlessParamDefaults(guarded, archetypeId, mapping.taskKind, vendor.key,
    mapping.create.defaultParams, mapping.create.body, model.modelKey);
  const request = { kind: mapping.taskKind, prompt: "一个镜头", extras: defaulted } as TaskRequest;
  const built = buildProfileHttpRequest({ vendor, model, apiKey: "k", request, operation: mapping.create });
  const context = templateContext(request, model, "k", {}, mapping.create);
  return JSON.stringify({
    url: built.url,
    headers: built.headers,
    query: built.query,
    body: built.body,
    multipart: renderTemplateValue({ fields: mapping.create.multipart?.fields, source: mapping.create.multipart?.fileSource ?? mapping.create.multipart?.imageSource }, context),
    processArgs: renderTemplateValue(mapping.create.process?.args, context),
  });
}

type Cell = { id: string; keys: string[]; mapping: Mapping };

const FLAT: Cell[] = SEEDED.mappings
  .map((mapping) => ({ id: mapping.id, keys: referenceParamsRead(mapping.create), mapping }))
  .filter((cell) => cell.keys.length > 0);

/** archetypeInput 路的总体：模型行认得出档案（渲染层才会交 archetypeInput）。 */
const ARCHETYPE: Cell[] = FLAT.filter(({ mapping }) => {
  const { model } = transportFor(mapping);
  return Boolean(resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: mapping.vendorKey, meta: model.meta as Record<string, unknown> | undefined }));
});

const extrasWith = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, referenceValue(key, RAW)]));

describe(`出站参考链接：参数层序列化覆盖 ${FLAT.length} 条内置 mapping（平铺参数 / 标准输入键两条路）+ ${ARCHETYPE.length} 条（archetypeInput 路）`, () => {
  it("覆盖面：内置 mapping 里读参考参数的至少 120 条、档案路至少 120 条，模板读到的参考键至少 40 个", () => {
    expect(FLAT.length).toBeGreaterThanOrEqual(120);
    expect(ARCHETYPE.length).toBeGreaterThanOrEqual(120);
    expect(new Set(FLAT.flatMap((cell) => cell.keys)).size).toBeGreaterThanOrEqual(40);
  });

  it.each(FLAT)("平铺参数 $id 读 $keys：请求里没有原样空格，序列化后的链接到了", ({ mapping, keys }) => {
    const sent = renderedRequest(mapping, extrasWith(keys));
    expect(sent).not.toContain(RAW);
    expect(sent).toContain(SERIALIZED);
  });

  it.each(ARCHETYPE)("archetypeInput 路 $id 读 $keys：请求里没有原样空格，序列化后的链接到了", ({ mapping, keys }) => {
    const sent = renderedRequest(mapping, { archetypeInput: extrasWith(keys) });
    expect(sent).not.toContain(RAW);
    expect(sent).toContain(SERIALIZED);
  });

  // headless / MCP 调用方只给标准输入键：参考由主进程翻译、按请求体读的键投影落位（projectReferencesOntoBodyKeys），
  // 落到的键不一定在共享键表里（Wan 3.0 / Kling 3.0 的 audio、RunningHub 的 generateAudio …）。
  const CANONICAL = { referenceImages: [RAW], firstFrameUrl: RAW, lastFrameUrl: RAW, referenceVideoUrls: [RAW], referenceAudioUrls: [RAW] };
  it.each(FLAT)("标准输入键路 $id：请求里没有原样空格", ({ mapping }) => {
    expect(renderedRequest(mapping, CANONICAL)).not.toContain(RAW);
  });

  it("标准输入键路覆盖面：至少 120 条 mapping 的请求里收到了序列化后的参考", () => {
    const reached = FLAT.filter(({ mapping }) => renderedRequest(mapping, CANONICAL).includes(SERIALIZED));
    expect(reached.length).toBeGreaterThanOrEqual(120);
  });
});
