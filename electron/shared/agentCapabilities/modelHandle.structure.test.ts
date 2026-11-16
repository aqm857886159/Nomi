// 结构测试：模型的完整名字只在 `modelHandle.ts` 一处生成、一处查表；写下的模型名只在它那里认；发送方式只在方式主人那里挑。
//
// 为什么要它：完整名字以前就有过「两处各拼一份」的苗头（索引印 id、列表印 id + vendor，两边对不上，
// 真模型评测 11-15 那轮 24 次拒收有 13 次是 id 抄对了、家配错了）。任何别的生产文件自己写
// `${modelId}@${vendor}`、或者拿 `@` 去切这串名字，都会让「名字长什么样」重新有两个家——这里当场拦。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const OWNER = path.join("electron", "shared", "agentCapabilities", "modelHandle.ts");
const SCAN = ["electron", "src"];
const SOURCE = /\.(ts|tsx|mts)$/;
const TEST = /\.(test|e2e|spec)\.|\/__tests__\//;

// `${…modelId|modelKey…}@${…vendor|providerId|vendorKey|modelVendor…}`：模型身份两件拼成一串。
const CONCAT = /\$\{[^}]*\b(?:modelId|modelKey)\b[^}]*\}@\$\{[^}]*\b(?:vendor|providerId|vendorKey|modelVendor)\b[^}]*\}|\+\s*["']@["']\s*\+|\.join\(\s*["']@["']\s*\)/;
// 拿 `@` 去切 / 找完整名字（只看同一行里提到 model 的）。
const PARSE = /\b(?:model\w*|handle\w*)\b[^\n]*\.(?:split|lastIndexOf|indexOf)\(\s*["']@["']\s*\)/i;

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) productionFiles(full, out);
    else if (SOURCE.test(name) && !TEST.test(full)) out.push(full);
  }
  return out;
}

