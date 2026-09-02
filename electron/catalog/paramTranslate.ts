// 参数翻译层（铁律：模型身份决定参数，与接入渠道无关）。
//
// 背景见 docs/plan/2026-06-24-model-param-consistency-invariant.md。档案声明**中性 canonical
// 参数**（面向用户，全站一致，如图像「比例 aspect_ratio + 清晰度 resolution(1K/2K/4K)」）；
// 各供应商线缆字段名不同（apimart 叫 size、OpenAI 兼容站要像素 3840x2160）是纯实现细节。
// 这层把 canonical 翻译成某 codec 的 wire 字段——**改名 / 值转换 / 显式丢弃**三种。
//
// 硬约束：codec 的 HttpOperation 会被 seed 进 model-catalog.json（持久化），故 ParamMap **必须
// 可序列化**——规则是纯数据，值转换用字符串 id 引用下方 PARAM_TRANSFORMS code 注册表，绝不放函数。
//
// 不变量（paramConsistency.test.ts）靠 consumedCanonicalKeys + bodyReferencedParamKeys 机器校验
// 「档案每个 canonical 参数都被 codec 覆盖或显式 drop」，把从前全人肉的对齐变成 CI 看门狗。
import { isJsonRecord, type JsonRecord } from "../jsonUtils";

/** 一条翻译规则：产出一个 wire 字段。三种形态（可序列化）。 */
export type ParamMapRule =
  | { wire: string; from: string } // 改名：wire <- canonical[from]
  | { wire: string; fromMany: string[]; transform: string } // 值转换：wire <- T(canonical[fromMany...])
  | { wire: string; const: string }; // 常量：wire <- 固定值

/** 一个 codec op 的参数翻译表。`drops` = 该站显式不支持的 canonical 键（静默丢弃，不报错、不算错位）。 */
export type ParamMap = {
  drops?: string[];
  rules: ParamMapRule[];
};

// ── 命名值转换注册表（code 侧；op 用字符串 id 引用，保持 op 可序列化）──────────────

function roundTo16(n: number): number {
  return Math.max(16, Math.round(n / 16) * 16);
}

// OpenAI gpt-image-2 像素约束（web + 官方核实 2026-06）：长边 ≤ 3840、两边为 16 倍数、
// 长短比 ≤ 3:1、像素总数 655360 ~ 8294400。1:1 不能真 4K（会超像素预算 → 自动降）。
const OPENAI_MAX_PIXELS = 8294400;
const TIER_LONG_EDGE: Record<string, number> = { "1k": 1024, "2k": 2048, "4k": 3840 };

/**
 * 中性 (比例, 清晰度档位) → OpenAI 兼容像素 size。比例 auto/空 → undefined（省略 size，由站默认）。
 * 按档位取长边，短边按比例缩放并夹到 16 倍数，超像素预算则整体等比降直至合规（1:1·4K 会被降到 ~2880）。
 */
export function ratioResToOpenAiSize(values: Array<string | undefined>): string | undefined {
  const ratio = (values[0] || "").trim().toLowerCase();
  const res = (values[1] || "").trim().toLowerCase();
  if (!ratio || ratio === "auto") return undefined;
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!a || !b) return undefined;
  let longEdge = TIER_LONG_EDGE[res] ?? TIER_LONG_EDGE["1k"];
  const ratioMinOverMax = Math.min(a, b) / Math.max(a, b);
  let width = a >= b ? longEdge : Math.round(longEdge * ratioMinOverMax);
  let height = a >= b ? Math.round(longEdge * ratioMinOverMax) : longEdge;
  width = roundTo16(width);
  height = roundTo16(height);
  // 像素预算夹取：超了就等比缩长边再算，最多几轮收敛。
  let guard = 0;
  while (width * height > OPENAI_MAX_PIXELS && guard < 12) {
    longEdge = roundTo16(longEdge * 0.92);
    width = a >= b ? longEdge : roundTo16(longEdge * ratioMinOverMax);
    height = a >= b ? roundTo16(longEdge * ratioMinOverMax) : longEdge;
    guard += 1;
  }
  return `${width}x${height}`;
}

