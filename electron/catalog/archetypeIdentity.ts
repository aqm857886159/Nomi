import { ARCHETYPE_IDENTIFIER_PATTERNS } from "./archetypeIdentifiers.generated";

// 主进程侧的「modelKey → 档案 id」识别。
//
// 为什么在这里也要有：档案住 src/config（渲染层），electron 的 rootDir 隔离 import 不到；但主进程
// 要能认出「这个模型是不是某个内置档案」——中转接入时据此决定有没有可复用的原生报文、启动自愈时同理。
// 身份表由 scripts/gen-archetype-wire-defaults.ts 从档案生成（单一真相源，check:archetype-defaults 防漂移）；
// **匹配规则逐字对齐** electron/shared/modelArchetypes/entry.ts 的 identifierMatchesPattern，改一处必改两处。

/** 与渲染层 normalizeIdentifier 同规则：trim + 去 "models/" 前缀 + 小写。 */
function normalizeIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const noPrefix = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
  return noPrefix.toLowerCase();
}

/** 去掉 models/ 前缀但保留原始大小写；APIMart/KIE 的同名模型靠大小写区分官方 key。 */
function rawIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

/** 取标识末段（去 vendor 前缀，"bytedance/seedance-2" → "seedance-2"）。 */
function lastSegment(identifier: string): string {
  const idx = identifier.lastIndexOf("/");
  return idx >= 0 ? identifier.slice(idx + 1) : identifier;
}

/**
 * 匹配分两档，**精确整串永远优先于末段**（见下方两趟解析）。
 * 只认相等、不认前缀：故 seedance-2 不会误命中 seedance-2-fast。
 */
function matchesExact(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

function matchesCaseExact(identifier: string, pattern: string): boolean {
  const id = rawIdentifier(identifier);
  const pat = rawIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

/** 去掉 vendor 前缀后末段相等（"bytedance/seedance-2" ↔ "seedance-2"）。 */
function matchesLastSegment(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && lastSegment(id) === lastSegment(pat);
}

/** 从 modelKey / modelAlias 认出档案 id；认不出返回 null。与渲染层解析结果一致（都与 vendor 无关）。 */
export function archetypeIdForModel(modelKey?: string | null, modelAlias?: string | null): string | null {
  const identities = [modelKey, modelAlias].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (identities.length === 0) return null;
  // **三趟**：先保留官方 key 的大小写做精确命中，再做大小写不敏感的整串命中，最后才找末段。
  // APIMart 的 `MiniMax-H3` 与 KIE 的 `minimax-h3` 归一后同名，但实际是两条不同线缆；
  // 先看原始 key 才不会让一个供应商的档案抢走另一个供应商的报文契约。
  // 单趟会让结果取决于档案声明顺序——实测 "Tongyi-MAI/Z-Image-Turbo" 明明在 modelscope-image 里列了
  // 完整 key，却因 z-image-turbo 档案排在前面、靠末段先命中而被判成后者（= 中转上认错模型、参数全错）。
  // 同一课 types.ts 的 selectExecutableModel 早修过：精确身份永远赢，不能靠数组序。
  for (const match of [matchesCaseExact, matchesExact, matchesLastSegment]) {
    for (const [archetypeId, patterns] of Object.entries(ARCHETYPE_IDENTIFIER_PATTERNS)) {
      for (const pattern of patterns) {
        if (identities.some((identity) => match(identity, pattern))) return archetypeId;
      }
    }
  }
  return null;
}
