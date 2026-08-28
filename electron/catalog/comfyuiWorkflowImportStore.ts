// 本地 ComfyUI「导入工作流」的 store 集成层（S3 电子侧薄壳）。
// 纯解析/建图/建 model+mapping 在 comfyuiWorkflowImport（可测、零副作用）；这里只接 store 写 + 生成唯一
// modelKey + 把异常包成 { ok:false, error } 供 IPC 透传。独立成文件是为了不把 catalogStore 顶破 800 行门。
import { mutateCatalog, readCatalog } from "./catalogStore";
import {
  parseComfyApiWorkflow,
  analyzeComfyWorkflow,
  collectGraphEnumOptions,
  importComfyWorkflow,
  reconcileComfyWorkflow,
  slugifyModelKey,
  type MissingEnumValue,
  type WorkflowAnalysis,
  type WorkflowBinding,
  type WorkflowEnumOption,
} from "./comfyuiWorkflowImport";
import { bustComfyObjectInfoCache, fetchComfyuiObjectInfoIndex } from "../comfyuiObjectInfo";
import { convertUiWorkflowToApi, looksLikeUiWorkflow } from "../comfyuiGraphConvert";
import { COMFYUI_VENDOR_KEY, isComfyuiVendor } from "./types";
import {
  candidateLineageMeta,
  newCandidateRevisionId,
  planStagedVendorIdentity,
  stagedVendorKey,
  type StagedVendorIdentity,
} from "./stagedVendorIdentity";

export type AnalyzeWorkflowResult =
  | { ok: true; analysis: WorkflowAnalysis; /** 转换后的 API 文本 + 原 UI 图（执行/可复现各用一份）。 */ convertedText?: string; sourceWorkflowText?: string }
  | { ok: false; error: string };
export type ImportWorkflowResult = {
  ok: true;
  modelKey: string;
  kind: string;
  taskKind: string;
  vendorKey: string;
  revisionId: string;
} | { ok: false; error: string };
export type ReconcileWorkflowResult =
  | { ok: true; serverReachable: boolean; unknownNodeTypes: string[]; missingEnumValues: MissingEnumValue[]; enumOptions: WorkflowEnumOption[] }
  | { ok: false; error: string };
export type ReconcileWorkflowBatchResult =
  | { ok: true; results: Array<{ id: string; result: ReconcileWorkflowResult }> }
  | { ok: false; error: string };

