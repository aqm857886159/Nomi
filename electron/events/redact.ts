// 事件落盘前的递归脱敏(评测方案 S0 安全铁律):
// ① 已知密钥值精确匹配——url/query/body 里任何等于已知 apiKey 的字符串都盖掉
//    (现有 redactHeaders 只盖 headers,盖不住 query 鉴权的 vendor);
// ② 形态兜底——常见 key 形态(sk-/Bearer)与敏感字段名,防"已知密钥清单"漏配。
// 纯函数,深拷贝返回,绝不改入参。

const REDACTED = "«redacted»";
const SECRET_KEY_NAMES = /^(api[-_]?key|authorization|token|secret|password|x-api-key)$/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;
// query 鉴权参数白名单:?key=… / &token=… 的值整体脱敏(URL 编码也盖),修「按已知值的黑名单
// 盖不住 query 形态密钥」——尤其值经 %2B 等编码后精确匹配失败。匹配到查询位([?&])才动,
// 保留非鉴权参数(model= 等)。值取到下一个 & 或字符串结束。
const SECRET_QUERY_PARAM_PATTERN =
  /([?&](?:api[-_]?key|access[-_]?token|token|secret|password|sig|signature|key)=)[^&\s"']+/gi;

function redactString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  return out.replace(SECRET_QUERY_PARAM_PATTERN, `$1${REDACTED}`).replace(SECRET_VALUE_PATTERN, REDACTED);
}

export function redactDeep<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === "string") {
    return redactString(value, secrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, secrets)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_NAMES.test(key) && typeof item === "string" && item.length > 0) {
        out[key] = REDACTED;
      } else {
        out[key] = redactDeep(item, secrets);
      }
    }
    return out as unknown as T;
  }
  return value;
}
