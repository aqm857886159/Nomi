// 模型可见工具面 · 容忍是**一族**，不是一个字段（方案 §3.4）。
//
// **它在解决哪个真实摩擦**：2026-09-06 打包版实测，用户让 Agent「从原稿重拆 10 镜」，
// 「创建或修改镜头卡」连着失败 6 次。模型自己在正文里说对了病因——「我看到参数需要是
// 数组而不是字符串」「我把 JSON 字符串化两次了」——但它改不回来。真机 18 次失败
// **100%** 是这一条（#547 §3.2）。
//
// 这不是某个模型的毛病：把结构化参数二次序列化是**所有**走 JSON 工具调用的模型都会犯的
// 错，尤其是把 `arguments` 当成一个字符串字段来填的那批（DeepSeek / Qwen / 多数中转端点）。
// 上游 pi 自己也为它单开过 issue（#7835 / #9212：sonnet-5 经网关有 13% 的 `edits`
// 退化成 `[{}]`），并把 `prepareArguments` 定成官方答案。
//
// ── 分工：哪几道是 pi 的，哪几道是我们的（G-06 / G-08 实核）──
//
// pi 的容忍梯有四道，**全在校验器内部、顺序固定**（`pi-ai/dist/utils/validation.js:280-296`）：
//   ① `structuredClone` ② `normalizeOptionalNulls`（可选字段收到 `null` → **删掉该键**）
//   ③ `Value.Convert`（`"5"` → `5`） ④ 非 TypeBox schema 再走一次 `coerceWithJsonSchema`
// 所以「可选字段填了 null」和「数字写成字符串」**我们一行都不用写**——写了就是第二个
// 容忍器，两个互不认识的验证器正是 #547 §2.2③「8 行报错只有 1 行是真的」的成因。
//
// 剩下的三族 pi 不管，而它们恰恰是真机 100% 的那一族：
//   A. 整包参数被序列化成 JSON 字符串
//   B. 某个数组/对象字段被序列化成 JSON 字符串
//   C. 该给一元数组的地方给了单个对象
// 外加一族属于我们领域的：
//   D. 字段名近义写错（`content` 写成 `text`/`body`）
//
// **一处 owner，不是每个工具各写一遍**：`prepareArguments` 挂在每个工具上，但捏合逻辑
// 只有这一份。漏掉的那个工具不会报错——它只会在半年后用一次真实失败告诉你（R28）。
//
// ⚠️ 与 `electron/shared/agentCapabilities/jsonArgTolerance.ts`（过渡补丁 T1）的关系：
// 那一份把「同一个值的 JSON 文本」做成了**契约里的一条运输分支**（`z.union([array, string])`），
// 于是模型可见 schema 上多出一个 `anyOf`——而 Google 的 legacy `parameters` 路径压根不
// 支持 `anyOf`（`pi-ai/dist/api/google-shared.js:278-281`）。新通路不走那条路：契约保持
// 干净的 `z.array(...)`，容忍全部落在这里，校验之前。旧通路仍需要 T1，到阶段 4 一起删。

/** JSON 文本 → 值。解不出就原样返回，让 pi 的校验器去报「期望数组」。 */
function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const first = trimmed[0];
  if (first !== "[" && first !== "{") return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/** A · 整包参数被序列化成 JSON 字符串。 */
export function unwrapWholeArguments(args: unknown): Record<string, unknown> {
  const parsed = parseJsonText(args);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

export interface ModelToleranceShape {
  /** 声明成数组的字段名。B 族（JSON 文本）与 C 族（单对象→一元数组）都只对它们生效。 */
  readonly arrayFields?: readonly string[];
  /** 声明成嵌套对象的字段名。只做 B 族。 */
  readonly objectFields?: readonly string[];
  /**
   * D 族 · 字段名近义表：`{ 正名: [模型可能写成的别名…] }`。
   *
   * **只在正名缺席时才认别名**，且认下之后别名键被删掉——否则 `.strict()` 会把这次
   * 本来意思完全正确的调用毙掉，而模型收到的理由是「多了一个不认识的字段」，
   * 它多半会把正文再抄一遍到另一个错名字上。
   */
  readonly fieldAliases?: Readonly<Record<string, readonly string[]>>;
  /**
   * E 族 · 这个工具认得的全部字段名。给了就把不在表里的键安静丢掉——模型很爱给只收一两个参数的读工具
   * 塞一个兄弟工具的参数（`where: "end"`）或一个无关提示（`path: "draft.md"`），那不是错误，是它在复述
   * 别的工具的事；让一次正确意图死在 `additionalProperties: false` 上只会换来一次无谓往返。
   * 不给 = 不丢（写工具照旧 strict 报错，多出来的字段可能是写错名字的正文）。
   */
  readonly knownFields?: readonly string[];
}

/**
 * 造一个 `prepareArguments`。**捏合不放松任何语义**：解出来的值照样过同一个 schema，
 * 解不出、或解出来形状不对，仍然 fail-closed —— 由 pi 的校验器报错，
 * 而它报的错会带上路径和期望（探针 §4.2 臂 A 实测）。
 */
export function modelArgumentTolerance(shape: ModelToleranceShape): (args: unknown) => Record<string, unknown> {
  const arrayFields = new Set(shape.arrayFields ?? []);
  const objectFields = new Set(shape.objectFields ?? []);
  const aliases = Object.entries(shape.fieldAliases ?? {});
  const knownFields = shape.knownFields ? new Set(shape.knownFields) : undefined;

  return (args: unknown): Record<string, unknown> => {
    const record = { ...unwrapWholeArguments(args) };
    if (knownFields) for (const key of Object.keys(record)) if (!knownFields.has(key)) delete record[key];

    for (const [canonical, alternatives] of aliases) {
      if (record[canonical] !== undefined) continue;
      for (const alternative of alternatives) {
        if (record[alternative] === undefined) continue;
        record[canonical] = record[alternative];
        delete record[alternative];
        break;
      }
    }

    for (const field of arrayFields) {
      const value = parseJsonText(record[field]);
      if (value === undefined) continue;
      // C · 单个对象 → 一元数组。pi 为这一族单开过 issue #7835；上游自己的 `edit` 工具
      // 也在 `prepareEditArguments` 里做同一件事（`core/tools/edit.js:63-65`）。
      record[field] = value !== null && typeof value === "object" && !Array.isArray(value) ? [value] : value;
    }

    for (const field of objectFields) {
      const value = parseJsonText(record[field]);
      if (value !== undefined) record[field] = value;
    }

    return record;
  };
}

/**
 * 不收参数的工具的容忍：模型很爱给不收参数的工具塞一个 `{"scope":"full"}`（因为别的工具收）。
 * 那不是错误，是它在复述我们已经用工具名说过的事——把它安静地丢掉，别让一次正确意图
 * 死在 `additionalProperties: false` 上。
 */
export function noArgumentTolerance(): Record<string, never> {
  return {};
}

export { parseJsonText as parseModelArgumentJsonText };
