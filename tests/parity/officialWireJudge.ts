/** Test-only official contract judge. It never reads the product's model declarations. */
export type Fact = { source: string; fetchedAt: string; quote: string };
type Condition = { key?: string; equals?: unknown; count?: number; anyPresent?: string[] };
type Meaning = Fact & { roles: string[]; max?: number; cases?: Array<Fact & { when: Condition; roles: string[]; max?: number }> };
export type KeyFact = Fact & {
  shape: string;
  max: number | null;
  min?: number;
  maxPlusN?: number;
  outputCountKeys?: Fact & { keys: string[]; when?: Condition };
  roles?: string[];
  defaultRole?: Fact & { value: string };
  aliases?: Fact & { values: Record<string, string> };
  meaning?: Meaning;
  allowedCounts?: Fact & { values: number[]; cases?: Array<Fact & { when: Condition; values: number[] }> };
  children?: Record<string, KeyFact>;
  requiredFields?: Fact & { fields: Record<string, string> };
  exercised?: boolean;
  countsAsInput?: boolean;
};
export type ModeFact = {
  why?: string;
  noReference?: Fact & { evidenceLevel?: string; interpretation?: string };
  referenceKeys: Record<string, KeyFact>;
  exclusive?: Array<Fact & { a: string[]; b: string[]; enforced?: boolean }>;
  requires?: Array<Fact & { when: string[]; anyOf: string[] }>;
  jointCaps?: Array<Fact & { keys: string[]; max: number }>;
  roleCaps?: Array<Fact & { role: string; max: number }>;
  intent?: Fact & { roles: string[] };
  discriminators?: Array<Fact & { key: string; values: string[] }>;
  oneImage?: Fact & { key: string; meaning: string };
  wireModel?: string;
  maxUnpublished?: boolean;
};
export type ModelFixture = { modelKey: string; fetchedAt: string; modes: Record<string, ModeFact> };
export const ASSERTIONS = ["officialKeys", "oneKeyPerUrl", "exclusivePairs", "roleEnum", "countCap", "shape", "modeMeaning", "dependencies", "samePath"] as const;
export type AssertionName = (typeof ASSERTIONS)[number];
export type Violation = { assertion: AssertionName; reason: Record<string, unknown>; detail: string };