/**
 * 中性比例 → fal `openai/gpt-image-2` 的 `image_size` **枚举**。
 * 官方文档（2026-09-01 照 https://fal.ai/models/openai/gpt-image-2/api 对账，即目录实际发的那个端点；
 * `fal-ai/gpt-image-2` 同 schema）：`image_size` 类型是 **`ImageSize | Enum`**——原文
 *   「one of the presets, `{width, height}`, or 'auto' … Default value: landscape_4_3.
 *    Possible enum values: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto.
 *    Note: For custom image sizes, you can pass the width and height as an object.」
 *   （自定义档还须 dims 为 16 的倍数、max edge 3840、aspect ≤ 3:1、总像素 655,360–8,294,400。）
 * 即：枚举名或 `{width,height}` 对象**皆可**，但**不认** `"1024x1024"` 这种 WxH 串——2026-09-01 真发实测 422
 * `model_attributes_type`（BUG-1）。我们走「枚举名」这条：清晰度由 `quality` 参数单独承载，故只按**朝向**取
 * 枚举、不编码像素档位。fal 枚举比 16 档 canonical 粗 → 按长短边归到最近的横/竖/方：
 *   a==b → square；宽幅按长短比 ≥ 1.5 归 16:9 否则 4:3；竖幅同理。
 *   auto/空 → undefined（省略字段，由 fal 落到文档默认 landscape_4_3；若要「模型自选」得显式发 "auto"，此处不发）。
 * ⚠️ **fal 专用**：OpenAI/new-api 的 `size` 字段要的是 WxH 串（用 ratioResToOpenAiSize），别混用。
 */
export function ratioResToFalImageSize(values: Array<string | undefined>): string | undefined {
  const ratio = (values[0] || "").trim().toLowerCase();
  if (!ratio || ratio === "auto") return undefined;
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!a || !b) return undefined;
  if (a === b) return "square";
  const longOverShort = Math.max(a, b) / Math.min(a, b);
  const wide = a > b;
  const tall = longOverShort >= 1.5; // ≥3:2 走 16:9 档，否则 4:3 档
  if (wide) return tall ? "landscape_16_9" : "landscape_4_3";
  return tall ? "portrait_16_9" : "portrait_4_3";
}

/** 小写归一（某站字段值要小写，如 apimart 历史用 1k/2k/4k；中性 canonical 用 1K/2K/4K）。 */
export function toLowerCase(values: Array<string | undefined>): string | undefined {
  const v = (values[0] || "").trim();
  return v ? v.toLowerCase() : undefined;
}

// ── AGNES 视频派生（D1：用户选 比例+清晰度+时长，wire 要 width/height/num_frames/frame_rate）──
// AGNES 清晰度档位 480p/720p/1080p = **短边**像素（与标准 1080p=1920×1080 一致：1080 是 16:9 的短边）。
// 长边 = 短边 × 长短比，对齐 8 倍数（AGNES 视频维度按 8 对齐；num_frames 另走 8n+1）。
const AGNES_TIER_SHORT_EDGE: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080 };

function roundTo8(n: number): number {
  return Math.max(8, Math.round(n / 8) * 8);
}

/** 解析 "a:b" 比例 → [a,b]；非法 → null。 */
function parseAspect(raw: string | undefined): [number, number] | null {
  const m = (raw || "").trim().toLowerCase().match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a && b ? [a, b] : null;
}

/** (比例, 清晰度档位) → [width, height] 像素（短边=档位，长边按比例，8 倍数对齐）。 */
function agnesVideoDims(aspect: string | undefined, res: string | undefined): [number, number] | null {
  const ab = parseAspect(aspect);
  if (!ab) return null;
  const [a, b] = ab;
  const shortEdge = AGNES_TIER_SHORT_EDGE[(res || "").trim().toLowerCase()] ?? AGNES_TIER_SHORT_EDGE["720p"];
  const longEdge = roundTo8(shortEdge * (Math.max(a, b) / Math.min(a, b)));
  const short = roundTo8(shortEdge);
  // a>=b → 横向/方形：width 是长边；a<b → 纵向：height 是长边。
  return a >= b ? [longEdge, short] : [short, longEdge];
}

// ⚠️ 返回**数字**(非字符串)：AGNES 是 Go 后端,width/height/num_frames 是严格 int——发字符串
// "1280" 会 400(cannot unmarshal string into int,2026-06-30 live 实测)。整 token 模板
// `"{{request.params.num_frames}}"` 保留原值类型 → 存数字即发整数。
export function agnesVideoWidth(values: Array<string | undefined>): number | undefined {
  const dims = agnesVideoDims(values[0], values[1]);
  return dims ? dims[0] : undefined;
}

export function agnesVideoHeight(values: Array<string | undefined>): number | undefined {
  const dims = agnesVideoDims(values[0], values[1]);
  return dims ? dims[1] : undefined;
}

/** 时长(秒) + 帧率 → 最近的 8n+1。越界拒绝，不能把18秒悄悄改成7秒。 */
export function agnesVideoNumFrames(values: Array<string | undefined>): number | undefined {
  const seconds = Number((values[0] || "").trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const fps = values[1] === undefined ? 24 : Number(values[1]);
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) return undefined;
  const target = seconds * fps;
  if (target < 1 || target > 441) {
    throw new Error("Agnes Video V2.0: duration × frame_rate must be between 1 and 441; reduce duration or frame_rate.");
  }
  const n = Math.max(0, Math.round((target - 1) / 8));
  return 8 * n + 1;
}

