// 「这句失败是不是：模型那一侧去拉我们给的输入链接，拉不到」——全仓唯一的判据（不依赖 electron）。
//
// 为什么要单列一个共享判据：这件事有两个读者，必须是同一份——
//   · 主进程 `productionGenerationSubmission` 在提交被拒 / 任务失败时问它，答「是」就记下这条连接，之后参考素材走上传；
//   · 渲染层 `classifyGenerationError` 问它，答「是」就给「模型取不到参考图」那张卡，主按钮是要花钱的重试。
// 两边各写一份，就会出现「记了账却没有卡」或「有卡却没记账」。
//
// 判据的次序：
//   ① 上游自己给的错误码（稳定标识，不随语言改词）；
//   ② 再认通用说法（英文、中文）。**不按服务商写分支**：同一句话换家说，仍然应该认。
//
// **宁可漏认，不可错认。** 这个判据全 App 的错误都会问。漏认了，发送前的试探还在，用户看到的只是老卡；错认了，审核、鉴权、
// 大小、参数这类错误会被说成「取不到参考图」，把人引向要花钱的重试，还把这条连接记下来。所以每条说法都要明说「输入的链接」
// 或「输入的素材 + 去拿的动词」，光有「下载失败」「图片不能」不算。

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
/** 主语已经是「输入的链接」：证据够硬，动词可以宽。 */
const REACH_LINK = String.raw`(?:fetch|download|retriev|access|load|read|reach|resolve|get|pull)\w*`;
/** 动词在前：去掉 read / reach / resolve / get——「连不上接口地址」「读不了文件」不是这一类。 */
const FETCH = String.raw`(?:fetch|download|retriev|access|load|pull)\w*`;
const MEDIA = String.raw`(?:image|picture|photo|video|audio|media|file|asset)s?`;
const INPUT = String.raw`(?:input|reference|source)`;
/**
 * 输入的链接：input media URL / reference image link / input_image url / image_url / the provided URL。「输入」和「链接」之间最多隔两个词。
 * 没有「输入」二字时不认音频和素材：「the audio URL is unreachable」是我们自己的转写报错，「the asset link has expired」是内置浏览器的提示。
 */
const INPUT_LINK = String.raw`\b(?:${INPUT}(?:[\s_-]+[\w-]+){0,2}?[\s_-]+|provided\s+|(?:image|picture|photo|video|media|file)s?[\s_-]?)(?:url|link|uri)s?\b`;
/** 整段 URL 抠掉后留下的记号：「Timeout while downloading <url>」只有后面真跟着链接才算。 */
const URL_MARK = "__url__";
const ZH_MEDIA = "(?:图片?|图像|视频|音频|媒体|素材|文件)";
const ZH_LINK = "(?:链接|URL|url|地址)";
const ZH_CANT = "(?:无法|不能|未能|没能)(?:被)?(?:获取|下载|访问|拉取)";
const ZH_DEAD = `(?:${ZH_CANT}|获取不到|拉取不到|下载不到|访问不到|不可访问|已过期|已失效)`;

type Phrase = { pattern: RegExp; /** 只说文件、没说链接的那种句子：整段话里别处得提到链接才算。 */ needsLinkWord?: boolean };

const phrase = (source: string, flags = "i", needsLinkWord = false): Phrase => ({ pattern: new RegExp(source, flags), needsLinkWord });

