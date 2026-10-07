// 官网数据导出：只读 App 里各概念的唯一 owner，写出 marketing/data/site-data.json（不含任何价格）。
//
// 为什么要一份导出：官网生成器是 node .mjs，碰不到 App 的 TS 源；更重要的是官网不许自己再养一份
// 「有哪些模型 / 技能 / 提示词」——模型身份取 App 模型下拉的同一套去重（dedupeModelOptions），
// 能力取模型档案，技能取 App 的技能加载器，公开合集取 promptSources。官网只读这份 JSON。
// 方案：docs/plan/2026-09-28-site-libraries-seo.md §6。
//
// 用法：tsx scripts/site/export-site-data.mts          写出 JSON 与派生图片
//       tsx scripts/site/export-site-data.mts --check  只核对（JSON 逐字相同、派生图片与源文件哈希对得上）
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { discoverSkillRecords } from "../../electron/agentLane/laneSkillCatalog.mts";
import { applyBuiltinSeeds } from "../../electron/catalog/seedBuiltins.ts";
import type { CatalogState } from "../../electron/catalog/types.ts";
import { PROMPT_SOURCES } from "../../electron/promptLibrary/promptSources.ts";
import { MODEL_ARCHETYPES } from "../../electron/shared/modelArchetypes/index.ts";
import { dedupeModelOptions, modelCatalogLifecycle } from "../../src/config/modelIdentity.ts";
import { toCatalogModelOptions } from "../../src/config/modelOptionMappers.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_JSON = path.join(root, "marketing/data/site-data.json");
const MEDIA_DIR = path.join(root, "marketing/assets/library");
const MEDIA_URL = "/assets/library";
/** 卡片与详情两种宽度。源图 1–4MB，官网只用派生图。 */
const MEDIA_WIDTHS = [640, 1280] as const;
const checkOnly = process.argv.includes("--check");

type Localized = { "zh-CN": string; en: string };

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);

// ---------- 模型 ----------

type SlotKind = string;
type ModelFacts = {
  intents: string[];
  modeTerms: string[];
  references: Record<SlotKind, number | null>;
  resolutions: string[];
  aspectRatios: string[];
  durationSeconds: { min?: number; max?: number; options?: string[] } | null;
  audio: boolean;
  variants: string[];
};

const archetypeById = new Map(MODEL_ARCHETYPES.map((archetype) => [archetype.id, archetype]));

