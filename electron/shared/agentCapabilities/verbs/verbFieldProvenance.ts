// **模型从哪拿到这个值。** 一条轴，不是一张对照表。
//
// ── 为什么这一条在「删掉对照表」之后必须留下来 ──
//
// 2026-09-18 的关系表（7 种 `kind` × 4 档来源，353 行）被投影整个取代了：字段名两边逐字相同之后，
// 「模型的 A 对应宿主的 B」这件事根本不存在，B/C/D 三类缺陷整族消失。但它身上有一条轴**不是**对应关系，
// 投影也接不住——
//
//   R1（宿主要的，动词得告诉过模型）只覆盖一半。反例：宿主要 `contentHash`，有人直接把 `contentHash`
//   加进动词声明，「告诉过模型」立刻成立，可模型还是拿不到它，因为**没有任何读动词返回它**。
//   工具照样 100% 不可用，而且没有任何东西会红。带参考图的分镜当年就是这么 100% 失败的。
//
// 投影把这条缝**放大**了一点点，而不是消掉：`.omit()` 之外的宿主字段会自动流进模型面，所以「宿主新长
// 出一个模型拿不到的必填字段」现在会顺着投影直接怼到模型脸上。`check:model-face-frozen` 拦得住「变了」，
// 拦不住「变得对不对」——那正是这条轴要回答的。
//
// 判据一句话：**宿主每个必填字段，都要说得出模型从哪拿到它；说不出就是设计错了，不是模型的问题。**
//
// ── 四档，没有缺省（留空 = 没想过）──
//
//   · `model-authored`           模型自己写得出（自由文本、它的选择、枚举里挑一个）
//   · `from-read:<verb>.<field>` 某个读动词的返回里有它——**这一档机器核**：那个动词的输出 schema 里
//                                真的得有这个字段，没有就红
//   · `host-resolved`            宿主自己解析，根本不问模型（参考素材的身份就是这一档）
//   · `derived:<field>`          从同一次调用里别的字段算出来
import { CAPABILITY_CONTRACTS } from "../registry";
import { toPublishedJsonSchema } from "../modelVisibleJsonSchema";
import type { VerbDeclaration } from "../verbDeclaration";

/**
 * 四档**写进类型**，不是写进正则：下面那张表全是静态字面量，让编译器认它比让运行期认它早一步
 * （R17：能让编译器拦的别留给门岗）。写错一档——`from_read:` 少个横杠、`model-author` 少个 ed——
 * 是 tsc 红，不用等模块加载。
 */
export type VerbFieldProvenance =
  | "model-authored"
  | "host-resolved"
  | `from-read:${string}.${string}`
  | `derived:${string}`;

/**
 * 一个动词的模型面字段 → 它的来源。点号路径（`shots.prompt`）指数组元素里的字段。
 *
 * **覆盖面就是这张表本身**：下面 `assertVerbFieldProvenance` 只核「声明了的动词，字段一个不少」，
 * 不强迫每个动词都进表。今天进表的是 2026-09-18 那张对照表覆盖过的那些（延迟组），
 * 其余动词进表是下一刀的事——写成清单而不是静默空白，见文件末尾的 `NOT_YET_DECLARED`。
 */
