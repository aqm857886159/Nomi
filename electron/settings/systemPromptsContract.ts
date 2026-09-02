// 创作助手「系统提示词」的用户覆盖层（用户 2026-08-17 拍板：提示词搬进设置、可编辑 + 恢复默认）。
//
// 设计要点（P1 加新必删旧 / 单一真相源）：
// 这里**只存用户改过的那几条**。默认提示词的唯一真相源永远是渲染进程的
// `src/workbench/creation/creationAiModes.ts`（`CREATION_AI_MODES`）——把默认值也写盘会产生
// 第二份提示词副本，以后改默认值时老用户永远卡在旧文案上（并行版）。所以：
//   - 某个模式**不在** map 里 = 它在用内置默认值；
//   - 某个模式在 map 里 = 用户显式改过，用它。
// 「恢复默认」= 从 map 里删掉这一条，而不是把默认文本写回去。
//
// 默认值不在主进程这边（它住渲染进程的模式清单），所以「等于默认值就不算覆盖」这条清洗
// 规则没法在主进程判——由调用方（渲染进程）在写入前剔除，主进程只做与默认值无关的清洗。

/** 与 `src/workbench/creation/creationAiModes.ts` 的 `CreationAiModeId` 一一对应。 */
export const SYSTEM_PROMPT_MODE_IDS = [
  "general",
  "story",
  "script",
  "assets",
  "storyboard",
  "seedance",
  "review",
] as const;

export type SystemPromptModeId = (typeof SYSTEM_PROMPT_MODE_IDS)[number];

/**
 * 单条提示词长度上限：65536 字符。
 *
 * 定法：**装得下最长的内置提示词，再留几倍余量给用户自己扩写**；同时挡住「误把整份文稿/日志
 * 粘进来」这类把设置文件撑爆、又必然超模型上下文的输入。超长的做**截断**而不是整条丢弃：
 * 用户手里那份长文本还在编辑框里，直接丢会让他以为保存成功了。
 *
 * 2026-09-02 从 32768 提到 65536。最长的内置提示词变成了「素材规划」的**英文版**
 * ASSET_MASTER_PROMPT_EN（约 3.3 万字符——同一份规范英文比中文长约 2.3 倍，中文字更密），
 * 它已经**超出旧上限 263 字符**。而截断是静默的（sanitizeSystemPrompt 直接 slice）：英文用户
 * 只要动一下这条提示词再保存，末尾「交付前全面自检」整节就被无声切掉，此后生成缺自检、
 * 且极难查到原因。按上限自己的定法，最长内置提示词长了，上限就得跟着长。
 * 64K 字符 ≈ 16-32K token，仍在主流长上下文模型可用范围内。
 *
 * 「上限必须容得下最长内置提示词并留余量」这条规则由 src/workbench/creation/
 * creationAiPromptLocale.test.ts 钉死（断言住在渲染侧：内置提示词表在 src/，主进程不得反向
 * import 渲染层，R26）——以后谁再加一条更长的内置提示词，测试当场红，而不是等用户丢了数据才发现。
 */
export const SYSTEM_PROMPT_MAX_LENGTH = 65536;

/** 自定义提示词名字上限：够写清「口播带货体 · 客户A 调性」这类，又不至于把下拉撑爆。 */
export const CUSTOM_PROMPT_NAME_MAX_LENGTH = 40;

/**
 * 自定义提示词条数上限。不是产品限制，是**防写坏**：这份设置文件每次启动都要读进内存，
 * 没有上限时一个循环写入的 bug 就能把它撑到几百兆。50 条远超任何真实用法。
 */
export const CUSTOM_PROMPT_MAX_COUNT = 50;

/**
 * 用户自建的提示词（用户 2026-08-18 拍板：只要「名字 + 正文」两个框，不要 manifest）。
 *
 * `id` 生成一次即固定、**不随改名变**：用户的选择记在 `creationAiModeId` 里，
 * 用名字当 id 会让改一次名就把当前选择打飞。
 */
export type CustomSystemPrompt = {
  id: string;
  name: string;
  prompt: string;
};

export type SystemPromptOverrides = {
  schemaVersion: 2;
  /** 只放用户覆盖过的**内置**模式；缺席 = 用内置默认值。 */
  prompts: Partial<Record<SystemPromptModeId, string>>;
  /** 用户自建的提示词。空数组 = 一个都没建。 */
  custom: CustomSystemPrompt[];
};