function pushUnique(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

/** 一个模型在所有供应商那里的档案取并集：「至少有一家能做到」就算 Nomi 能做到。 */
function factsFor(archetypeIds: readonly string[]): ModelFacts {
  const facts: ModelFacts = { intents: [], modeTerms: [], references: {}, resolutions: [], aspectRatios: [], durationSeconds: null, audio: false, variants: [] };
  for (const id of archetypeIds) {
    const archetype = archetypeById.get(id);
    if (!archetype) continue;
    for (const variant of archetype.variants ?? []) pushUnique(facts.variants, variant.label);
    for (const mode of archetype.modes) {
      pushUnique(facts.intents, mode.intent);
      if (typeof mode.vendorTerm === "string") pushUnique(facts.modeTerms, mode.vendorTerm);
      for (const slot of mode.slots ?? []) {
        const previous = facts.references[slot.kind];
        const max = typeof slot.max === "number" ? slot.max : null;
        facts.references[slot.kind] = previous === undefined ? max : previous === null || max === null ? (previous ?? max) : Math.max(previous, max);
      }
      for (const param of mode.params ?? []) {
        const options = (param.options ?? []).map((option) => String(option.value));
        if (param.key === "resolution") options.forEach((value) => pushUnique(facts.resolutions, value));
        if (param.key === "aspect_ratio") options.forEach((value) => pushUnique(facts.aspectRatios, value));
        if (param.key === "generate_audio") facts.audio = true;
        if (param.key === "duration") {
          const current = facts.durationSeconds ?? {};
          if (typeof param.min === "number") current.min = current.min === undefined ? param.min : Math.min(current.min, param.min);
          if (typeof param.max === "number") current.max = current.max === undefined ? param.max : Math.max(current.max, param.max);
          if (options.length) current.options = [...new Set([...(current.options ?? []), ...options])];
          facts.durationSeconds = current;
        }
      }
    }
  }
  return facts;
}

function exportModels() {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const state = applyBuiltinSeeds(empty, "2026-01-01T00:00:00.000Z").state;
  const vendorByKey = new Map(state.vendors.map((vendor) => [vendor.key, vendor]));
  const rows = state.models.filter((model) => model.kind === "video" || model.kind === "image");
  // App 模型下拉的同一条路：目录行 → 选项 → 按 canonical 身份合并。
  const deduped = dedupeModelOptions(toCatalogModelOptions(rows as never));
  const slugs = new Map<string, string>();
  return deduped.map((model) => {
    const archetypeIds = [...new Set(model.providers
      .map((provider) => (provider.option.meta as { archetypeId?: unknown } | undefined)?.archetypeId)
      .filter((id): id is string => typeof id === "string" && id.length > 0))];
    const asciiId = /^[\x20-\x7e]+$/.test(model.canonicalId) ? model.canonicalId : "";
    let slug = slugify(asciiId || archetypeIds[0] || model.canonicalId);
    // 同一个 slug 被两条 canonical 身份抢：说明 App 那边没认出它们是同一个模型（§12 第 5 题）。
    // 不在官网这层偷偷合并（那是第二个身份 owner），只把冲突标出来。
    const identityGap = slugs.has(slug) ? slugs.get(slug)! : null;
    if (identityGap) slug = `${slug}-${slugify(model.providers[0].vendor ?? "other")}`;
    slugs.set(slug, model.canonicalId);
    const vendors = [...new Map(model.providers.map((provider) => {
      const vendor = vendorByKey.get(provider.vendor ?? "");
      return [provider.vendor ?? "", { key: provider.vendor ?? "", name: vendor?.name ?? provider.vendor ?? "", authType: vendor?.authType ?? "unknown" }];
    })).values()];
    return {
      slug,
      canonicalId: model.canonicalId,
      label: model.label,
      kind: model.providers[0].option.kind,
      lifecycle: modelCatalogLifecycle(model),
      recognized: model.recognized,
      archetypeIds,
      family: archetypeById.get(archetypeIds[0] ?? "")?.family ?? null,
      identityGapWith: identityGap,
      vendors,
      facts: factsFor(archetypeIds),
    };
  });
}

// ---------- 技能与效果 ----------

type MediaEntry = { source: string; sourceHash: string; files: Record<string, string> };

function deriveMedia(sourceFile: string, name: string, manifest: MediaEntry[], widths: readonly number[] = MEDIA_WIDTHS) {
  const sourceHash = sha256(sourceFile);
  const files: Record<string, string> = {};
  for (const width of widths) {
    const fileName = `${name}-${width}.webp`;
    const target = path.join(MEDIA_DIR, fileName);
    files[width] = `${MEDIA_URL}/${fileName}`;
    if (checkOnly) continue;
    const prior = previousMedia.get(path.relative(root, sourceFile).replaceAll("\\", "/"));
    if (prior && prior.sourceHash === sourceHash && fs.existsSync(target)) continue;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    execFileSync(ffmpegInstaller.path, ["-y", "-loglevel", "error", "-i", sourceFile, "-vf", `scale='min(${width},iw)':-2`, "-c:v", "libwebp", "-quality", "80", target]);
  }
  manifest.push({ source: path.relative(root, sourceFile).replaceAll("\\", "/"), sourceHash, files });
  return files;
}

let previousMedia = new Map<string, MediaEntry>();

async function exportLibrary(media: MediaEntry[]) {
  const { records, diagnostics } = await discoverSkillRecords([{ path: path.join(root, "skills"), origin: "builtin" }]);
  const errors = diagnostics.filter((diagnostic) => diagnostic.type === "error");
  if (errors.length) throw new Error(`技能目录有错误：\n${errors.map((error) => `- ${error.path}: ${error.message}`).join("\n")}`);
  return records
    // 绑在构建开关上的技能开关关时用户用不了，官网不能先宣传（开关随 2026-11-15 删除时一起放开）。
    .filter((record) => record.curation && !record.manifestError && !record.manifest?.requiresFlag)
    .sort((left, right) => left.directoryName.localeCompare(right.directoryName))
    .map((record) => {
      const curation = record.curation!;
      const licenseFile = ["LICENSE.txt", "LICENSE", "LICENSE.md"].map((name) => path.join(record.packageDir, name)).find((file) => fs.existsSync(file));
      const previewFile = curation.preview ? path.join(record.packageDir, curation.preview.path) : null;
      const preview = previewFile && fs.existsSync(previewFile) && curation.preview!.type === "image"
        ? { ...deriveMedia(previewFile, record.directoryName, media), provenance: curation.preview!.provenance, sourceUrl: curation.preview!.sourceUrl ?? null }
        : null;
      return {
        name: record.directoryName,
        kind: curation.kind,
        group: curation.group as Localized,
        groupId: slugify(curation.group.en),
        title: curation.title as Localized,
        summary: curation.summary as Localized,
        appliesTo: curation.appliesTo,
        slots: curation.slots,
        license: curation.license,
        licenseText: licenseFile ? fs.readFileSync(licenseFile, "utf8").trim() : null,
        source: { url: curation.source.url, author: curation.source.author, revision: curation.source.revision, changes: curation.source.changes },
        preview,
        repositoryPath: `skills/${record.directoryName}`,
        /** 声明了 Nomi 工具的技能只能在 Nomi 里跑（官网「在其他助手里用」要照实说）。 */
        nomiTools: record.manifest?.tools ?? [],
        body: record.content.trim(),
      };
    });
}

// ---------- 公开合集与表情预设 ----------

function exportCollections() {
  const seed = JSON.parse(fs.readFileSync(path.join(root, "electron/promptLibrary/promptLibrarySeed.json"), "utf8")) as Array<{ title: string; prompt: string; sourceId: string }>;
  return PROMPT_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    sourceUrl: source.sourceUrl,
    promptType: source.promptType,
    license: source.license,
    // 只放 App 离线内置的那一部分（在线拉取的数量随上游变，不写死在网页上）。
    prompts: seed.filter((item) => item.sourceId === source.id).map((item) => ({ title: item.title.trim(), prompt: item.prompt.trim() })),
  }));
}

