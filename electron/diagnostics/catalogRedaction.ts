// 模型目录进诊断包前的脱敏。
//
// 目录（`model-catalog.json`）是排查「模型调不通」时最有用的一份东西：接了哪几家、
// 每家的 base URL、每个模型的报文映射、健康度。但同一个文件里也躺着**全部凭据**：
// `apiKeysByVendor` 的 apiKey、customConfig（AK/SK 这类第二密钥）、networkConfig
// （代理 URL 可能带 `user:pass@`、自定义 header 可能是 Authorization）。
//
// 所以这里做的是「留结构、抹凭据」，两层：
//   ① **按已知形状**精确处理凭据记录——这是主力，因为我们自己知道密钥住在哪几个字段
//      （`electron/catalog/secrets.ts` 的 ApiKeyRecord 就是那张图）；
//   ② **按字段名/值形态**再深扫一遍——目录格式会演进，新长出来的密钥字段不该等到
//      泄漏之后才被发现。
//
// 与 `electron/events/redact.ts` 的分工：那份是**事件负载**的深度脱敏（拿已知密钥值精确匹配，
// 服务评测落盘）；这份处理的是**目录文件**的已知结构。两者的输入形状和判据都不同，不是同一件事。
const REDACTED = "<redacted>";

/**
 * 密钥字段名判据用**词根包含**而不是整名匹配：目录格式会长出 `someNewToken` /
 * `vendorApiKey` 这类拼法，整名白名单式的正则会正好放过它们——而那就是"等泄漏了才补规则"。
 */
const SECRET_NAME_STEMS = [
  "apikey", "accesskey", "secretkey", "authorization", "token", "secret",
  "password", "passphrase", "credential", "cookie", "proxyurl",
];
const SECRET_VALUE_SHAPE = /^(?:sk|pk|rk|ghp|gho)[-_][A-Za-z0-9._-]{8,}$|^Bearer\s|^[A-Za-z0-9+/]{40,}={0,2}$/;

function isSecretFieldName(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SECRET_NAME_STEMS.some((stem) => normalized.includes(stem));
}

/** 剥掉 URL 里内嵌的 `user:pass@`——base URL 本身要留（排查必需），凭据不能留。 */
export function stripUrlCredentials(value: string): string {
  return value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1");
}

function redactValue(value: string): string {
  if (!value) return value;
  if (SECRET_VALUE_SHAPE.test(value)) return REDACTED;
  return stripUrlCredentials(value);
}

/** 深扫兜底：字段名像密钥的整段抹掉，值形态像密钥的整段抹掉，URL 里的内嵌凭据剥掉。 */
function sweep(node: unknown): unknown {
  if (typeof node === "string") return redactValue(node);
  if (Array.isArray(node)) return node.map(sweep);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = isSecretFieldName(key) ? REDACTED : sweep(value);
    }
    return out;
  }
  return node;
}

/**
 * 按已知形状处理凭据记录：**保留**「配过没有 / 是哪种编码 / 什么时候配的 / 启用没有」，
 * 只把材料本身换掉。这几件事正是排查 401/解密失败时要看的，抹掉它们等于把包变哑。
 */
function redactCredentialRecord(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return sweep(record);
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  if (typeof source.apiKey === "string" && source.apiKey) out.apiKey = REDACTED;
  if (source.customConfig && typeof source.customConfig === "object") {
    out.customConfig = Object.fromEntries(
      Object.keys(source.customConfig as Record<string, unknown>).map((name) => [name, REDACTED]),
    );
  }
  if (source.networkConfig && typeof source.networkConfig === "object") {
    const network = source.networkConfig as Record<string, unknown>;
    const nextNetwork: Record<string, unknown> = {};
    if (network.proxyUrl !== undefined) nextNetwork.proxyUrl = REDACTED;
    if (network.extraHeaders && typeof network.extraHeaders === "object") {
      nextNetwork.extraHeaders = Object.fromEntries(
        Object.keys(network.extraHeaders as Record<string, unknown>).map((name) => [name, REDACTED]),
      );
    }
    out.networkConfig = nextNetwork;
  }
  return sweep(out);
}

export function redactModelCatalog(catalog: unknown): unknown {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return sweep(catalog);
  const source = catalog as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "apiKeysByVendor" && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([vendorKey, record]) => [
          vendorKey,
          redactCredentialRecord(record),
        ]),
      );
      continue;
    }
    out[key] = sweep(value);
  }
  return out;
}