const REF_KEY_RE = /^(image_urls|image_with_roles|first_frame_image|last_frame_image|video_urls|audio_urls?|file_url|link_url|element_list|element_input_urls|input_urls|image|images|mask(_.*)?|reference_.*|ref_.*)$/;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const active = (v: unknown): boolean => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0);
const at = (body: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((v, k) => object(v) ? v[k] : undefined, body);
function matches(body: Record<string, unknown>, c: Condition): boolean {
  const value = c.key ? at(body, c.key) : undefined;
  return (!c.key || (c.count !== undefined ? Array.isArray(value) && value.length === c.count : value === c.equals))
    && (!c.anyPresent || c.anyPresent.some((k) => active(at(body, k))));
}
function fitsShape(value: unknown, shape: string, defaultRole?: string): boolean {
  if (shape === "string") return typeof value === "string";
  if (!Array.isArray(value)) return false;
  if (shape === "string[]") return value.every((v) => typeof v === "string");
  if (shape === "role-array") return value.every((v) => object(v) && typeof v.url === "string" && (typeof v.role === "string" || (v.role === undefined && defaultRole !== undefined)));
  return shape === "object-array" && value.every(object);
}

function urlsOfKey(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map((v) => typeof v === "string" ? v : object(v) ? v.url : undefined).filter((u): u is string => typeof u === "string");
}

export function judgeBody(body: Record<string, unknown>, mode: ModeFact, n: number): Violation[] {
  const out: Violation[] = [];
  const add = (assertion: AssertionName, reason: Record<string, unknown>, detail: string) => out.push({ assertion, reason, detail });
  const present = Object.keys(body).filter((k) => (REF_KEY_RE.test(k) || k in mode.referenceKeys) && body[k] !== undefined);
  const images: Array<{ key: string; url: string; role?: string; input?: boolean }> = [];

  function inspect(key: string, value: unknown, fact: KeyFact | undefined) {
    if (!fact) {
      add("officialKeys", { key }, `发了官方靶子没有的参考键 ${key}`);
      urlsOfKey(value).forEach((url) => images.push({ key, url }));
      return;
    }
    if (!fitsShape(value, fact.shape, fact.defaultRole?.value)) add("shape", { key, expected: fact.shape, actual: Array.isArray(value) ? "array" : typeof value }, `${key} 不符合官方形状 ${fact.shape}`);
    const count = Array.isArray(value) ? value.length : typeof value === "string" ? 1 : 0;
    const interpretation = fact.meaning?.cases?.find((c) => matches(body, c.when)) ?? fact.meaning;
    const max = Math.min(fact.max ?? Infinity, interpretation?.max ?? Infinity);
    if (count > max) add("countCap", { key, count, max }, `${key} 发了 ${count} 个，官方上限 ${max}`);
    if (fact.min !== undefined && count < fact.min) add("countCap", { key, count, min: fact.min }, `${key} 至少 ${fact.min} 个`);
    if (fact.allowedCounts) {
      const counts = fact.allowedCounts.cases?.find((c) => matches(body, c.when))?.values ?? fact.allowedCounts.values;
      if (!counts.includes(count)) add("countCap", { key, count, allowedCounts: counts }, `${key} 张数 ${count} 不在 ${counts.join("/")}`);
    }
    if (fact.maxPlusN !== undefined) {
      const outputKeys = fact.outputCountKeys && (!fact.outputCountKeys.when || matches(body, fact.outputCountKeys.when)) ? fact.outputCountKeys.keys : ["n"];
      const outputs = outputKeys.map((k) => at(body, k)).filter((v): v is number => typeof v === "number");
      const outputCount = Math.max(1, ...outputs);
      if (count + outputCount > fact.maxPlusN) add("countCap", { key, count, outputCount, maxPlusN: fact.maxPlusN }, `${key} ${count} + 输出 ${outputCount} 超过联合上限 ${fact.maxPlusN}`);
    }
    const children = fact.children;
    if (Array.isArray(value) && children) value.forEach((item, i) => {
      if (!object(item)) return;
      for (const [name, shape] of Object.entries(fact.requiredFields?.fields ?? {})) {
        if (!active(item[name]) || !fitsShape(item[name], shape)) add("shape", { key: `${key}[${i}].${name}`, expected: shape }, `必填字段 ${name} 不符合 ${shape}`);
      }
      for (const name of Object.keys(item)) {
        if ((name in children || REF_KEY_RE.test(name)) && active(item[name])) inspect(`${key}[${i}].${name}`, item[name], children[name]);
      }
      for (const [name, child] of Object.entries(children)) {
        if (!active(item[name]) && child.min) add("countCap", { key: `${key}[${i}].${name}`, count: 0, min: child.min }, `缺少必需的 ${name}`);
      }
    });
    if (fact.shape === "object-array") return;
    const raw = Array.isArray(value) ? value : [value];
    const assigned = interpretation?.roles;
    raw.forEach((item, i) => {
      const url = typeof item === "string" ? item : object(item) && typeof item.url === "string" ? item.url : undefined;
      if (!url) return;
      const role = object(item) ? item.role === undefined ? fact.defaultRole?.value : String(item.role) : undefined;
      if (role !== undefined && fact.roles && !fact.roles.includes(role)) add("roleEnum", { key, role, allowed: fact.roles }, `role「${role}」不在官方枚举 ${fact.roles.join("/")}`);
      const canonical = role === undefined ? undefined : fact.aliases?.values[role] ?? role;
      const meaning = assigned?.[assigned.length === 1 ? 0 : i];
      images.push({ key, url, input: fact.countsAsInput !== false, role: meaning === "$role" ? canonical : meaning });
    });
  }
  for (const key of present) inspect(key, body[key], mode.referenceKeys[key]);
  if (mode.wireModel && body.model !== mode.wireModel) add("officialKeys", { key: "model", expected: mode.wireModel, actual: body.model }, `官方页要求 model=${mode.wireModel}`);

  // Count only the supplied input images, so masks/voice samples cannot hide dropped images.
  const placed = new Set(images.filter((i) => i.input !== false).map((i) => i.url));
  const missing = Array.from({ length: n }, (_, i) => `https://assets.example.com/ref/img-${i + 1}.png`).filter((u) => !placed.has(u));
  if (Object.keys(mode.referenceKeys).length && missing.length) add("officialKeys", { key: "inputImages", count: n, missing }, `${n} 张参考图丢了 ${missing.length} 张`);
  const single = mode.oneImage;
  if (single && n === 1 && active(body[single.key])) {
    const hit = images.find((i) => i.key === single.key && i.url.endsWith("/img-1.png"));
    if (hit?.role && hit.role !== single.meaning) add("modeMeaning", { key: hit.key, role: hit.role, expected: [single.meaning] }, "单图语义不符合官方定义");
  }
  const byUrl = new Map<string, string[]>();
  for (const i of images) byUrl.set(i.url, [...(byUrl.get(i.url) ?? []), i.key]);
  for (const [url, keys] of byUrl) if (keys.length > 1) add("oneKeyPerUrl", { url, keys: keys.sort() }, `${url} 重复出现在 ${keys.join(" + ")}`);

  const hits = (selector: string) => selector.startsWith("role:") ? images.some((i) => i.role === selector.slice(5)) : active(at(body, selector));
  for (const pair of mode.exclusive ?? []) {
    if (pair.enforced === false) continue; // Official prose conflicts with its example; preserve evidence without guessing server behavior.
    const a = pair.a.filter(hits), b = pair.b.filter(hits);
    if (a.length && b.length) add("exclusivePairs", { a, b }, `官方互斥的 ${a.join(",")} 与 ${b.join(",")} 同时出现`);
  }
  for (const rule of mode.requires ?? []) {
    if ((rule.when.length === 0 || rule.when.some(hits)) && !rule.anyOf.some(hits)) add("dependencies", { when: rule.when, anyOf: rule.anyOf }, `需要 ${rule.anyOf.join(" / ")}`);
  }
  for (const cap of mode.jointCaps ?? []) {
    const count = cap.keys.reduce((s, k) => s + urlsOfKey(body[k]).length, 0);
    if (count > cap.max) add("countCap", { keys: cap.keys, count, max: cap.max }, `联合 ${count} 个超过 ${cap.max}`);
  }
  for (const cap of mode.roleCaps ?? []) {
    const count = images.filter((i) => i.role === cap.role).length;
    if (count > cap.max) add("countCap", { role: cap.role, count, max: cap.max }, `${cap.role} ${count} 张超过 ${cap.max}`);
  }
  for (const d of mode.discriminators ?? []) if (body[d.key] !== undefined && !d.values.includes(String(body[d.key]))) add("modeMeaning", { key: d.key, actual: body[d.key], allowed: d.values }, `模式判别值不在官方枚举内`);
  for (const i of images) if (i.role && mode.intent && !mode.intent.roles.includes(i.role)) add("modeMeaning", { key: i.key, role: i.role, expected: mode.intent.roles }, `${i.key} 会被当作 ${i.role}，不符合当前模式意图`);
  return out;
}

/** Freeze structured causes (including multiplicity), independently of display prose. */
export function reasonSignatures(violations: Array<{ assertion: string; reason: Record<string, unknown>; detail?: string }>): string[] {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : object(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  return violations.map((v) => JSON.stringify(stable({ assertion: v.assertion, reason: v.reason }))).sort();
}

export type Wire = Record<string, unknown> | string | null | undefined;
export const isRefused = (wire: Wire): boolean => !(object(wire) && "model" in wire);
function refusalFeatures(wire: Wire): Record<string, unknown> {
  const code = object(wire) ? wire.code : "throw";
  const message = object(wire) ? String(wire.message) : String(wire);
  const role = /unsupported reference role: (\w+)/.exec(message)?.[1];
  if (role) return { code, kind: "unsupported_reference_role", role };
  const max = /最多收\s*(\d+)张图片参考/.exec(message)?.[1];
  if (max) return { code, kind: "reference_capacity", max: Number(max) };
  if (/发不出：参考图/.test(message)) return { code, kind: "reference_projection_refusal", media: "image" };
  // Unknown failures must be investigated, never folded into an existing known-red cause.
  throw new Error(`Unclassified official-wire refusal: ${message}`);
}

export function judgePaths(canvas: Wire, run: Wire): Violation[] {
  const refusedC = isRefused(canvas), refusedR = isRefused(run);
  if (refusedC !== refusedR) return [{ assertion: "samePath", reason: { refused: refusedC ? "canvas" : "run", failure: refusalFeatures(refusedC ? canvas : run) }, detail: `${refusedC ? "画布" : "Run"} 拒发，另一条路发出去了` }];
  if (refusedC || JSON.stringify(canvas) === JSON.stringify(run)) return [];
  const c = canvas as Record<string, unknown>, r = run as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(c), ...Object.keys(r)])].filter((k) => JSON.stringify(c[k]) !== JSON.stringify(r[k])).sort();
  return [{ assertion: "samePath", reason: { differences: Object.fromEntries(keys.map((k) => [k, { canvas: c[k] ?? null, run: r[k] ?? null }])) }, detail: `两条路请求体不同：${keys.join(", ")}` }];
}
