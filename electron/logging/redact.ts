// 日志脱敏 —— **第二道网**。
//
// 第一道网是 `logger.ts` 的 API 形状：提示词、密钥、素材路径压根没有能通过的参数位
// （R28：防线建在最早能拦住的那层）。但「没有参数位」拦不住有人把它们拼进 `event` 串、
// 或塞进一个名字无害的字段里，所以每一个进日志的字符串都还要过这里。
//
// 两层判据：
//   ① **字段名**黑名单 —— 名字就说明了里面装的是什么（prompt / apiKey / path / url…），
//      整段替换成 `<omitted:字段名>`。日志里保留字段名本身是有意的：排查时"这里有个被略掉的
//      提示词"和"这里什么都没有"是两件事。
//   ② **值形状** —— 绝对路径、URL 的 path/query（签名 URL 的凭据全在 query 里）、
//      密钥形串、data: URI、超长值。
//
// 刻意不做的事：**不试图用正则识别"这是不是一段提示词"**。提示词没有可匹配的特征，
// 靠内容检测去拦它只会给出一种「已经防住了」的错觉。真正防住它的是 ①，以及值长度上限。
const MAX_VALUE_CHARS = 200;
const MAX_LINE_CHARS = 2000;

/**
 * 字段名归一：去掉分隔符、转小写。`api_key` / `apiKey` / `API-KEY` 是同一个东西，
 * 黑名单不该被写法绕过。
 */
function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** 整名命中就整段略掉。这些字段名意味着里面装的是创作内容、凭据或本机路径。 */
const DENIED_FIELD_NAMES = new Set([
  "prompt", "prompts", "systemprompt", "negativeprompt", "userinput", "input", "output",
  "text", "content", "body", "payload", "caption", "description", "title", "name", "label",
  "key", "apikey", "token", "secret", "password", "auth", "authorization", "cookie", "credential",
  "path", "filepath", "file", "filename", "dir", "directory", "url", "uri", "src", "href",
  "asset", "assetpath", "asseturl", "projectname", "projectpath",
]);

/** 名字里含这些词根的一律略掉（`vendorApiKey` / `xUserPrompt` / `refreshToken` 这类拼法）。 */
const DENIED_FIELD_STEMS = [
  "prompt", "apikey", "accesskey", "secretkey", "password", "token", "secret",
  "credential", "authorization", "cookie", "passphrase",
];

export function isDeniedFieldName(key: string): boolean {
  const normalized = normalizeKey(key);
  if (DENIED_FIELD_NAMES.has(normalized)) return true;
  return DENIED_FIELD_STEMS.some((stem) => normalized.includes(stem));
}

/**
 * 值级脱敏。顺序有意义：先认整体形状（data: URI / URL），再认路径，最后认密钥形串——
 * 反过来做的话，`https://host/a/b` 会先被当成路径吃掉一半，剩下的 host 也就没了。
 */
export function redactLogValue(input: string): string {
  let value = input;

  // data: / blob: —— 整条就是内容本身，一个字都不留。
  value = value.replace(/\b(?:data|blob):[^\s"']+/gi, "<blob>");

  // http(s) —— 留 scheme+host（"打的是哪家"是排查必需），砍掉 path 与 query。
  // 签名素材 URL 的凭据全在 query 里，而 path 里常常带项目/素材名。
  value = value.replace(
    /\b(https?):\/\/([^\s/"']+)(\/[^\s"']*)?/gi,
    (_match, scheme: string, host: string, rest: string | undefined) =>
      rest ? `${scheme}://${host}/<path>` : `${scheme}://${host}`,
  );

  // 本机路径的三种写法：file:// / nomi-local:// / 裸绝对路径 / Windows 盘符路径。
  value = value.replace(/\bfile:\/\/[^\s"']+/gi, "<path>");
  value = value.replace(/\bnomi-local:\/\/[^\s"']+/gi, "<path>");
  value = value.replace(/[A-Za-z]:\\[^\s"'()]+/g, "<path>");
  // 裸绝对路径：至少两段（`/a/b`），且前面不是别的路径分隔或冒号，避免把
  // 已经处理过的 `<path>` 或 `2026/09/06` 这类东西再切一刀。
  value = value.replace(/(^|[\s"'(=[])(\/[^\s"'):\]]*\/[^\s"'):\]]*)/g, (_match, lead: string) => `${lead}<path>`);

  // 密钥形串：常见前缀 + Bearer + 够长的连续无分隔串（base64/hex 形）。
  value = value.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "<redacted>");
  value = value.replace(/\b(?:sk|pk|rk|api|key|ghp|gho|xox[abps])[-_][A-Za-z0-9._-]{8,}/gi, "<redacted>");
  value = value.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, "<redacted>");
  value = value.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "<redacted>");

  // 控制字符会把一行日志撑成好几行，破坏「一行一条」这件事。
  value = value.replace(/\p{Cc}/gu, " ").trim();

  if (value.length > MAX_VALUE_CHARS) {
    return `${value.slice(0, MAX_VALUE_CHARS)}…(+${value.length - MAX_VALUE_CHARS})`;
  }
  return value;
}

/** 一个字段的最终形态：先看名字，再看值。 */
export function redactField(key: string, value: unknown): string {
  if (isDeniedFieldName(key)) return `<omitted:${normalizeKey(key)}>`;
  if (value === null || value === undefined) return "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return redactLogValue(String(value));
}

/**
 * 错误对象 → 一行可读文本。栈里**全是**绝对路径（`/Applications/Nomi.app/Contents/…`），
 * 逐帧脱敏后才进日志：帧里真正有价值的是文件名与行号，不是它装在谁的硬盘哪个目录下。
 */
export function redactError(error: unknown): string {
  if (!(error instanceof Error)) return redactLogValue(String(error));
  const head = `${error.name}: ${error.message}`;
  const code = (error as NodeJS.ErrnoException).code;
  const frames = (error.stack || "")
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 8)
    // 帧里只留「函数名 (文件名:行:列)」——目录部分是本机路径，不进日志。
    .map((line) => line.replace(/\(?([^\s()]*[/\\])([^\s()/\\]+:\d+:\d+)\)?/g, "($2)"));
  const parts = [redactLogValue(head)];
  if (code) parts.push(`code=${redactLogValue(String(code))}`);
  if (frames.length) parts.push(`| ${frames.map((frame) => redactLogValue(frame)).join(" < ")}`);
  return parts.join(" ");
}

/** 一整行的兜底上限——单值上限之外再兜一次，免得字段多到把文件撑爆。 */
export function capLogLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}
