// 「画面比例」这件事的**单一真相**：什么值算比例、什么控件算比例控件、一个想要的比例落到哪个键上。
//
// 为什么住 shared：同一个判据有三个读者——画布参数面板（比例那组选项怎么摆、写回哪几个键）、
// 宿主准入层（Agent 说的 16:9 落到所选模式的哪个参数键，`capabilityCore/semanticAspectRatio.ts`），
// 以及将来分镜整片画幅落画布那一层。2026-10-05 之前它住在渲染层（`nodes/aspectRatio.ts` 与
// `parameterOptionPresentation.ts` 各一半），主进程读不到，于是宿主那一侧压根没有「比例」这个概念，
// 模型猜错键名就静默回落到档案默认（`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`）。
// 这里是搬家，不是第三份：两处旧定义同一提交删掉、改从这里读。

/**
 * 模型面 / 宿主面上「比例」的**语义键**——不是任何一家供应商的参数名。
 * `draft_shots` 的 `shots[].aspectRatio` 投影成宿主候选里的 `parameters.aspectRatio`，
 * 宿主在看得见所选模式参数表的那一处把它翻成真实键（`size` / `aspect_ratio` / `ratio` …）。
 * 名字与 `{w}:{h}` 格式照 Vercel AI SDK `generateImage({ aspectRatio })`。
 */
export const ASPECT_RATIO_SEMANTIC_KEY = "aspectRatio";

/**
 * Named bucket → W:H 标准字符串映射。
 * 覆盖 Seedream edit mode 的 image_size 枚举值（portrait_4_3 等）。
 */
const NAMED_RATIO_TO_WH: Readonly<Record<string, string>> = {
  square:         "1:1",
  square_hd:      "1:1",
  portrait_4_3:   "3:4",
  portrait_3_2:   "2:3",
  portrait_16_9:  "9:16",
  landscape_4_3:  "4:3",
  landscape_3_2:  "3:2",
  landscape_16_9: "16:9",
  landscape_21_9: "21:9",
};

// 「什么算 W:H」的单一真相。解析与规范化必须同进同退——两边各写一份正则，迟早一边认得的值另一边不认（曾如此）。
// 允许可选的说明后缀：ComfyUI 工作流的比例枚举常写成 "16:9 (宽屏)" / "4:3（标准）"。
const ASPECT_RATIO_LABEL_RE = /\s*[（(][^）)]*[）)]$/;
const ASPECT_RATIO_WH_RE = /^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)(?:\s*[（(][^）)]*[）)])?$/;

/** 「自动」语义的选项（auto / adaptive / 自动 …）。比例组里它是一档，不是比例本身。 */
const AUTO_OPTION_PATTERN = /^(auto|automatic|adaptive|自动|智能)$/i;

/**
 * 把 "W:H" 比例字符串（或 named bucket）解析成数值宽高比（width / height）。
 * 不认识的值（"adaptive" / "auto" / "2K" / 空）→ null。支持中文冒号「：」与说明后缀。
 */
export function parseAspectRatioValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(ASPECT_RATIO_WH_RE);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0) || !(height > 0)) return null;
    return width / height;
  }
  const mapped = NAMED_RATIO_TO_WH[trimmed];
  return mapped ? parseAspectRatioValue(mapped) : null;
}

/**
 * 把任意比例值规范化为 "W:H" 字符串（只剥说明后缀、映射具名桶，冒号字面量不改）。
 * 不认识（"auto" / "2K" / 像素串 "448x1024"）→ null。
 */
export function normalizeAspectRatioToWH(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (ASPECT_RATIO_WH_RE.test(trimmed)) return trimmed.replace(ASPECT_RATIO_LABEL_RE, "").trim();
  return NAMED_RATIO_TO_WH[trimmed] ?? null;
}

/**
 * 两个比例值是不是同一档的比对键：「16:9」「16：9」「16 : 9」「16:9 (宽屏)」「landscape_16_9」都是 `16:9`。
 * 不约分——`1920:1080` 不是 `16:9` 这个**串**（像素档按比例对上走下面「像素档」那一段，要过同档判断）。
 */
function aspectRatioMatchKey(value: unknown): string | null {
  const size = widthHeightOf(value);
  return size ? `${size.width}:${size.height}` : null;
}

export function isAutoOptionValue(value: unknown): boolean {
  return typeof value === "string" && AUTO_OPTION_PATTERN.test(value.trim());
}

/** 一个选项：渲染层有展示文字（`text`），宿主的参数表只有值。 */
export type AspectRatioOptionLike = Readonly<{ value: unknown; text?: string }>;