const RAW: Readonly<Record<string, Readonly<Record<string, readonly VerbFieldProvenance[]>>>> = Object.freeze({
  read_skill: {
    // 技能名不来自任何读动词：可选技能就列在系统提示词里，模型是照着那份名单挑的。
    name: ["model-authored"],
  },
  save_skill: { dirName: ["model-authored"], skillMarkdown: ["model-authored"] },
  delete_from_canvas: { nodeIds: ["from-read:look_at_canvas.id"], reason: ["model-authored"] },
  export_video: {
    expectedRevision: ["from-read:read_timeline.revision"],
    outputName: ["model-authored"], aspectRatio: ["model-authored"],
    resolution: ["model-authored"], quality: ["model-authored"],
  },
  edit_timeline: {
    baseRevision: ["from-read:read_timeline.revision"],
    summary: ["model-authored"],
    operations: ["model-authored", "from-read:read_timeline.clips"],
  },
  undo: {
    changeId: ["from-read:edit_timeline.changeId"],
    expectedRevision: ["from-read:read_timeline.revision"],
  },
  generate: {
    operationId: ["from-read:draft_shots.operationId"],
    shotIds: ["from-read:look_at_canvas.id"],
  },
  check_job: { jobId: ["from-read:generate.taskRef.jobId"], domain: ["from-read:generate.taskRef.domain"] },
  cancel_job: { jobId: ["from-read:generate.taskRef.jobId"], domain: ["from-read:generate.taskRef.domain"] },
  draft_shots: {
    "shots.storyboard": ["model-authored"],
    operationId: ["from-read:draft_shots.operationId"],
    taskKind: ["model-authored"],
    candidate: ["from-read:list_models.modelId"],
    "shots.prompt": ["model-authored"],
    "shots.taskKind": ["model-authored"],
    "shots.parameters": ["from-read:list_models.params"],
    "shots.modeId": ["from-read:list_models.modeId"],
    // 来源是 `draft_shots` **自己的返回**（`operation.shots[].shotId`），不是 `look_at_canvas` 的节点 id——
    // 宿主按 shot.shotId 找镜，把画布节点 id 递进去只会得到 "Generation shot not found"（#813 查明）。
    "shots.shotId": ["from-read:draft_shots.shotId"],
    "shots.role": ["model-authored"],
    "shots.title": ["model-authored"],
    "shots.durationSec": ["model-authored"],
    "shots.aspectRatio": ["model-authored"],
    "shots.modelId": ["from-read:list_models.modelId"],
    "shots.candidate": ["from-read:list_models.modelId"],
    // 两档都真：assetId 是模型从 look_at_media 拿的，内容哈希与版本由宿主补。
    // 写成 `from-read:<某个读动词>.contentHash` 会当场红——没有任何读动词返回那个字段。
    "shots.references": ["from-read:look_at_media.assetId", "host-resolved"],
  },
});

/**
 * 动词与能力都**没有声明**真实返回形状的清单。指向它们的来源声明今天核不动——
 * 把动词的 `outputSchema` 从真实宿主 schema 复用过来，这里就能删掉一条，
 * 核对随之生效。**不许**往这份清单里加「字段不在返回里」的那种情况——那一种没有出口，只能改设计。
 */
export const PROVENANCE_UNVERIFIABLE: Readonly<Record<string, string>> = Object.freeze({
  draft_shots: "mcpGenerationTools.ts 的 create/patch 返回 operation 与可选 changeset；GenerationOperation 及嵌套 ExecutionContractV1/授权仅有 TS 类型，无运行时结果 schema；等 owner 提供后复用，不能把 generationCandidateSchema 入参冒充结果",
  generate: "mcpGenerationTools.ts 的 present 返回 operation/shots/nextAction；同样缺 GenerationOperation 的运行时 schema，不能借 draft_shots 或 preview 的另一种返回；等结果 owner 提供后复用",
});

/**
 * 还没进表的动词。写成清单是因为**静默的空白与「想过了、没有来源问题」长得一模一样**——
 * 这份名单是下一刀的工作量，不是豁免。
 */
export const NOT_YET_DECLARED: readonly string[] = Object.freeze([
  "look_at_canvas", "read_script", "read_timeline", "look_at_media", "list_models",
  "write_script", "arrange_canvas", "make_artifact", "stage_shot", "start_model_setup",
]);

function outputFieldNames(verb: string, declarations: readonly VerbDeclaration[]): ReadonlySet<string> | undefined {
  const declaration = declarations.find((item) => item.name === verb);
  if (!declaration) throw new Error(`verbFieldProvenance: 来源里写了不存在的动词 "${verb}"`);
  const contract = CAPABILITY_CONTRACTS.find((item) => item.id === declaration.contractId);
  if (!contract) throw new Error(`verbFieldProvenance: ${verb} 落在一个没注册的能力上`);
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) { names.add(key); walk(child); }
    }
    for (const key of ["items", "additionalProperties"]) walk(record[key]);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branches = record[key];
      if (Array.isArray(branches)) for (const branch of branches) walk(branch);
    }
    for (const key of ["definitions", "$defs"]) {
      const bucket = record[key];
      if (bucket && typeof bucket === "object") for (const child of Object.values(bucket as Record<string, unknown>)) walk(child);
    }
  };
  try { walk(toPublishedJsonSchema(declaration.outputSchema ?? contract.outputSchema)); } catch { return undefined; }
  // 没有任何属性 = 这个动词的**返回形状根本没声明**（`z.unknown()`）。那不是「字段不在里面」，
  // 是「这里没有可核对的东西」——两种红要分开说，否则人会以为改个字段名就能糊弄过去。
  return names.size > 0 ? names : undefined;
}

