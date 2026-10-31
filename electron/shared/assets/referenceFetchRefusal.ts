// 「这句失败是不是：模型那一侧去拉我们给的输入链接，拉不到」——全仓唯一的判据（不依赖 electron）。
//
// 为什么要单列一个共享判据：这件事有两个读者，必须是同一份——
//   · 主进程 `productionGenerationSubmission` 在提交被拒 / 任务失败时问它，答「是」就记下这条连接，之后参考素材走上传；
//   · 渲染层 `classifyGenerationError` 问它，答「是」就给「模型取不到参考图」那张卡。
// 两边各写一份，就会出现「记了账却没有卡」或「有卡却没记账」。
//
// 判据的次序：
//   ① 上游自己给的错误码（稳定标识，不随语言改词）；
//   ② 再认通用说法（英文、中文）。**不按服务商写分支**：同一句话换家说，仍然应该认。
// 只认「拉不到**输入**（参考 / 输入 / 源）链接」。取结果、下载产物、任务、上传这几类失败的说法长得很像，
// 但它们的下一步完全不同（重新取回 / 重试上传），所以命中的那一段里出现这些词就不算。

/** 上游错误码（规范化后比较：小写，`-` `.` 空白当成 `_`）。一行一个出处，没出处的不登记。 */
const REFUSAL_UPSTREAM_CODES: ReadonlySet<string> = new Set([
  "file_download_error", // 一家模型聚合服务：下载不了输入文件时返回 422，type 就是它
  "invalid_image_url", // 一家模型 API：图片链接拉取超时 / 出错时的 code（社区里 Timeout while downloading）
]);

function normalizeCode(code: string | undefined): string {
  return String(code ?? "").trim().toLowerCase().replace(/[-.\s]+/g, "_");
}

/** 码也可能只出现在整句里（`"type":"file_download_error"` 被原样带进了错误文字）：整词出现同样算。 */
const CODE_IN_TEXT = new RegExp(`\\b(?:${[...REFUSAL_UPSTREAM_CODES].join("|")})\\b`, "i");

const NEG = String.raw`(?:could\s*not|couldn'?t|cannot|can'?t|can\s+not|unable\s+to|failed\s+to|fails?\s+to|not\s+able\s+to)`;
const FETCH = String.raw`(?:fetch|download|retriev|access|load|read|reach|resolve|get|pull)\w*`;
const INPUT = String.raw`(?:input|reference|source)`;
/** 名词短语里"输入"和"链接"之间最多隔一两个词：input media URL / reference image link / input_image url。 */
const INPUT_LINK = String.raw`\b${INPUT}[\w\s_-]{0,24}?\b(?:url|link|uri)s?\b`;

type Phrase = { pattern: RegExp; /** 命中后再往后看几个字符（到句末为止）找「别的失败」的词；0 = 只看命中的那一段。 */ tail: number };

const phrase = (source: string, flags = "i", tail = 0): Phrase => ({ pattern: new RegExp(source, `${flags}g`), tail });