function handleViolations(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (relative === OWNER) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (CONCAT.test(line) || PARSE.test(line)) hits.push(`${relative}:${index + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe("模型完整名字只有一个家", () => {
  const files = SCAN.flatMap((dir) => productionFiles(path.join(ROOT, dir)));

  it("扫到的生产文件够多（不然这条断言是空的）", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.endsWith(OWNER))).toBe(true);
  });

  it("modelHandle.ts 之外没有生产代码自己拼或切完整名字", () => {
    expect(handleViolations(files), "改用 modelHandleOf / resolveModelHandle").toEqual([]);
  });

  it("阳性对照：尺子认得出两种违规写法", () => {
    expect(CONCAT.test("const name = `${row.modelId}@${row.vendor}`")).toBe(true);
    expect(CONCAT.test("label: `${model.modelKey}@${model.vendorKey}`")).toBe(true);
    expect(CONCAT.test('const model = a + "@" + b')).toBe(true);
    expect(CONCAT.test('const model = [a, b].join("@")')).toBe(true);
    expect(PARSE.test("const [id, vendor] = modelName.split('@')")).toBe(true);
    expect(CONCAT.test("occurrence: `${run.id}@${run.updatedAt}`")).toBe(false);
  });
});

// ── 名字和方式各一个家 ──
// 为什么：同一句「用 clip-x、首尾帧」，五个入口（内外助手、单镜、多镜、拟镜、改计划）以前各有一份认名字 / 挑方式的写法，
// 一处认大小写一处不认、一处同名取第一家一处拒、一处点名别家还带着默认那家的方式。答案都收进两个主人以后，
// 别处再写一份「把模型 id 折成小写去比」或「在 modes 上按 transportTaskKind 筛出方式」就是第二个家——这里当场拦。
// 行为上换了写法的第二处由五入口对拍（`electron/capabilityCore/modelNameModeParity.test.ts`）拦。
const NAME_OWNER = OWNER;
const MODE_OWNERS = new Set([
  path.join("electron", "shared", "modelArchetypes", "modeForInputs.ts"),
  path.join("electron", "shared", "videoCapabilities", "modeTransport.ts"),
]);
// 模型 id / key / 别名折成小写后拿去比相等（大小写不敏感认名字）。只拦「比相等」：搜索框过滤用的 includes 不是认名字。
const NAME_FOLD = /\b(?:modelId|modelKey|modelAlias)\b(?:\s*\?\?\s*(?:""|''))?\)?\.(?:toLowerCase|toLocaleLowerCase)\(\)\s*[!=]==|[!=]==\s*\(?[\w.?]*\b(?:modelId|modelKey|modelAlias)\b(?:\s*\?\?\s*(?:""|''))?\)?\.(?:toLowerCase|toLocaleLowerCase)\(\)/;
// 在一组方式上按 transportTaskKind 筛 / 找出方式（「按种类桶挑方式」）。
const MODE_BUCKET = /modes?\b[^\n]*\.(?:filter|find|findLast)\([^\n]*\btransportTaskKind\b/i;
// 「供应商可省」地逐家走目录、按写下的 id 找模型——没写供应商时就跨家匹配，等于自己认名字（旧 `identityForNamedModel`
// / `namedModelModes` 的形状）。判据是两行同段出现：一个可省的供应商守卫 `(vendor && x !== vendor)`，
// 紧跟着在 find / filter / some 里按模型 id / key / 别名比相等。按已认出的 (供应商, 模型) 精确取行时供应商守卫不可省，不报。
const OPTIONAL_VENDOR_GUARD = /\(\s*[\w.]*(?:providerId|vendor|vendorKey|ProviderId|Vendor)\w*\s*&&\s*[\w.]+\s*!==\s*[\w.]+\s*\)/;
const ID_LOOKUP = /\.(?:find|filter|some|findIndex|findLast)\([^\n]*\bmodel(?:Id|Key|Alias)\b[^\n]*===/;
const NAME_WALK_WINDOW = 12;

function nameWalkViolations(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (relative === NAME_OWNER) continue;
    hits.push(...nameWalkHits(readFileSync(file, "utf8")).map((hit) => `${relative}:${hit}`));
  }
  return hits;
}

function nameWalkHits(source: string): string[] {
  const lines = source.split("\n");
  const hits: string[] = [];
  lines.forEach((line, index) => {
    if (!OPTIONAL_VENDOR_GUARD.test(line)) return;
    const lookup = lines.slice(index, index + NAME_WALK_WINDOW).findIndex((candidate) => ID_LOOKUP.test(candidate));
    if (lookup >= 0) hits.push(`${index + 1}  ${line.trim()}  …  ${lines[index + lookup]!.trim()}`);
  });
  return hits;
}

/**
 * 已知未收的那一处。名单只减不增（数量断言写死 1）。
 * `modelAdmissionSchema.ts` 的 `archetypeModeForCandidate`：准入层「拿哪张参数表来校验」，认不出返回 null（宁可不判）。
 * 它挑的是校验用的表，不是发送用的方式；而且非视频候选今天没有「这次真实输入」可交给方式主人。
 * 并进 `modeForInputs` 要先让准入拿到输入——那是另一刀，这次不收。
 */
const KNOWN_PENDING: ReadonlyArray<{ file: string; marker: RegExp; why: string }> = [
  {
    file: path.join("electron", "capabilityCore", "modelAdmissionSchema.ts"),
    marker: /const byTask = modes\.filter\(\(mode\) => normalized\(mode\.transportTaskKind/,
    why: "准入挑校验用参数表，非视频候选拿不到真实输入；并入方式主人要另一刀",
  },
];

function lineViolations(files: readonly string[], rule: RegExp, owners: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (owners.has(relative)) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (!rule.test(line)) return;
      if (KNOWN_PENDING.some((item) => item.file === relative && item.marker.test(line))) return;
      hits.push(`${relative}:${index + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe("写下的模型名只在名字主人认，发送方式只在方式主人挑", () => {
  const files = SCAN.flatMap((dir) => productionFiles(path.join(ROOT, dir)));

  it("名字主人之外没有生产代码把模型 id / 别名折成小写去比", () => {
    expect(lineViolations(files, NAME_FOLD, new Set([NAME_OWNER])), "改用 resolveModelHandle / resolveModelIdentity / resolveModelForTask").toEqual([]);
  });

  it("名字主人之外没有生产代码「供应商可省」地逐家按写下的 id 找模型", () => {
    expect(nameWalkViolations(files), "改用 resolveModelIdentity / resolveModelForTask（同名多家按默认或拒，不取遍历到的第一家）").toEqual([]);
  });

  it("阳性 / 阴性对照：认得出旧认名函数的逐家查找，不误报精确取行", () => {
    // 旧 `identityForNamedModel`（2026-11-17 删）原文的两行。
    const legacy = [
      "      if (!candidateProviderId || (providerId && candidateProviderId !== providerId)) continue;",
      "      const models = (provider as { models?: unknown }).models;",
      "      if (!Array.isArray(models)) continue;",
      "      const model = models.find((candidate) => candidate && typeof candidate === \"object\" && text((candidate as { modelId?: unknown }).modelId) === modelId) as { modes?: unknown } | undefined;",
    ].join("\n");
    expect(nameWalkHits(legacy)).toHaveLength(1);
    // 改名、换变量名也一样：守卫可省 + 按 id 找。
    expect(nameWalkHits("if (vendor && row.vendorKey !== vendor) continue;\nconst hit = list.filter((m) => m.modelKey === written);")).toHaveLength(1);
    // 阴性：供应商守卫不可省的精确取行（`modeFromSnapshot` 的形状）。
    expect(nameWalkHits("const provider = providers.find((item) => item.providerId === selected.providerId);\nconst model = models.find((item) => item.modelId === selected.modelId);")).toEqual([]);
    // 阴性：可省守卫附近没有按 id 找模型（画布写入核对两段身份一致）。
    expect(nameWalkHits("if (node.vendor && node.modelVendor && node.vendor !== node.modelVendor) {\n  throw new Error('mismatch');\n}")).toEqual([]);
  });

  it("方式主人之外没有生产代码在 modes 上按 transportTaskKind 挑方式", () => {
    expect(lineViolations(files, MODE_BUCKET, MODE_OWNERS), "改用 modeForInputs（task 收窄）/ statedMode / modesInTask").toEqual([]);
  });

  it("已知未收名单只有一处，而且它还在（收掉了就删这一条）", () => {
    expect(KNOWN_PENDING).toHaveLength(1);
    for (const item of KNOWN_PENDING) {
      const lines = readFileSync(path.join(ROOT, item.file), "utf8").split("\n");
      expect(lines.some((line) => item.marker.test(line) && MODE_BUCKET.test(line)), `${item.file}：${item.why}`).toBe(true);
    }
  });

  it("阳性对照：改名复制的旧写法都认得出", () => {
    // 旧 videoModeForPlan、旧默认解析器挑 modeId、旧画布写路径的「最接近」。
    expect(MODE_BUCKET.test("const byTask = modes.filter((item) => normalizedTaskKind(item.transportTaskKind) === normalizedTaskKind(candidate.mode));")).toBe(true);
    expect(MODE_BUCKET.test("? effectiveVideoModes(video).find((mode) => mode.transportTaskKind === taskKind)?.id")).toBe(true);
    expect(MODE_BUCKET.test("const picked = archetypeModes.find((m) => m.transportTaskKind === kind)")).toBe(true);
    expect(NAME_FOLD.test("const closest = listing.find((entry) => entry.modelKey.toLowerCase() === wanted)")).toBe(true);
    expect(NAME_FOLD.test("rows.filter((row) => row.modelId.toLowerCase() === lower)")).toBe(true);
    expect(NAME_FOLD.test("rows.filter((row) => (row.modelAlias ?? \"\").toLowerCase() === lower)")).toBe(true);
    expect(NAME_FOLD.test("if (wanted === candidate.modelId.toLowerCase()) return candidate")).toBe(true);
  });

  it("阴性对照：按已认出的身份精确取目录行、搜索框过滤、读方式字段，都不报", () => {
    expect(NAME_FOLD.test("models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey)")).toBe(false);
    expect(NAME_FOLD.test("(m) => m.labelZh.toLowerCase().includes(q) || m.modelKey.toLowerCase().includes(q),")).toBe(false);
    expect(MODE_BUCKET.test("transportTaskKind: mode.transportTaskKind,")).toBe(false);
    expect(MODE_BUCKET.test("const allowed = modes.map((item) => item.id)")).toBe(false);
  });
});