function exportExpressions(media: MediaEntry[]) {
  const pack = JSON.parse(fs.readFileSync(path.join(root, "electron/promptLibrary/builtinExpressionPack.json"), "utf8")) as Array<{ id: string; title: string; prompt: string; mediaUrl: string }>;
  return pack.map((item) => {
    const sourceFile = path.join(root, "public", item.mediaUrl);
    return {
      id: item.id,
      title: item.title,
      prompt: item.prompt,
      media: fs.existsSync(sourceFile) ? deriveMedia(sourceFile, `expression-${item.id}`, media, [640]) : null,
    };
  });
}

// ---------- 写出 / 核对 ----------

async function main() {
  const mediaManifestFile = path.join(root, "marketing/data/site-media.json");
  if (fs.existsSync(mediaManifestFile)) {
    const prior = JSON.parse(fs.readFileSync(mediaManifestFile, "utf8")) as MediaEntry[];
    previousMedia = new Map(prior.map((entry) => [entry.source, entry]));
  }
  const media: MediaEntry[] = [];
  const data = {
    schemaVersion: 1,
    models: exportModels(),
    library: await exportLibrary(media),
    collections: exportCollections(),
    expressions: exportExpressions(media),
  };
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const mediaJson = `${JSON.stringify(media, null, 2)}\n`;
  if (checkOnly) {
    const stale: string[] = [];
    if (!fs.existsSync(OUT_JSON) || fs.readFileSync(OUT_JSON, "utf8") !== json) stale.push(path.relative(root, OUT_JSON));
    if (!fs.existsSync(mediaManifestFile) || fs.readFileSync(mediaManifestFile, "utf8") !== mediaJson) stale.push(path.relative(root, mediaManifestFile));
    for (const entry of media) for (const url of Object.values(entry.files)) {
      if (!fs.existsSync(path.join(root, "marketing", url))) stale.push(`marketing${url}`);
    }
    if (stale.length) {
      console.error(`官网数据过期，跑 pnpm run build:site 重新导出：\n${stale.map((item) => `- ${item}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.log("SITE DATA CHECK PASS");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, json);
  fs.writeFileSync(mediaManifestFile, mediaJson);
  console.log(`wrote ${path.relative(root, OUT_JSON)}: ${data.models.length} models, ${data.library.length} library items, ${data.collections.length} collections, ${data.expressions.length} expressions, ${media.length} media`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