/**
 * 一组选项是不是「比例控件」：去掉自动档后至少一项，且每一项（值或展示文字）都是比例。
 * 像素尺寸档（`1280:720` 混着 `auto_720p`）不算——那组选的是分辨率，不是比例。
 */
export function optionsAreAspectRatios(options: readonly AspectRatioOptionLike[]): boolean {
  const explicit = options.filter(({ value, text }) => !isAutoOptionValue(value) && !isAutoOptionValue(text ?? ""));
  return explicit.length > 0 && explicit.every(({ value, text }) =>
    normalizeAspectRatioToWH(value) !== null || normalizeAspectRatioToWH(text ?? "") !== null);
}

// ── 像素档（2026-10-05 验收补）────────────────────────────────────────────────────────────────
//
// Runway 那一层的 Seedance 2 / Veo 3.1 / gen4 / Gemini 图像 3 / gpt-image-2 / Seedream 5 等，比例控件的选项是
// **像素串**（`1280:720`、`1920:1080`、`1344:768`）：一个选项同时定了比例和分辨率。用户说 16:9 时，它们的比例
// 就是 16:9（或供应商取整后的近似：Gemini 的 16:9 档是 1344:768，gpt-image-2 的是 1920:1088），应该直接对上。
// 但同一个比例常有好几档分辨率——挑哪一档就是挑价钱，所以只认「和这一镜当前那一档 / 控件默认那一档同档」的，
// 判不出来就拒并列出候选，绝不随便挑。

/** 两个比例算「同一个比例」的相对误差上限。供应商取整的近似都在 2% 以内；相邻的常用比例（16:9 与 5:3、4:3 与 5:4）差 6% 以上。 */
const PIXEL_RATIO_TOLERANCE = 0.03;
/**
 * 两档像素尺寸算「同一档」：短边相等（Wan 的 720p 档 = 1280:720 / 960:720 / 720:720），或面积差在 1.25 倍以内
 * （Seedance 的 720p 档 = 1280:720 / 960:960，等面积）。各家相邻两档至少差 2 倍面积（720p→1080p 是 2.25 倍）。
 */
const SAME_TIER_AREA_FACTOR = 1.25;
/** 短边达到这个数才算像素串（`1:8`、`21:9` 这类比例串的数都很小）。 */
const PIXEL_MIN_SIDE = 100;

type WidthHeight = Readonly<{ width: number; height: number }>;

