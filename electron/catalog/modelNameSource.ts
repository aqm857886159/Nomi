// 「这家这一行发出去的型号名，是不是由档案提供」——按这家的映射算，唯一的计算处。
//
// 判据只有一个，与发送时决定 model 串的 owner（electron/shared/modelArchetypes/wireModelIdentity.resolveWireModel）
// 是**同一个谓词** `operationSelectsArchetypeWireModel`：这一行发送时会选中的 create op 声明了
// `wireModel: "archetype-selection"` = 这家的 `{{request.params.model}}` 收档案所选的模式 / 变体型号名
// （APIMart 的变体模型、KIE 拆 id 的图片模型、Dreamina……；声明只写在内置目录契约的 op 定义处，普查测试锁住）。
// 没有声明 = 型号名就是这一行连接自己的名字（别名优先）：写死型号的映射（Runway 的 `wan3`……）、
// 读 `{{model.modelKey}}` 的映射、用户自建中转（含旧数据里读 `request.params.model` 的参数化映射、AI 编译 / 手改的映射）都在这一档。
//
// 历史（别改回去）：2026-10-23 的判据是「模板文本里读 `request.params.model` 就算接受」。2026-09-03 起每个自建中转 op
// 都读它，于是每个自建中转都被判成接受档案型号名——变体栏、Agent 能力清单照档案摆出别家的名字，发送时 owner 却只发
// 连接名，同一个问题两个答案（2026-10-24 实测）。用户 2026-10-24 拍板：判据合一到 op 声明。
//
// 映射怎么选与发送时完全一样（selectTaskMapping：同一任务种类下精确绑定这一行的映射优先，没有才用这家的通用模板），
// 所以这里说「接受」的行，发送时真会把档案型号名发出去；说「不接受」的行，档案型号名一个字都进不了请求。
// 不写任何供应商名、型号名。结果随目录读出给渲染层（listModelCatalogModels），
// 并装成本进程的查询口（catalogStore），两侧的档案解析（resolveModelArchetype / buildVideoModelCandidates）只认这个结果。
import type { ModelNameSource } from "../shared/modelArchetypes/modelNameSource";
import { operationSelectsArchetypeWireModel } from "../shared/modelArchetypes/wireModelIdentity";
import { selectTaskMapping, type Mapping } from "./types";

export function deriveModelNameSource(model: { vendorKey: string; modelKey: string }, mappings: readonly Mapping[]): ModelNameSource {
  const vendorMappings = mappings.filter((mapping) => mapping.enabled && mapping.vendorKey === model.vendorKey);
  const taskKinds = [...new Set(vendorMappings.map((mapping) => mapping.taskKind))];
  for (const taskKind of taskKinds) {
    // 与发送同一个选法；按方式区分的映射逐个看（selectTaskMapping 只回一条，这里把这一桶里选得中的全看一遍）。
    const modeIds = [...new Set(vendorMappings.filter((mapping) => mapping.taskKind === taskKind).map((mapping) => (mapping.modeId ?? "").trim()))];
    for (const modeId of modeIds) {
      const selected = selectTaskMapping(vendorMappings as Mapping[], model.vendorKey, taskKind, model.modelKey, modeId || undefined);
      if (selected && operationSelectsArchetypeWireModel(selected.create)) return "archetype";
    }
  }
  return "row";
}

/** 表的键：一行的（供应商, 目录 key）。 */
export function modelNameSourceKey(vendorKey: string, modelKey: string): string {
  return JSON.stringify([vendorKey, modelKey]);
}

type CatalogShape = { models: readonly { vendorKey: string; modelKey: string; modelAlias?: string | null }[]; mappings: readonly Mapping[] };
const tableByState = new WeakMap<object, ReadonlyMap<string, ModelNameSource>>();

/** 整份目录的「（供应商, 目录 key）→ 来源」表。同一份目录状态对象只算一次（档案解析一次会问很多次）。 */
export function modelNameSourceTable(state: CatalogShape): ReadonlyMap<string, ModelNameSource> {
  const cached = tableByState.get(state);
  if (cached) return cached;
  const table = new Map<string, ModelNameSource>();
  for (const model of state.models) {
    const source = deriveModelNameSource(model, state.mappings);
    table.set(modelNameSourceKey(model.vendorKey, model.modelKey), source);
    const alias = typeof model.modelAlias === "string" ? model.modelAlias.trim() : "";
    if (alias && !table.has(modelNameSourceKey(model.vendorKey, alias))) table.set(modelNameSourceKey(model.vendorKey, alias), source);
  }
  tableByState.set(state, table);
  return table;
}