/** 模型面上这个动词有哪些字段（点号路径展开数组元素一层，与声明同形）。 */
function modelFieldPaths(declaration: VerbDeclaration): readonly string[] {
  const published = toPublishedJsonSchema(declaration.schema) as { properties?: Record<string, { type?: string; items?: { properties?: Record<string, unknown> } }> };
  const out: string[] = [];
  for (const [key, child] of Object.entries(published.properties ?? {})) {
    if (child?.type === "array" && child.items?.properties) {
      for (const nested of Object.keys(child.items.properties)) out.push(`${key}.${nested}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

/**
 * 装配期三条：字段一个不少、档位合法、`from-read:` 指向的动词真的返回那个字段。
 * 这三条**不能**降级成门岗——它们是「这些声明自洽吗」，不自洽时模型拿到的就是一份它填不出来的合同。
 */
export function assertVerbFieldProvenance(declarations: readonly VerbDeclaration[]): void {
  for (const name of Object.keys(RAW)) {
    if (NOT_YET_DECLARED.includes(name)) throw new Error(`verbFieldProvenance: "${name}" 同时在两份名单里`);
    const declaration = declarations.find((item) => item.name === name);
    if (!declaration) throw new Error(`verbFieldProvenance: 声明了不存在的动词 "${name}"`);
    const declared = Object.keys(RAW[name]!);
    for (const field of modelFieldPaths(declaration)) {
      // 粒度由声明自己选：整只数组声明一条（`edit_timeline.operations`）够了，逐项声明（`draft_shots`
      // 的 `shots.*`）更严——2026-09-18 静默丢掉的正是逐项的 `candidate.providerId`，所以那个动词逐项写。
      if (declared.includes(field) || declared.includes(field.split(".")[0]!)) continue;
      throw new Error(`verbFieldProvenance: ${name} 的模型面字段 "${field}" 没说清模型从哪拿到它。`
        + "四档选一：model-authored / from-read:<动词>.<字段> / host-resolved / derived:<字段>。"
        + "留空 = 没想过，而「没想过」正是「宿主要一个模型根本拿不到的字段」能一路活到付费运行的那条缝。");
    }
    for (const [field, sources] of Object.entries(RAW[name]!)) {
      if (sources.length === 0) throw new Error(`verbFieldProvenance: ${name}.${field} 的来源是空的`);
      for (const source of sources) {
        if (!source.startsWith("from-read:")) continue;
        const [verb, output] = source.slice("from-read:".length).split(".");
        const names = outputFieldNames(verb!, declarations);
        if (names === undefined) {
          if (PROVENANCE_UNVERIFIABLE[verb!]) continue;
          throw new Error(`verbFieldProvenance: ${name}.${field} 说它来自 ${verb} 的返回，但 ${verb} 的返回形状没有声明，核不动。`
            + "请在动词上复用真实 outputSchema；PROVENANCE_UNVERIFIABLE 的身份基线只许减少，不许加条掩盖缺口。");
        }
        if (!names.has(output!)) {
          throw new Error(`verbFieldProvenance: ${name}.${field} 说它来自 ${verb} 的返回里的 "${output}"，但 ${verb} **不返回**这个字段。`
            + "模型因此根本拿不到这个值——这不是模型的问题，是设计错了：要么换一个真的会返回它的读动词，"
            + "要么改成 host-resolved（宿主自己解析，不问模型）。");
        }
      }
    }
  }
}

export const VERB_FIELD_PROVENANCE = RAW;
