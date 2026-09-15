// 门岗 T10（设计正本 §8.2）：题库里 `firstTool` 覆盖全部内部面动词，题库里出现的动词必须存在。
//
// 「20 个动词」不靠正则扫源码数——从注册表投影 `modelFacingToolSpecs("internal")` 取真实发布的名单，
// 与题库 `canonicalVerbs` 逐个对账。多一个、少一个、名字不同都红；没有任何跳过分支。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { modelFacingToolSpecs } from "../electron/shared/agentCapabilities/modelFacingToolRegistry";
import { isSkillSelectableInWorkbench, readSkillRecords } from "../electron/skills/skillStore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests/system/agent-tool-face-usecases.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  schemaVersion: number;
  canonicalVerbs: string[];
  metrics: string[];
  banks?: string[];
  cases: Array<{ id: string; firstTool: string; tools?: string[]; proof?: string[]; skillKey?: string }>;
};

const published = modelFacingToolSpecs("internal").map((spec) => spec.name);
const declared = new Set(published);
const expected = new Set(manifest.canonicalVerbs);
const errors: string[] = [];

if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (published.length !== 20) errors.push(`internal profile publishes ${published.length} verbs, the design says 20: ${published.join(", ")}`);
if (new Set(published).size !== published.length) errors.push("internal profile publishes a duplicate name");
for (const verb of expected) if (!declared.has(verb)) errors.push(`manifest verb is not published on the internal profile: ${verb}`);
for (const verb of declared) if (!expected.has(verb)) errors.push(`published verb missing from manifest: ${verb}`);

const caseIds = new Set<string>();
const covered = new Set(manifest.cases.flatMap((entry) => entry.tools ?? [entry.firstTool]));
for (const entry of manifest.cases) {
  if (caseIds.has(entry.id)) errors.push(`duplicate case id: ${entry.id}`);
  caseIds.add(entry.id);
  if (!expected.has(entry.firstTool)) errors.push(`${entry.id}: firstTool is not canonical: ${entry.firstTool}`);
  for (const tool of entry.tools ?? []) if (!expected.has(tool)) errors.push(`${entry.id}: trajectory names an unknown verb: ${tool}`);
  if (!Array.isArray(entry.tools) || entry.tools.length === 0) errors.push(`${entry.id}: tools must list the full semantic trajectory`);
  if (!Array.isArray(entry.proof) || entry.proof.length < 2) errors.push(`${entry.id}: proof must contain trajectory and one result dimension`);
}
for (const verb of expected) if (!covered.has(verb)) errors.push(`canonical verb has no user case: ${verb}`);
if (manifest.cases.length < 20) errors.push(`at least 20 user cases required, got ${manifest.cases.length}`);

// ── 技能面：题库里点名的每一条技能都必须真的装着，而且真的能在 composer 里选中 ──────────
//
// 为什么这条要机器管：2026-09-15 的 22 句题库里有 12 句是「用户在 composer 里点了某条技能」。
// 技能目录改个名、frontmatter 少一行 `selectable-in-workbench`，这 12 句当场失去意义——
// 而它们照样是一份读起来很像话的 JSON，没有任何东西会红（R28：能让门岗拦的别留给人）。
const selectable = new Set(readSkillRecords().filter(isSkillSelectableInWorkbench).map((record) => record.name));
const selectableDirs = new Set(readSkillRecords().filter(isSkillSelectableInWorkbench).map((record) => record.directoryName));
const checkSkillKey = (where: string, skillKey: string) => {
  if (!selectable.has(skillKey) && !selectableDirs.has(skillKey)) {
    errors.push(`${where}: skillKey is not an installed workbench-selectable Skill: ${skillKey}`);
  }
};
for (const entry of manifest.cases) if (entry.skillKey) checkSkillKey(entry.id, entry.skillKey);

// 真实模型腿的题库也登在这里（`NOMI_R30_BANK`），不另开一个门岗：一份题库两个读者，
// 判据只能有一个家。题库文件没了、或它点名的技能没了，都在这里红。
for (const bank of manifest.banks ?? []) {
  const bankPath = path.join(root, bank);
  if (!fs.existsSync(bankPath)) { errors.push(`declared bank is missing: ${bank}`); continue; }
  let cases: Array<{ id?: unknown; skillKey?: unknown }> = [];
  try {
    cases = (JSON.parse(fs.readFileSync(bankPath, "utf8")) as { cases?: unknown }).cases as typeof cases ?? [];
  } catch (error) { errors.push(`declared bank is not valid JSON: ${bank} (${(error as Error).message})`); continue; }
  if (cases.length < 20) errors.push(`${bank}: a real-model bank needs at least 20 user sentences, got ${cases.length}`);
  for (const entry of cases) {
    if (typeof entry.skillKey === "string" && entry.skillKey) checkSkillKey(`${bank}#${String(entry.id)}`, entry.skillKey);
  }
}

if (errors.length > 0) {
  console.error(["Agent tool-face usecase manifest: FAIL", ...errors.map((error) => `- ${error}`)].join("\n"));
  process.exit(1);
}
console.log(`Agent tool-face usecase manifest: PASS · verbs=${published.length} · cases=${manifest.cases.length} · metrics=${manifest.metrics.length}`);
