// 读**用户自己 ComfyUI 里的官方模板库**（T2 · 2026-08-02 拍板）。
//
// 用户摩擦：装完 ComfyUI 打开 Nomi，只看到一个写死的「本地·文生图」，不知道这台机器还能干什么——
// 而他的 ComfyUI 里躺着 493 个官方模板（实测 0.29.0：图片 157 / 视频 144 / 用例 48 / 音频 25 /
// 3D 33 / 工具 54…），里面有「分镜转视频」「参考图控一致性」这些正是做漫剧要的。
//
// 关键判断：**我们不维护模板库，我们读他的**——他装了什么就看到什么，ComfyUI 升级模板跟着更新，
// 我们零维护、零版权问题（模板包是 MIT，且官方硬性要求模板不用第三方节点，不会因缺节点包首跑必炸）。
//
// 端点实查（ComfyUI server.py:1262-1270 静态挂载 + 真机验证）：
//   GET {base}/templates/index.json  → 分组数组，每组 {moduleName, category, title, type, templates[]}
//                                       每条 {name, title, description, mediaType, mediaSubtype, tags, tutorialUrl}
//   GET {base}/templates/{name}.json → 工作流本体（**界面格式**，要经 comfyuiGraphConvert 转）
//   GET {base}/templates/{name}-1.webp → 预览图（mediaSubtype 决定后缀）
import { fetchComfyuiObjectInfoIndex } from "./comfyuiObjectInfo";
import { collectGraphEnumOptions, parseComfyApiWorkflow, reconcileComfyWorkflow, type MissingEnumValue } from "./catalog/comfyuiWorkflowImport";
import { convertUiWorkflowToApi } from "./comfyuiGraphConvert";
import { normalizeComfyuiBaseUrl } from "./comfyui/endpointResolver";
import { appFetch } from "./appFetch";

export type ComfyTemplateEntry = {
  name: string;
  title: string;
  description: string;
  /** 官方分组标题（Image/Video/Use Cases/Audio/3D Model/Utility…）。 */
  group: string;
  /** 官方组的 type（image/video/audio/3d），用来在 UI 分类。 */
  groupType: string;
  tags: string[];
  tutorialUrl: string;
  /** 预览图 URL（拼好的绝对地址；没有则空串）。 */
  thumbnailUrl: string;
};

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeBase(baseUrl: string): string {
  return normalizeComfyuiBaseUrl(baseUrl);
}

/** 纯解析（可单测）：官方 index.json → 扁平模板清单。任何异形字段都跳过、不抛。 */
export function parseTemplateIndex(json: unknown, baseUrl = ""): ComfyTemplateEntry[] {
  if (!Array.isArray(json)) return [];
  const base = normalizeBase(baseUrl);
  const out: ComfyTemplateEntry[] = [];
  for (const group of json) {
    if (!isRec(group) || !Array.isArray(group.templates)) continue;
    const groupTitle = typeof group.title === "string" ? group.title : "";
    const groupType = typeof group.type === "string" ? group.type : "";
    for (const t of group.templates) {
      if (!isRec(t) || typeof t.name !== "string" || !t.name) continue;
      const subtype = typeof t.mediaSubtype === "string" ? t.mediaSubtype : "";
      out.push({
        name: t.name,
        title: typeof t.title === "string" && t.title ? t.title : t.name,
        description: typeof t.description === "string" ? t.description : "",
        group: groupTitle,
        groupType,
        tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === "string") : [],
        tutorialUrl: typeof t.tutorialUrl === "string" ? t.tutorialUrl : "",
        thumbnailUrl: subtype ? `${base}/templates/${t.name}-1.${subtype}` : "",
      });
    }
  }
  return out;
}

const cache = new Map<string, { at: number; value: ComfyTemplateEntry[] }>();
const CACHE_TTL_MS = 60_000;

export function _resetTemplateCacheForTest(): void {
  cache.clear();
}

/** 拉模板清单。null = 连不上/这台 ComfyUI 没有模板包（UI 说「未连接」，不当错误报）。 */
export async function fetchComfyuiTemplates(baseUrl: string): Promise<ComfyTemplateEntry[] | null> {
  const base = normalizeBase(baseUrl);
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const res = await appFetch(`${base}/templates/index.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const list = parseTemplateIndex(await res.json(), base);
    if (list.length === 0) return null;
    cache.set(base, { at: Date.now(), value: list });
    return list;
  } catch {
    return null;
  }
}

export type TemplateDetail = {
  /** 转好的 API 格式文本（可直接喂既有导入链）。 */
  apiText: string;
  /** 官方模板的 UI workflow，随提交写进 extra_pnginfo 以便在 ComfyUI 继续编辑。 */
  uiWorkflowText: string;
  unknownNodeTypes: string[];
  missingEnumValues: MissingEnumValue[];
  enumOptions: ReturnType<typeof collectGraphEnumOptions>;
  serverReachable: boolean;
};

/**
 * 取一个模板并备好导入所需的一切：拉本体（界面格式）→ 借前端转 API → 对账缺件 → 收 combo 选项。
 * 一次问清「这条能不能在你机器上跑、缺什么」，用户点开就看到答案（不是点了启用才发现缺 13GB）。
 */
export async function fetchComfyuiTemplateDetail(baseUrl: string, name: string): Promise<TemplateDetail | { error: string }> {
  const base = normalizeBase(baseUrl);
  const safeName = String(name || "").trim();
  if (!safeName || !/^[\w.-]+$/.test(safeName)) return { error: "模板名不合法" };
  let uiText: string;
  try {
    const res = await appFetch(`${base}/templates/${safeName}.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { error: `取模板失败（HTTP ${res.status}）` };
    uiText = await res.text();
  } catch {
    return { error: "没连上 ComfyUI，取不到模板" };
  }

  // 官方模板全是界面格式 → 必须转（这正是 T1 存在的理由）。
  const converted = await convertUiWorkflowToApi(base, uiText);
  if (!converted.ok) return { error: `模板格式转换失败：${converted.error}` };
  const apiText = JSON.stringify(converted.api, null, 2);

  let graph;
  try {
    graph = parseComfyApiWorkflow(apiText);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const index = await fetchComfyuiObjectInfoIndex(base);
  if (!index) {
    return { apiText, uiWorkflowText: uiText, unknownNodeTypes: [], missingEnumValues: [], enumOptions: [], serverReachable: false };
  }
  const rec = reconcileComfyWorkflow(graph, index);
  return { apiText, uiWorkflowText: uiText, ...rec, enumOptions: collectGraphEnumOptions(graph, index), serverReachable: true };
}