/** 命中即「拉不到输入链接」的通用说法。每一行旁边写一句它在说什么。 */
const REFUSAL_PHRASES: readonly Phrase[] = [
  // An input media URL could not be fetched (403/404/410). / The parameter `image_url` ... failed to download
  phrase(String.raw`${INPUT_LINK}[^.\n]{0,60}?\b${NEG}\s+(?:be\s+)?${REACH_LINK}`),
  // The reference image URL is not accessible / returned 403 / has expired  ——链接本身的状态
  phrase(String.raw`${INPUT_LINK}[^.\n]{0,40}?\b(?:not\s+(?:accessible|reachable|available|downloadable)|inaccessible|unreachable|expired|forbidden|returned\s+(?:an?\s+)?(?:http\s*)?(?:status\s*)?[45]\d\d)`),
  // Failed to download input image from URL / could not download input image  ——动词后面明说是输入的素材
  phrase(String.raw`\b${NEG}\s+${FETCH}\b[^.\n]{0,40}?\b${INPUT}[\s_-]+${MEDIA}\b`),
  // Cannot fetch content from the provided URL. / Failed to fetch asset from URL  ——动词后面落在链接上
  phrase(String.raw`\b${NEG}\s+${FETCH}\b[^.\n]{0,60}?\b(?:url|uri|link)s?\b`),
  // Unable to download the file. Please verify the URL and try again.  ——这句只说文件，下一句才提链接
  phrase(String.raw`\b${NEG}\s+(?:fetch|download|retriev|pull)\w*\s+(?:the\s+)?(?:input\s+)?${MEDIA}\b`, "i", true),
  // Timeout while downloading <url>. / Error while downloading <url>.
  phrase(String.raw`\b(?:error|timeout|timed\s+out)\s+while\s+(?:downloading|fetching|retrieving)\s+(?:the\s+)?${URL_MARK}`),
  // Image fetch failed. Check access settings or use our File Upload API instead.
  phrase(String.raw`\b(?:image|media|file)\s+fetch\s+failed\b`),
  // 中文：参考图链接已过期 / 输入媒体 URL 无法获取
  phrase(`(?:参考|输入)${ZH_MEDIA}?的?\\s*${ZH_LINK}[^。\\n]{0,16}?${ZH_DEAD}`, ""),
  // 中文：无法获取参考图片 / 无法下载输入图片
  phrase(`${ZH_CANT}[^。\\n]{0,16}?(?:参考|输入)${ZH_MEDIA}`, ""),
  // 中文：下载输入图片失败 / 拉取参考图超时
  phrase(`(?:下载|获取|拉取)(?:参考|输入)${ZH_MEDIA}[^。\\n]{0,6}?(?:失败|出错|超时)`, ""),
  // 中文：图片地址无法访问。光说「地址」不算：「接口地址无法访问」说的是连接。音频、素材也不算：「音频地址无法访问」是我们自己的转写报错，「素材链接已失效」是内置浏览器的提示。
  phrase(`(?:图片?|图像|视频|媒体|文件)的?${ZH_LINK}[^。\\n]{0,16}?${ZH_DEAD}`, ""),
];

/** 命中的那一段里出现这些词，说明拿的不是输入：取结果 / 下载产物 / 任务 / 上传 / 回调 / 模型 / 连不上这条连接本身。 */
const NOT_ABOUT_INPUT = /\b(?:results?|outputs?|generated|tasks?|uploads?|uploading|uploaded|webhooks?|callbacks?|base\s*url|api\s*(?:url|endpoint)|endpoints?|servers?|hosts?|proxy|gateway|upstream|models?|weights|pages?|sites?|status)\b|结果|产物|输出|任务|上传|生成的|回调|接口|服务商|服务器|代理|网关/i;
/** 同一句里出现这些词，说明失败的原因是别的：审核、鉴权、配额、大小。下一步是换图、换 Key、等一等，不是换链接。 */
const OTHER_CAUSE = /\b(?:content\s+polic\w*|polic(?:y|ies)|sensitive|safety|moderat\w*|flagged|violat\w*|nsfw|unsafe|inappropriate|real\s+person|forbidden\s+(?:content|due)|legal|api\s*key|unauthori[sz]ed|authenticat\w*|credentials?|401|451|rate\s*limit\w*|quota|too\s+many|insufficient|balance|credits?|too\s+large|exceed\w*|unsupported)\b|审核|敏感|违规|安全|真人|鉴权|密钥|余额|额度|限流/i;
const SENTENCE_END = /(?<=[.\n。!?！？])/;
const LINK_WORD = /\b(?:url|uri|link)s?\b|链接/i;

/** 整段 URL 是别人的字（路径里常有 tasks / results）：判之前换成记号，只留话。URL 末尾的句号逗号不算 URL，留给分句用。 */
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)\]]/gi;
/** 这个判据在主进程和渲染层都同步跑。只看开头这一段：服务商的报错不会更长，几十 KB 的连续字母也不会把界面卡住。 */
const MAX_TEXT_LENGTH = 4000;

export type ReferenceFetchRefusalInput = {
  /** 上游自己给的错误码（`VendorErrorStructured.upstreamCode`）；没有就不给。 */
  upstreamCode?: string;
  /** 失败的那句话：上游原话优先，没有就整句错误。 */
  text?: string;
};

export function isReferenceFetchRefusal(input: ReferenceFetchRefusalInput): boolean {
  if (REFUSAL_UPSTREAM_CODES.has(normalizeCode(input.upstreamCode))) return true;
  const text = String(input.text ?? "").slice(0, MAX_TEXT_LENGTH).replace(URL_IN_TEXT, ` ${URL_MARK}`);
  if (!text.trim()) return false;
  if (CODE_IN_TEXT.test(text)) return true;
  const mentionsLink = LINK_WORD.test(text);
  return text.split(SENTENCE_END).some((sentence) => {
    if (OTHER_CAUSE.test(sentence)) return false;
    return REFUSAL_PHRASES.some(({ pattern, needsLinkWord }) => {
      if (needsLinkWord && !mentionsLink) return false;
      const match = pattern.exec(sentence);
      return match !== null && !NOT_ABOUT_INPUT.test(match[0]);
    });
  });
}
