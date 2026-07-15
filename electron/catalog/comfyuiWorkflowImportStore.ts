// 本地 ComfyUI「导入工作流」的 store 集成层（S3 电子侧薄壳）。
// 纯解析/建图/建 model+mapping 在 comfyuiWorkflowImport（可测、零副作用）；这里只接 store 写 + 生成唯一
// modelKey + 把异常包成 { ok:false, error } 供 IPC 透传。独立成文件是为了不把 catalogStore 顶破 800 行门。
import { upsertModelCatalogModel, upsertModelCatalogMapping } from "./catalogStore";
import {
  parseComfyApiWorkflow,
  analyzeComfyWorkflow,
  importComfyWorkflow,
  slugifyModelKey,
  type WorkflowAnalysis,
  type WorkflowBinding,
} from "./comfyuiWorkflowImport";

export type AnalyzeWorkflowResult = { ok: true; analysis: WorkflowAnalysis } | { ok: false; error: string };
export type ImportWorkflowResult = { ok: true; modelKey: string; kind: string; taskKind: string } | { ok: false; error: string };

/** 校验 + 分析（供 UI 映射预览）。坏格式返回 { ok:false, error } 而非抛——IPC 好透传成人话提示。 */
export function analyzeComfyWorkflowText(text: unknown): AnalyzeWorkflowResult {
  try {
    const graph = parseComfyApiWorkflow(String(text ?? ""));
    return { ok: true, analysis: analyzeComfyWorkflow(graph) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 按用户确认的绑定落库（用户自有 model+mapping，走普通 upsert → 不被 seedBuiltins reconcile 覆盖）。
 *  uniq 供 modelKey 去重（默认时间戳；测试传固定值求确定）。 */
export function importComfyWorkflowToCatalog(payload: unknown, uniq: string = Date.now().toString(36)): ImportWorkflowResult {
  try {
    const p = (payload && typeof payload === "object" ? payload : {}) as { text?: string; binding?: WorkflowBinding; labelZh?: string };
    const labelZh = String(p.labelZh || "").trim() || "本地 ComfyUI 工作流";
    const modelKey = slugifyModelKey(labelZh, uniq);
    const r = importComfyWorkflow(
      { text: String(p.text ?? ""), binding: p.binding ?? { numeric: [] }, labelZh, modelKey },
      upsertModelCatalogModel,
      upsertModelCatalogMapping,
    );
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