export const DEFAULT_SYSTEM_PROMPT_OVERRIDES: SystemPromptOverrides = {
  schemaVersion: 2,
  prompts: {},
  custom: [],
};

/** 自定义 id 的前缀：让它和内置模式 id 在任何地方都不可能撞（也便于一眼看出是自建的）。 */
export const CUSTOM_PROMPT_ID_PREFIX = "custom:";

export function isCustomPromptId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CUSTOM_PROMPT_ID_PREFIX) && value.length > CUSTOM_PROMPT_ID_PREFIX.length;
}

const MODE_ID_SET = new Set<string>(SYSTEM_PROMPT_MODE_IDS);

export function isSystemPromptModeId(value: unknown): value is SystemPromptModeId {
  return typeof value === "string" && MODE_ID_SET.has(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clampPrompt(prompt: string): string {
  return prompt.length > SYSTEM_PROMPT_MAX_LENGTH ? prompt.slice(0, SYSTEM_PROMPT_MAX_LENGTH) : prompt;
}

/**
 * 清洗自定义提示词列表。丢弃：形状不对、id 不合法（必须带 custom: 前缀，才不可能和内置模式撞）、
 * **名字**去空白后为空、id 重复的后来者。截断：超长名字/正文。整体截到 CUSTOM_PROMPT_MAX_COUNT。
 *
 * 名字**允许重名**（用户可能真想要两个「客户A」），靠 id 区分；重名只是显示上的事，不该拦着他存。
 *
 * **正文允许为空**（2026-08-18 修）：新建一条提示词的那一刻正文本来就是空的——用户先起名字、
 * 再慢慢写正文，中途可能关掉设置页/退出应用。要是把「正文为空」当垃圾丢掉，这条新建项
 * 一落盘就消失：用户看到 chip 出现、下次启动却没了，且**毫无提示**（无声数据丢失）。
 * 身份靠 `name` 立得住，空正文只是「还没写」，不是坏数据。
 * 空正文的条目被选中时，创作侧照旧只是没有专长层可注入，不会出错。
 */
function normalizeCustomPrompts(value: unknown): CustomSystemPrompt[] {
  if (!Array.isArray(value)) return [];
  const out: CustomSystemPrompt[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= CUSTOM_PROMPT_MAX_COUNT) break;
    const entry = record(item);
    const { id, name, prompt } = entry;
    if (!isCustomPromptId(id)) continue;
    if (seen.has(id)) continue;
    if (typeof name !== "string" || typeof prompt !== "string") continue;
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    seen.add(id);
    out.push({
      id,
      name: trimmedName.length > CUSTOM_PROMPT_NAME_MAX_LENGTH ? trimmedName.slice(0, CUSTOM_PROMPT_NAME_MAX_LENGTH) : trimmedName,
      prompt: clampPrompt(prompt),
    });
  }
  return out;
}

/**
 * 清洗一份可能来自旧版本 / 被手改过 / 被降级写坏的设置文件。
 * 丢弃：未知模式 id、非字符串值、去空白后为空的值（空 = 没覆盖，不是「覆盖成空提示词」）。
 * 截断：超过 SYSTEM_PROMPT_MAX_LENGTH 的值。
 *
 * v1 → v2 迁移：v1 没有 `custom` 字段，读进来就是空数组——形状天然向后兼容，
 * 不需要单独的迁移分支，也**绝不能**因为版本号不是 2 就整份丢掉
 * （那会把用户已经改过的内置提示词抹掉）。
 */
export function normalizeSystemPromptOverrides(value: unknown): SystemPromptOverrides {
  const raw = record(value);
  const rawPrompts = record(raw.prompts);
  const prompts: Partial<Record<SystemPromptModeId, string>> = {};
  for (const [modeId, prompt] of Object.entries(rawPrompts)) {
    if (!isSystemPromptModeId(modeId)) continue;
    if (typeof prompt !== "string") continue;
    // 空白串不是有效覆盖：用户清空输入框的语义是「回默认」，由 UI 的「恢复默认」表达，
    // 存一条空提示词只会让助手拿到空的专长层。
    if (!prompt.trim()) continue;
    prompts[modeId] = clampPrompt(prompt);
  }
  return { schemaVersion: 2, prompts, custom: normalizeCustomPrompts(raw.custom) };
}
