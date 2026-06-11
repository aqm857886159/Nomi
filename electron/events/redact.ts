// 事件落盘前的递归脱敏(评测方案 S0 安全铁律):
// ① 已知密钥值精确匹配——url/query/body 里任何等于已知 apiKey 的字符串都盖掉
//    (现有 redactHeaders 只盖 headers,盖不住 query 鉴权的 vendor);
// ② 形态兜底——常见 key 形态(sk-/Bearer)与敏感字段名,防"已知密钥清单"漏配。
// 纯函数,深拷贝返回,绝不改入参。

const REDACTED = "«redacted»";
const SECRET_KEY_NAMES = /^(api[-_]?key|authorization|token|secret|password|x-api-key)$/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;

function redactString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  return out.replace(SECRET_VALUE_PATTERN, REDACTED);
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