/** Case-sensitive resolution enums such as 720P and 4K. Missing aliases do not replace UI values. */
export function toUpperCase(values: Array<string | undefined>): string | undefined {
  const value = values[0]?.trim();
  return value ? value.toUpperCase() : undefined;
}

/** Strict providers that declare a numeric-looking enum as a JSON string (KIE Gemini duration). */
export function toString(values: Array<string | undefined>): string | undefined {
  const value = values[0];
  return value === undefined ? undefined : String(value);
}

/** Canonical sound type is a readable one-shot/loop enum; KIE's wire field is boolean. */
export function soundTypeToLoop(values: Array<string | undefined>): boolean | undefined {
  const value = values[0]?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "loop") return true;
  if (value === "one-shot") return false;
  return undefined;
}

/** Canonical duration is shown in seconds; Eleven Music accepts integer milliseconds. */
export function secondsToMilliseconds(values: Array<string | undefined>): number | undefined {
  const seconds = Number(values[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.round(seconds * 1000);
}

/** 命名转换注册表。新增一种转换在此登记，op 用其 id 引用。值转换可返回 string 或 number
 *  （number 用于严格类型的 wire 字段,如 AGNES Go 后端的 int width/height/num_frames）。 */
export const PARAM_TRANSFORMS: Record<string, (values: Array<string | undefined>) => string | number | boolean | undefined> = {
  ratioResToOpenAiSize,
  ratioResToFalImageSize,
  toLowerCase,
  toUpperCase,
  toString,
  agnesVideoWidth,
  agnesVideoHeight,
  agnesVideoNumFrames,
  soundTypeToLoop,
  secondsToMilliseconds,
};

// ── 应用翻译：渲染 body 前把 canonical 参数翻译成 wire 字段注入 params ───────────────

function asStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * 把 paramMap 套到 canonical params 上，返回**注入 wire 键后的新 params**（原 canonical 键保留——
 * body 只读它引用的键，无害）。无 paramMap → 原样返回。transform id 不在注册表 → 跳过该规则（不崩）。
 */
export function applyParamMap(paramMap: ParamMap | undefined, params: JsonRecord): JsonRecord {
  if (!paramMap || !Array.isArray(paramMap.rules) || paramMap.rules.length === 0) return params;
  const out: JsonRecord = { ...params };
  for (const rule of paramMap.rules) {
    if ("const" in rule) {
      out[rule.wire] = rule.const;
      continue;
    }
    if ("from" in rule) {
      const v = params[rule.from];
      if (v !== undefined && v !== null && v !== "") out[rule.wire] = v;
      continue;
    }
    // fromMany + transform
    const fn = PARAM_TRANSFORMS[rule.transform];
    if (!fn) continue;
    const inputs = rule.fromMany.map((k) => asStringOrUndefined(params[k]));
    const result = fn(inputs);
    if (result !== undefined && result !== null && result !== "") out[rule.wire] = result;
  }
  return out;
}

// ── 不变量支撑：抽取「codec 消费了哪些 canonical 键」与「body 直接引用了哪些 params 键」──────

/** paramMap 通过翻译消费掉的 canonical 键（from / fromMany 并集）。 */
export function consumedCanonicalKeys(paramMap: ParamMap | undefined): string[] {
  if (!paramMap || !Array.isArray(paramMap.rules)) return [];
  const keys = new Set<string>();
  for (const rule of paramMap.rules) {
    if ("from" in rule) keys.add(rule.from);
    else if ("fromMany" in rule) rule.fromMany.forEach((k) => keys.add(k));
  }
  return [...keys];
}

const PARAM_TOKEN = /\{\{\s*request\.params\.([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * 这条 create op **整体**引用了哪些 canonical 参数键——HTTP body 与进程型 transport 的 CLI args 一起算。
 *
 * 为什么不能只扫 body：即梦（dreamina）这类走 `create.process.args` 的渠道根本没有 body，参数是
 * `--model_version={{request.params.model}}` 这样经 argv 发出去的。只扫 body 会把它们误判成「这个键
 * 发不出去」——实测就险些据此把即梦活着的变体选择器藏掉（它 6 个变体全靠 params.model 生效）。
 *
 * 单一真相源：参数一致性不变量（paramConsistency.test）与变体轴收窄都读它，不各写一份扫描。
 */
export function wireReferencedParamKeys(create: {
  body?: unknown;
  process?: { args?: string[] };
} | null | undefined): string[] {
  if (!create) return [];
  return [...new Set([
    ...bodyReferencedParamKeys(create.body),
    ...bodyReferencedParamKeys(create.process?.args),
  ])];
}

/** 扫一个 body 模板（任意嵌套 JSON）里所有 `{{request.params.X}}` 令牌引用的键。 */
export function bodyReferencedParamKeys(body: unknown): string[] {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(PARAM_TOKEN)) keys.add(match[1]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isJsonRecord(node)) {
      Object.values(node).forEach(walk);
    }
  };
  walk(body);
  return [...keys];
}
