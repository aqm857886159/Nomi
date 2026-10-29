// 浏览器「提取提示词」的跨进程契约（2026-10-27，设计卡 docs/plan/2026-10-27-browser-extract-grant.md）。
//
// 整次提取住在主进程：渲染层准备好参考图后经 `browser:prompt-extraction:run`（invoke，只认 Nomi 主窗口）交过去，
// 主进程走那条唯一的链（confirmSpendAndMintGrant）弹卡问人、铸令牌，再发这一次读图调用。
// 每次都问：页内的「提取」按钮注入在远端网页里，网页自己就能冒充那一下点击，所以「点了就算确认」不成立。
//
// 卡上要写清「读的是哪个页面的哪张图」。那条链不改，只能借它现有的 `prompt` 字段带过去：
// 主进程在这里算好两行（来源页主机名、图片名）编进去，渲染层的卡用同一个模块解开——格式只有这一个主人。

/** 付费确认卡按它查表取专用措辞（src/workbench/capability/spendCardByIntent.ts）。 */
export const PROMPT_EXTRACTION_SPEND_INTENT = "prompt-extraction";

/** 提取方式：复刻这张图 / 学它的风格。 */
export type BrowserPromptExtractionMode = "replicate" | "style";

export type BrowserPromptExtractionRunRequest = {
  vendor: string;
  modelKey: string;
  /** 交给读图模型的整句指令（用户的提取模板拼好的），主进程当不透明文本。 */
  prompt: string;
  /** 模型真正读的那张图：抓到的原图 / 截图（多为 data URL）。 */
  imageUrl: string;
  mode: BrowserPromptExtractionMode;
  /** 发起那一刻的项目；没打开项目 = null。只用于追踪，提示词库是全局的。 */
  projectId: string | null;
  /** 来源页：主进程转发时记下的浏览视图真实地址，或标签页状态里的地址。 */
  pageUrl: string;
  /** 这张图的来处（原图地址）；截图时为空串。 */
  imageSourceUrl: string;
};

export type BrowserPromptExtractionRunOutcome =
  /** 用户确认了，这一次调用发出去并回来了（任务结果原样交回，渲染层解析）。 */
  | { outcome: "done"; result: unknown }
  /** 卡上点了取消（或卡没能弹出来就收了）：什么都没发。 */
  | { outcome: "not-confirmed" }
  /** 已经有一张提取卡开着：不排队、不弹第二张。 */
  | { outcome: "busy" };

/** 卡上那两行：来源页（主机名）、图片（文件名或缩短的地址；空串 = 页面截图）。 */
export type PromptExtractionSubject = { page: string; image: string };

const SUBJECT_PREFIX = "nomi-prompt-extraction-subject:";
const LABEL_MAX = 80;

function shorten(value: string): string {
  const text = value.trim();
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 来源页那一行：有主机名就只写主机名（网页改不了它），没有就写缩短的原地址。 */
export function promptExtractionPageLabel(pageUrl: string): string {
  const text = String(pageUrl || "").trim();
  if (!text) return "";
  const parsed = parseUrl(text);
  return parsed?.hostname ? parsed.hostname : shorten(text);
}

/** 图片那一行：原图地址的文件名；取不到文件名写主机名 + 路径；data URL 只写到媒体类型。截图（空串）原样返回空串。 */
export function promptExtractionImageLabel(imageSourceUrl: string): string {
  const text = String(imageSourceUrl || "").trim();
  if (!text) return "";
  if (/^data:/i.test(text)) {
    const end = text.search(/[;,]/);
    return end > 0 ? shorten(text.slice(0, end)) : "data:";
  }
  const parsed = parseUrl(text);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return shorten(text);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  let fileName: string;
  try {
    fileName = decodeURIComponent(last);
  } catch {
    fileName = last;
  }
  return shorten(fileName || `${parsed.hostname}${parsed.pathname}`);
}

export function promptExtractionSubjectOf(input: { pageUrl: string; imageSourceUrl: string }): PromptExtractionSubject {
  return { page: promptExtractionPageLabel(input.pageUrl), image: promptExtractionImageLabel(input.imageSourceUrl) };
}

export function encodePromptExtractionSubject(subject: PromptExtractionSubject): string {
  return `${SUBJECT_PREFIX}${JSON.stringify({ page: subject.page, image: subject.image })}`;
}

/** 解不开（不是这个格式 / 字段不全）= null：卡说不清读哪张图，就不该问人（调用方 fail-closed）。 */
export function decodePromptExtractionSubject(text: unknown): PromptExtractionSubject | null {
  if (typeof text !== "string" || !text.startsWith(SUBJECT_PREFIX)) return null;
  try {
    const value = JSON.parse(text.slice(SUBJECT_PREFIX.length)) as { page?: unknown; image?: unknown } | null;
    if (typeof value?.page !== "string" || typeof value.image !== "string") return null;
    return { page: value.page, image: value.image };
  } catch {
    return null;
  }
}
