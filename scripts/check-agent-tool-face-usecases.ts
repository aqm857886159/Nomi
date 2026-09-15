// 门岗 T10（设计正本 §8.2）：题库里 `firstTool` 覆盖全部内部面动词，题库里出现的动词必须存在。
//
// 「20 个动词」不靠正则扫源码数——从注册表投影 `modelFacingToolSpecs("internal")` 取真实发布的名单，
// 与题库 `canonicalVerbs` 逐个对账。多一个、少一个、名字不同都红；没有任何跳过分支。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { modelFacingToolSpecs } from "../electron/shared/agentCapabilities/modelFacingToolRegistry";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests/system/agent-tool-face-usecases.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  schemaVersion: number;
  canonicalVerbs: string[];
  metrics: string[];
  cases: Array<{ id: string; firstTool: string; tools?: string[]; proof?: string[] }>;
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

if (errors.length > 0) {
  console.error(["Agent tool-face usecase manifest: FAIL", ...errors.map((error) => `- ${error}`)].join("\n"));
  process.exit(1);
}
console.log(`Agent tool-face usecase manifest: PASS · verbs=${published.length} · cases=${manifest.cases.length} · metrics=${manifest.metrics.length}`);