/** 命中即「拉不到输入链接」的通用说法。每一行旁边写一句它在说什么。 */
const REFUSAL_PHRASES: readonly Phrase[] = [
  // An input media URL could not be fetched (403/404/410).  ——「输入…链接」在前，后面跟「不能被拉取」
  phrase(String.raw`${INPUT_LINK}[^.\n]{0,60}?\b${NEG}\s+(?:be\s+)?${FETCH}`),
  // The reference image URL is not accessible / returned 403 / has expired  ——链接本身的状态
  phrase(String.raw`${INPUT_LINK}[^.\n]{0,40}?\b(?:not\s+(?:accessible|reachable|available|downloadable)|inaccessible|unreachable|expired|forbidden|returned\s+(?:an?\s+)?(?:http\s*)?(?:status\s*)?[45]\d\d)`),
  // Failed to download input image from URL / Cannot fetch content from the provided URL  ——动词在前，后面落在链接 / 输入上
  phrase(String.raw`\b${NEG}\s+${FETCH}\b[^.\n]{0,80}?\b(?:url|link|uri|${INPUT})\b`),
  // Unable to download the file. / Could not download the image.  ——只有「文件 / 图片」，没有链接词
  phrase(String.raw`\b${NEG}\s+${FETCH}\s+(?:the\s+)?(?:input\s+)?(?:file|image|media|video|audio)\b`),
  // Timeout while downloading <url>. / Error while downloading <url>.  ——后面什么都不说，只能看同一句里有没有「别的失败」的词
  phrase(String.raw`\b(?:error|timeout|timed\s+out)\s+while\s+(?:downloading|fetching|retrieving)\b`, "i", 40),
  // 中文：参考图片无法访问 / 输入媒体 URL 无法获取 / 参考图链接已过期
  phrase("(?:参考|输入)[^。\\n，,；;]{0,12}?(?:图|图片|图像|视频|音频|媒体|素材|文件|链接|URL|url|地址)[^。\\n]{0,24}?(?:无法|不能|未能|没能|获取不到|拉取不到|下载不到|读取不到|访问不到|已过期|已失效|过期|失效|不可访问)", ""),
  // 中文：无法获取参考图片 / 无法下载输入图片
  phrase("(?:无法|不能|未能|没能)[^。\\n]{0,6}?(?:获取|下载|访问|拉取|读取|打开)[^。\\n]{0,16}?(?:参考|输入)[^。\\n]{0,8}?(?:图|图片|图像|视频|音频|媒体|素材|文件|链接|地址)", ""),
  // 中文：下载输入图片失败 / 拉取参考图超时
  phrase("(?:下载|获取|拉取|读取)(?:参考|输入)(?:图|图片|图像|视频|音频|媒体|素材|文件)[^。\\n]{0,6}?(?:失败|出错|超时)", ""),
  // 中文：图片链接无法访问 / URL 无法获取
  phrase("(?:链接|URL|url|地址)[^。\\n]{0,16}?(?:无法|不能|未能|没能)(?:访问|获取|下载|读取|拉取|打开)", ""),
];

/** 这些词出现在命中的那一段里，说明它说的是别的失败：取结果 / 下载产物 / 任务 / 上传 / 回调。 */
const NOT_ABOUT_INPUT = /\b(?:results?|outputs?|generated|tasks?|uploads?|uploading|uploaded|webhooks?|callbacks?)\b|结果|产物|输出|任务|上传|生成的|回调/i;
/** 往后看的范围到句末为止：「Timeout while downloading X. The task was cancelled」里的 task 是下一句的话。 */
const SENTENCE_END = /[.\n。!?！？]/;

/** 整段 URL 是别人的字（路径里常有 tasks / results）：判之前整体抠掉，只留话。URL 末尾的句号逗号不算 URL，留给「句末」用。 */
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)\]]/gi;

export type ReferenceFetchRefusalInput = {
  /** 上游自己给的错误码（`VendorErrorStructured.upstreamCode`）；没有就不给。 */
  upstreamCode?: string;
  /** 失败的那句话：上游原话优先，没有就整句错误。 */
  text?: string;
};

export function isReferenceFetchRefusal(input: ReferenceFetchRefusalInput): boolean {
  if (REFUSAL_UPSTREAM_CODES.has(normalizeCode(input.upstreamCode))) return true;
  const text = String(input.text ?? "").replace(URL_IN_TEXT, " ");
  if (!text.trim()) return false;
  if (CODE_IN_TEXT.test(text)) return true;
  for (const { pattern, tail } of REFUSAL_PHRASES) {
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      const after = tail > 0 ? text.slice(end, end + tail).split(SENTENCE_END, 1)[0] : "";
      if (!NOT_ABOUT_INPUT.test(`${match[0]}${after}`)) return true;
    }
  }
  return false;
}