function widthHeightOf(value: unknown): WidthHeight | null {
  const match = normalizeAspectRatioToWH(value)?.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

const isPixelSize = (size: WidthHeight): boolean => Math.min(size.width, size.height) >= PIXEL_MIN_SIDE;

/**
 * 「自动 + 分辨率档」的选项（`auto_720p` / `auto_2k`，Runway 的 Wan 3.0、Seedream 5 Pro、Grok Imagine）。
 * 它们是自动比例的几个分辨率档，不是比例，也不是普通的「自动」（三个都叫自动就分不清了）。
 */
const TIERED_AUTO_PATTERN = /^auto_(\d+)\s*(p|k)$/i;

type SizeTier = Readonly<{ area: number; shortSide?: number }>;

/** 一档的尺寸：像素串直接算；`auto_720p` = 短边 720（面积按 16:9 算），`auto_2k` = 2048 见方的面积。 */
function tierOf(value: unknown): SizeTier | null {
  const size = widthHeightOf(value);
  if (size) return isPixelSize(size) ? { area: size.width * size.height, shortSide: Math.min(size.width, size.height) } : null;
  const tiered = typeof value === "string" ? value.trim().match(TIERED_AUTO_PATTERN) : null;
  if (!tiered) return null;
  const amount = Number(tiered[1]);
  return tiered[2]!.toLowerCase() === "p" ? { area: (amount * 16 / 9) * amount, shortSide: amount } : { area: (amount * 1024) ** 2 };
}

function sameTier(candidate: SizeTier, reference: SizeTier): boolean {
  if (candidate.shortSide !== undefined && candidate.shortSide === reference.shortSide) return true;
  return Math.max(candidate.area, reference.area) / Math.min(candidate.area, reference.area) <= SAME_TIER_AREA_FACTOR;
}

/** 比例控件（宿主翻译用）：除自动档与「自动 + 分辨率档」外，每一项都是比例或像素串。 */
function isRatioControl(options: readonly AspectRatioOptionLike[]): boolean {
  return optionsAreAspectRatios(options.filter(({ value }) =>
    !(typeof value === "string" && TIERED_AUTO_PATTERN.test(value.trim()))));
}

/** 一个参数控件（键、选项、档案声明的默认值）。 */
export type AspectRatioControlLike = Readonly<{
  key: string;
  options: readonly AspectRatioOptionLike[];
  defaultValue?: unknown;
}>;

/** 想要的比例落到哪个键、哪个值上；落不了时说清是哪一种落不了。 */
export type AspectRatioChoice =
  | Readonly<{ ok: true; key: string; value: unknown }>
  | Readonly<{ ok: false; reason: "no_ratio_control" }>
  | Readonly<{ ok: false; reason: "ambiguous"; keys: readonly string[] }>
  | Readonly<{ ok: false; reason: "not_offered"; key: string; allowedValues: readonly unknown[] }>
  /** 同一个比例有好几档分辨率，而这一镜判不出要哪一档：列出这几档，让调用方挑。 */
  | Readonly<{ ok: false; reason: "several_sizes"; key: string; candidates: readonly unknown[] }>;

/**
 * 「用户要 16:9」→「这个模式的哪个控件、哪一档」。纯函数，读者给出这个模式的控件表即可。
 *
 * - 比例控件 = 除自动档外每一项都是比例或像素串的那个；一个都没有 → `no_ratio_control`（比例跟着输入图走的模式）；
 *   两个以上 → `ambiguous`（今天全目录 0 例，出现了就拒，不挑一个）。
 * - `auto` → 控件自己的自动档（`auto` / `adaptive`）；只有「自动 + 分辨率档」的按同档规则挑；都没有 → `not_offered`。
 * - 写法与某个选项是同一个比例串 → 那一档（`landscape_16_9` 那一档就回 `landscape_16_9`）。
 * - 否则看像素档：比例相等（误差 ≤ 3%）的那几档里，只有一档 → 它；好几档 → 取和**这一镜当前那一档**
 *   （`current`，调用方写在参数里的值）或**控件默认那一档**同档的；判不出 → `several_sizes` 带候选。
 */
export function resolveAspectRatioChoice(
  requested: string,
  controls: readonly AspectRatioControlLike[],
  current: Readonly<Record<string, unknown>> = {},
): AspectRatioChoice {
  const ratioControls = controls.filter((control) => isRatioControl(control.options));
  if (ratioControls.length === 0) return { ok: false, reason: "no_ratio_control" };
  if (ratioControls.length > 1) return { ok: false, reason: "ambiguous", keys: ratioControls.map((control) => control.key) };
  const control = ratioControls[0]!;
  const values = control.options.map((option) => option.value);
  const notOffered = (): AspectRatioChoice => ({ ok: false, reason: "not_offered", key: control.key, allowedValues: values });
  const chosen = (value: unknown): AspectRatioChoice => ({ ok: true, key: control.key, value });
  // 同档的参照：这一镜写着的那一档优先，其次档案默认。
  const referenceValue = tierOf(current[control.key]) ? current[control.key] : tierOf(control.defaultValue) ? control.defaultValue : undefined;
  const reference = referenceValue === undefined ? null : tierOf(referenceValue);
  const pickBySize = (candidates: readonly unknown[], closeness: (value: unknown) => number): AspectRatioChoice => {
    if (candidates.length === 1) return chosen(candidates[0]);
    // 参照那一档本身就是候选之一（默认 1024:1024，要 1:1）→ 就是它。
    if (referenceValue !== undefined && candidates.some((value) => Object.is(value, referenceValue))) return chosen(referenceValue);
    const atTier = reference === null ? [] : candidates.filter((value) => sameTier(tierOf(value)!, reference));
    if (atTier.length === 0) return { ok: false, reason: "several_sizes", key: control.key, candidates };
    const ranked = [...atTier].sort((left, right) => closeness(left) - closeness(right));
    if (ranked.length > 1 && closeness(ranked[0]) === closeness(ranked[1])) {
      return { ok: false, reason: "several_sizes", key: control.key, candidates: atTier };
    }
    return chosen(ranked[0]);
  };

  if (isAutoOptionValue(requested)) {
    const auto = control.options.find(({ value, text }) => isAutoOptionValue(value) || isAutoOptionValue(text ?? ""));
    if (auto) return chosen(auto.value);
    const tiered = values.filter((value) => typeof value === "string" && TIERED_AUTO_PATTERN.test(value.trim()));
    return tiered.length > 0 ? pickBySize(tiered, () => 0) : notOffered();
  }
  const wanted = aspectRatioMatchKey(requested);
  if (wanted === null) return notOffered();
  const exact = control.options.find(({ value, text }) =>
    aspectRatioMatchKey(value) === wanted || aspectRatioMatchKey(text ?? "") === wanted);
  if (exact) return chosen(exact.value);
  const target = widthHeightOf(wanted)!;
  const targetRatio = target.width / target.height;
  const drift = (value: unknown): number => {
    const size = widthHeightOf(value)!;
    return Math.abs((size.width / size.height) / targetRatio - 1);
  };
  const sameRatio = values.filter((value) => {
    const size = widthHeightOf(value);
    return size !== null && isPixelSize(size) && drift(value) <= PIXEL_RATIO_TOLERANCE;
  });
  return sameRatio.length === 0 ? notOffered() : pickBySize(sameRatio, drift);
}

/** 这个模式唯一的比例控件的键；没有、或不止一个 → undefined（不挑一个）。 */
export function aspectRatioControlKey(controls: readonly AspectRatioControlLike[]): string | undefined {
  const ratioControls = controls.filter((control) => isRatioControl(control.options));
  return ratioControls.length === 1 ? ratioControls[0]!.key : undefined;
}

/**
 * 「比例意图」住的语义槽：分镜方案的行级 / 整片画幅写在 `aspect_ratio`（`storyboardShotScope` 的 FILM_DEFAULTS），
 * 模型面与宿主候选的语义键是 `aspectRatio`。它们都**不是**某一家的参数名——Z-Image 叫 `size`、Agnes 叫 `ratio`。
 */
const ASPECT_RATIO_INTENT_KEYS = [ASPECT_RATIO_SEMANTIC_KEY, "aspect_ratio"] as const;

/** 一份参数把比例意图落到这个模式上的结果：落上了 / 这个模式没有这个比例（如实缺席）/ 本来就没写比例。 */
export type AspectRatioPlacement = Readonly<{
  parameters: Record<string, unknown>;
  outcome: "placed" | "unsupported" | "none";
}>;

/**
 * 分镜 / 画布落地那一层用的：把参数里的比例意图（语义槽）翻成这个模式的真实比例键与选项值。
 * 判据就是 `resolveAspectRatioChoice`（宿主翻译同一份）：写法与某档同串 → 那一档；像素档按同档挑；
 * 这个模式没有比例选择或没有这一档 → `unsupported`，语义槽从参数里拿掉（诚实缺席，不发一个供应商不认的键）。
 * 语义槽恰好就是这个模式的真实键（Nano Banana 2 kie 的 `aspect_ratio`）时，合法值原样留着。
 */
export function placeAspectRatio(
  parameters: Readonly<Record<string, unknown>>,
  controls: readonly AspectRatioControlLike[],
): AspectRatioPlacement {
  const intentKey = ASPECT_RATIO_INTENT_KEYS.find((key) => typeof parameters[key] === "string" && (parameters[key] as string).trim());
  if (!intentKey) return { parameters: { ...parameters }, outcome: "none" };
  const requested = (parameters[intentKey] as string).trim();
  const key = aspectRatioControlKey(controls);
  const out: Record<string, unknown> = { ...parameters };
  for (const intent of ASPECT_RATIO_INTENT_KEYS) if (intent !== key) delete out[intent];
  if (!key) return { parameters: out, outcome: "unsupported" };
  const control = controls.find((candidate) => candidate.key === key)!;
  if (control.options.some(({ value }) => Object.is(value, requested))) return { parameters: { ...out, [key]: requested }, outcome: "placed" };
  const choice = resolveAspectRatioChoice(requested, controls, parameters);
  if (!choice.ok) {
    delete out[key];
    // 真实键原来写着的合法值（不是这次的意图）留着：只拿掉翻不过去的那一个。
    if (key !== intentKey && parameters[key] !== undefined) out[key] = parameters[key];
    return { parameters: out, outcome: "unsupported" };
  }
  return { parameters: { ...out, [choice.key]: choice.value }, outcome: "placed" };
}

/** 档案的参数控件（`{ key, options: [{ value, label }], defaultValue }`）→ 本模块的控件形状。 */
export function aspectRatioControlsOf(
  controls: readonly Readonly<{ key: string; options?: readonly Readonly<{ value: unknown; label?: string }>[]; defaultValue?: unknown }>[],
): AspectRatioControlLike[] {
  return controls.map((control) => ({
    key: control.key,
    options: (control.options ?? []).map((option) => ({ value: option.value, ...(option.label !== undefined ? { text: option.label } : {}) })),
    ...(control.defaultValue !== undefined ? { defaultValue: control.defaultValue } : {}),
  }));
}