/** 校验 + 分析（供 UI 映射预览）。坏格式返回 { ok:false, error } 而非抛——IPC 好透传成人话提示。 */
export function analyzeComfyWorkflowText(text: unknown): AnalyzeWorkflowResult {
  try {
    const graph = parseComfyApiWorkflow(String(text ?? ""));
    return { ok: true, analysis: analyzeComfyWorkflow(graph) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 分析 + **界面格式自动转换**（异步版，T1）。用户贴什么格式都吃：
 *   API 格式 → 直接分析（与同步版同结果）
 *   界面格式 → 借用户自己 ComfyUI 的前端转成 API 格式再分析（转不动就说明要启动当前 ComfyUI）
 * 转换成功时回 convertedText，UI 用它替换掉用户贴的原文，后续导入/编辑链一律走 API 格式（单一形态）。
 */
export async function analyzeComfyWorkflowTextSmart(text: unknown, vendorKey?: unknown): Promise<AnalyzeWorkflowResult> {
  const raw = String(text ?? "");
  const direct = analyzeComfyWorkflowText(raw);
  if (direct.ok || !looksLikeUiWorkflow(raw)) return direct;

  const targetKey = comfyVendorKeyOf(vendorKey);
  const vendor = readCatalog().vendors.find((v) => v.key === targetKey);
  const converted = await convertUiWorkflowToApi(String(vendor?.baseUrlHint || ""), raw);
  if (!converted.ok) {
    // 转不动 → 保持解析层的恢复指引，并把转换失败原因附后，便于排查。
    return { ok: false, error: `${direct.ok ? "" : direct.error}（自动转换也没成：${converted.error}）` };
  }
  const convertedText = JSON.stringify(converted.api, null, 2);
  const after = analyzeComfyWorkflowText(convertedText);
  if (!after.ok) return after;
  return { ...after, convertedText, sourceWorkflowText: raw };
}

/**
 * 缺件对账（异步，analyze 之外单独一条 IPC）：workflow vs 本机 ComfyUI /object_info。
 * serverReachable=false = ComfyUI 没开/连不上 → 跳过核对（导入不被阻断，面板给一行「未检查」提示）。
 */
export async function reconcileComfyWorkflowText(text: unknown, vendorKey?: unknown): Promise<ReconcileWorkflowResult> {
  try {
    const graph = parseComfyApiWorkflow(String(text ?? ""));
    // 多实例：对账必须打**这一台**的 /object_info（各机器装的东西不同）。缺省=第一台。
    const targetKey = String(vendorKey || "").trim() || COMFYUI_VENDOR_KEY;
    const vendor = readCatalog().vendors.find((v) => v.key === targetKey);
    const baseUrl = String(vendor?.baseUrlHint || "");
    // 对账是用户动作（分析/重新检测）：爆缓存拿新鲜事实——刚装好的模型必须立刻被认出来。
    bustComfyObjectInfoCache(baseUrl);
    const index = await fetchComfyuiObjectInfoIndex(baseUrl);
    if (!index) return { ok: true, serverReachable: false, unknownNodeTypes: [], missingEnumValues: [], enumOptions: [] };
    // enumOptions 顺手带出：导入/保存时烤进参数控件（checkpoint/LoRA 在画布变真实文件下拉）。
    return { ok: true, serverReachable: true, ...reconcileComfyWorkflow(graph, index), enumOptions: collectGraphEnumOptions(graph, index) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 设置页批量对账：一台实例只刷新并读取一次 /object_info，再用同一份能力事实核对全部 workflow。
 * 单条坏 JSON 只让该条失败，不拖垮整批；id 由 renderer 提供并原样回传用于关联 modelKey。
 */
export async function reconcileComfyWorkflowTexts(
  rawItems: unknown,
  vendorKey?: unknown,
): Promise<ReconcileWorkflowBatchResult> {
  if (!Array.isArray(rawItems)) return { ok: false, error: "工作流批量对账参数必须是数组" };
  if (rawItems.length > 200) return { ok: false, error: "一次最多核对 200 条工作流" };

  type ParsedBatchItem =
    | { id: string; graph: ReturnType<typeof parseComfyApiWorkflow> }
    | { id: string; error: ReconcileWorkflowResult };
  const parsed: ParsedBatchItem[] = rawItems.map((raw, index): ParsedBatchItem => {
    const item = raw && typeof raw === "object" ? raw as { id?: unknown; text?: unknown } : {};
    const id = String(item.id ?? index);
    try {
      return { id, graph: parseComfyApiWorkflow(String(item.text ?? "")) };
    } catch (e) {
      return {
        id,
        error: { ok: false, error: e instanceof Error ? e.message : String(e) } as ReconcileWorkflowResult,
      };
    }
  });

  const valid = parsed.filter((item): item is Extract<ParsedBatchItem, { graph: unknown }> => "graph" in item);
  if (valid.length === 0) {
    return { ok: true, results: parsed.map((item) => ({ id: item.id, result: "error" in item ? item.error : { ok: false, error: "工作流解析失败" } })) };
  }

  const targetKey = String(vendorKey || "").trim() || COMFYUI_VENDOR_KEY;
  const vendor = readCatalog().vendors.find((v) => v.key === targetKey);
  const baseUrl = String(vendor?.baseUrlHint || "");
  bustComfyObjectInfoCache(baseUrl);
  const index = await fetchComfyuiObjectInfoIndex(baseUrl);

  return {
    ok: true,
    results: parsed.map((item) => {
      if ("error" in item) return { id: item.id, result: item.error };
      if (!index) {
        return { id: item.id, result: { ok: true, serverReachable: false, unknownNodeTypes: [], missingEnumValues: [], enumOptions: [] } };
      }
      return {
        id: item.id,
        result: {
          ok: true,
          serverReachable: true,
          ...reconcileComfyWorkflow(item.graph, index),
          enumOptions: collectGraphEnumOptions(item.graph, index),
        },
      };
    }),
  };
}

/**
 * 多实例：payload 里的 vendorKey 消毒——**只接受真的 ComfyUI 实例 key**（isComfyuiVendor 判据），
 * 别让渲染层随手传个别家 vendorKey 就把 comfy 工作流落到人家名下。缺省/非法 → 第一台。
 */
function comfyVendorKeyOf(raw: unknown): string {
  const key = String(raw || "").trim();
  return key && isComfyuiVendor({ key }) ? key : COMFYUI_VENDOR_KEY;
}

/** IPC payload 里的 enumOptions 消毒（渲染层传来的 unknown → 严格形状，坏项丢弃）。 */
function sanitizeEnumOptions(raw: unknown): WorkflowEnumOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkflowEnumOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { classType, inputKey, options } = item as { classType?: unknown; inputKey?: unknown; options?: unknown };
    if (typeof classType !== "string" || typeof inputKey !== "string" || !Array.isArray(options)) continue;
    const clean = options.filter((o): o is string => typeof o === "string");
    if (clean.length > 0) out.push({ classType, inputKey, options: clean });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeUiWorkflowText(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 20_000_000) return undefined;
  return looksLikeUiWorkflow(raw) ? raw : undefined;
}

/** 按用户确认的绑定落库（用户自有 model+mapping，走普通 upsert → 不被 seedBuiltins reconcile 覆盖）。
 *  uniq 供 modelKey 去重（默认时间戳；测试传固定值求确定）。 */
export function importComfyWorkflowToCatalog(payload: unknown, uniq: string = Date.now().toString(36)): ImportWorkflowResult {
  try {
    const p = (payload && typeof payload === "object" ? payload : {}) as { text?: string; binding?: WorkflowBinding; labelZh?: string; enumOptions?: unknown; vendorKey?: unknown; uiWorkflowText?: unknown };
    const labelZh = String(p.labelZh || "").trim() || "本地 ComfyUI 工作流";
    const modelKey = slugifyModelKey(labelZh, uniq);
    return stageComfyWorkflow({
      text: String(p.text ?? ""), binding: p.binding ?? { numeric: [] }, labelZh, modelKey,
      enumOptions: sanitizeEnumOptions(p.enumOptions), sourceVendorKey: comfyVendorKeyOf(p.vendorKey),
      uiWorkflowText: sanitizeUiWorkflowText(p.uiWorkflowText),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 重新保存已导入 workflow：保留 modelKey，替换 model + mapping，并清掉该 modelKey 的旧 taskKind mapping。 */
export function updateComfyWorkflowInCatalog(payload: unknown): ImportWorkflowResult {
  try {
    const p = (payload && typeof payload === "object" ? payload : {}) as {
      modelKey?: string;
      text?: string;
      binding?: WorkflowBinding;
      labelZh?: string;
      enumOptions?: unknown;
      vendorKey?: unknown;
      uiWorkflowText?: unknown;
    };
    const modelKey = String(p.modelKey || "").trim();
    if (!modelKey) throw new Error("缺少要编辑的工作流 modelKey。");
    const labelZh = String(p.labelZh || "").trim() || "本地 ComfyUI 工作流";
    return stageComfyWorkflow({
      text: String(p.text ?? ""), binding: p.binding ?? { numeric: [] }, labelZh, modelKey,
      enumOptions: sanitizeEnumOptions(p.enumOptions), sourceVendorKey: comfyVendorKeyOf(p.vendorKey),
      uiWorkflowText: sanitizeUiWorkflowText(p.uiWorkflowText),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type StageComfyInput = {
  text: string;
  binding: WorkflowBinding;
  labelZh: string;
  modelKey: string;
  enumOptions?: WorkflowEnumOption[];
  sourceVendorKey: string;
  uiWorkflowText?: string;
};

function isolatedIdentity(input: StageComfyInput, revisionId: string): StagedVendorIdentity {
  const state = readCatalog();
  const planned = planStagedVendorIdentity({
    state,
    sourceVendorKey: input.sourceVendorKey,
    connection: { kind: "comfyui-workflow", modelKey: input.modelKey },
    revisionId,
    selectedModelKeys: [input.modelKey],
    reuseUnpublishedCandidate: false,
  });
  if (planned.isolated) return planned;
  return {
    ...planned,
    isolated: true,
    vendorKey: stagedVendorKey(planned.rootVendorKey, { kind: "comfyui-workflow", modelKey: input.modelKey }, revisionId),
  };
}

function stageComfyWorkflow(input: StageComfyInput): ImportWorkflowResult {
  // Parse/build before opening the catalog transaction so malformed workflows leave no candidate shell.
  parseComfyApiWorkflow(input.text);
  const revisionId = newCandidateRevisionId("comfy");
  const identity = isolatedIdentity(input, revisionId);
  const before = readCatalog();
  const sourceVendor = before.vendors.find((vendor) => vendor.key === identity.sourceVendorKey)
    || before.vendors.find((vendor) => vendor.key === input.sourceVendorKey);
  return mutateCatalog((tx) => {
    const vendor = tx.upsertVendor({
      ...(sourceVendor || {}),
      key: identity.vendorKey,
      name: sourceVendor?.name || "本地 ComfyUI",
      enabled: false,
      baseUrlHint: sourceVendor?.baseUrlHint || "http://127.0.0.1:8188",
      authType: "none",
      meta: { ...(sourceVendor?.meta && typeof sourceVendor.meta === "object" ? sourceVendor.meta : {}), ...candidateLineageMeta(identity) },
    });
    const r = importComfyWorkflow(
      {
        text: input.text, binding: input.binding, labelZh: input.labelZh, modelKey: input.modelKey,
        enumOptions: input.enumOptions, vendorKey: vendor.key, uiWorkflowText: input.uiWorkflowText,
      },
      (rawModel) => {
        const meta = rawModel.meta && typeof rawModel.meta === "object" ? rawModel.meta as Record<string, unknown> : {};
        tx.upsertModel({
          ...rawModel,
          enabled: false,
          meta: { ...meta, adapter: { state: "testing", runId: revisionId, modes: [], updatedAt: new Date().toISOString() } },
        });
      },
      (rawMapping) => tx.upsertMapping({ ...rawMapping, enabled: false }),
    );
    return { ok: true, ...r, vendorKey: vendor.key, revisionId };
  });
}
