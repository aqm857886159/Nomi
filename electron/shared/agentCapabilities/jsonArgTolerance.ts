/**
 * 模型把数组/对象**写成了 JSON 字符串**时，边界层自己解开。**一个** owner。
 *
 * 2026-09-06 打包版实测：用户让 Agent（DeepSeek）「从原稿重拆 10 镜」，
 * 「创建或修改镜头卡」连着失败 6 次。模型自己在正文里说对了病因——
 * 「我看到参数需要是数组而不是字符串」「我把 JSON 字符串化两次了」——但它改不回来，
 * 因为每次拿到的回执是 9 个联合分支的 8 行矛盾诉求，加上被原样回显的整包 10 镜 payload。
 *
 * 这不是某个模型的怪癖。把结构化参数二次序列化是**所有**走 JSON 工具调用的模型都会犯的错，
 * 尤其是把 `arguments` 当成一个字符串字段来填的那批（DeepSeek / Qwen / 多数中转端点）。
 * 所以修在最早的共享边界：**参数契约本身**声明「数组，或同一个数组的 JSON 文本」，
 * 两种写法都收，收下之后都变成同一个已校验的数组。
 *
 * 为什么不是「放宽校验」：解出来的东西照样过**同一个** item schema。字符串分支只是
 * 一层运输编码，不是第二种数据形状——解不出、或解出来不是数组，仍然 fail-closed。
 *
 * ⚠️ 与 `electron/harness/runtime/pi/tools.mts` 的发布选项耦合：那边必须带
 * `pipeStrategy: 'input'`，`z.string().transform().pipe(array)` 才会以 `{type:'string'}`
 * 发布出去。缺了它，发布出来的是 `allOf: [string, array]`（谁都满足不了），pi 的
 * TypeBox 会在 Nomi 的 zod 拿到参数**之前**就把字符串挡掉——这一层等于没写。
 * `tools.mts` 的测试对这条有阳性对照。
 */
import { z, type ZodTypeAny } from "zod";

/** JSON 文本 → 值。解不出就原样返回，让下游 schema 去报「期望数组」。 */
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

/**
 * 字符串那一支的描述**以这个记号开头**，这样下游发布口能认出它。
 *
 * MCP 传输层的校验器不实现 `anyOf`（只认 11 个关键字的子集），扁平化时会把
 * 「数组 ∪ 字符串」并成一个既没有 `type`、描述又被拼成两段的四不像——
 * `check:mcp-operation-constructible` 于是造出一个字符串样本并当场红。
 * 所以传输层按这个记号**只发结构化那一支**：外部宿主看到的仍是干净的数组契约，
 * 而执行边界的 Zod 照样收得下二次序列化的写法（容错不靠广播出去才成立）。
 */
export const JSON_TEXT_BRANCH_MARKER = "[json-text form]";

const STRING_FORM_HINT = `${JSON_TEXT_BRANCH_MARKER} the same value serialized as JSON text. Prefer the structured form above: send the array itself, not a string containing it.`;

/**
 * 「数组，或同一个数组的 JSON 文本」两支并成一个入参。
 *
 * 文本那支写成 `z.string().transform(...)` 而**不是** `.pipe(array)`，理由是发布层：
 * 仓库里有三个地方把 Zod 契约转成 JSON Schema（pi 的工具表、MCP 的 tools/list、
 * MCP 的传输超集），三处都已经带着 `effectStrategy: 'input'`——transform 因此
 * 自动发布成 `{type:'string'}`。换成 `.pipe()` 就要三处都记得再加一个
 * `pipeStrategy: 'input'`，漏一处，那一路发布出去的是 `allOf: [string, array]`
 * （谁都满足不了），字符串在到达这一层**之前**就被挡掉——容错静默失效。
 * 防线要建在忘不掉的那一层（R28）。
 *
 * 校验没有被放宽：解出来的值照样过同一个 `array`，issue 原样搬进本次校验，
 * 解不出或形状不对仍然 fail-closed。
 */
function jsonTextBranch<T extends ZodTypeAny>(inner: T) {
  return z
    .string()
    .describe(STRING_FORM_HINT)
    .transform((value, ctx): z.output<T> => {
      const parsed = inner.safeParse(parseJsonText(value));
      if (parsed.success) return parsed.data as z.output<T>;
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return z.NEVER as never;
    });
}

/**
 * 一个数组参数，另加「同一个数组的 JSON 文本」这条运输分支。
 *
 * **写法说明挂在字符串那一支上，不挂在数组那一支上。** 两个理由：
 * ① 结构化那支已经有 `type: array` + 完整 `items`，形状本来就说清了；
 * ② `check:mcp-payload` 是 shrink-only 棘轮，而 main 恰好卡在上限——往共享契约上加散文
 *    会把整份 tools/list 顶穿。字符串那支在传输层被整条丢掉（见 `JSON_TEXT_BRANCH_MARKER`），
 *    所以这句话对 MCP 的载荷是 0 字节，却照样出现在 pi 给模型的工具表里——
 *    正是那个把参数二次序列化的模型会读到的地方。
 * `description` 因此是可选的：只有本来就该向模型解释语义的字段才写。
 */
export function jsonTolerantArray<T extends ZodTypeAny>(
  array: T,
  description?: string,
): z.ZodType<z.output<T>, z.ZodTypeDef, z.input<T>> {
  // 声明出去的**输入**类型仍然只有结构化那一种。字符串分支是给模型的运输容错，
  // 不是给 TypeScript 调用方的第二种写法——把 `| string` 写进类型，仓库里每一个
  // 读 `nodes` 的地方都要先排除 string，那才是把一次容错扩散成一场类型污染。
  return z.union([description ? array.describe(description) : array, jsonTextBranch(array)]) as unknown as z.ZodType<
    z.output<T>,
    z.ZodTypeDef,
    z.input<T>
  >;
}

/** 同上，用于对象参数（`camera` / `crowd` 这类嵌套记录）。 */
export function jsonTolerantObject<T extends ZodTypeAny>(
  object: T,
  description?: string,
): z.ZodType<z.output<T>, z.ZodTypeDef, z.input<T>> {
  return z.union([description ? object.describe(description) : object, jsonTextBranch(object)]) as unknown as z.ZodType<
    z.output<T>,
    z.ZodTypeDef,
    z.input<T>
  >;
}

export { parseJsonText as parseJsonArgumentText };
