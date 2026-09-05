#!/usr/bin/env node
// 模型身份门岗 —— 「模型的身份唯一键是 (vendor, modelKey)，不是 modelKey」。
//
// 为什么有这道门（三次真实故障，全同一个成因）：
//   1. buildAgentModelEntries 按 modelKey 去重 → 首家胜出 → 用户选 APIMart 却发去
//      code-newcli-com，HTTP 400 全链阻断（2026-09-03 真实付费闭环走查实测）。
//   2. PlanShot 只带 modelKey → 落画布时按 key 反查命中别家。
//   3. modelHealthMemory 按 modelKey 记账 → Kie 连败导致 APIMart 同名模型一起被判病，
//      「换家优先于换模型」这个机制对它本来要解决的多供应商场景完全失效。
// 同一个模型名可以由多家供应商提供（gpt-image-2 来自 apimart 和 kie；nano-banana 来自 3 家），
// 裸 modelKey 当身份 = 不同家的同名模型身份坍缩。
//
// 判据（**类型层**，不是猜语义）：一个对象类型/接口，声明了 `modelKey`（或 `modelAlias`）
// 却没有任何供应商字段（vendor / vendorKey / modelVendor / providerKey / provider），就是可疑。
// 选签名层是因为它可机器判，且上面 3 次里有 2 次正是这么写坏的：
//   · PlanShot —— 对象类型少了 modelVendor 成员
//   · modelHealthMemory —— 函数签名 (modelKey, now?) 少了 vendor 参数
// **抓不住第 1 条那种纯运行时的去重写法**（`seen.has(modelKey)`）——类型层看不见运行时用了哪个键。
// 这条限制写在这里：门岗绿只代表「没有新增裸 modelKey 的签名」，**不代表这一类不会再发生**。
// 运行时那一半靠 availableModels.test.ts / useDedupedModelSelect.test.ts 里的去重回归钉。
//
// 棘轮：现存条目冻结在 baseline，只减不增。新增未登记条目 = 红。
// 用法：node ./scripts/check-model-identity.mjs [--update-baseline]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "model-identity-baseline.json");
// **只扫多供应商并存的那一层**。catalog 种子表 / 认证会话 / 供应商适配器都在「一家一个文件、
// 一家一次会话」的语境里，vendor 由上下文决定，裸 modelKey 在那里是正当的——把它们一起扫进来
// 会得到 108 条基线，其中 95% 是噪音，冻结噪音的门岗没有价值（R20）。
// 三次真实故障**全部**发生在下面这两处：模型选择 / 计划 / 记账这层，多家的模型在这里肩并肩。
const SCAN_DIRS = ["src/workbench", "src/config"];

const MODEL_FIELDS = new Set(["modelKey", "modelAlias"]);
const VENDOR_FIELDS = new Set([
  "vendor", "vendorKey", "modelVendor", "vendorName",
  "providerKey", "provider", "providers",
]);

function listFiles() {
  return execSync(`git ls-files ${SCAN_DIRS.join(" ")}`, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => fs.existsSync(path.join(ROOT, file)));
}

/** 收集一个类型字面量/接口的直接成员名（不下钻嵌套类型——嵌套类型自己会被单独访问到）。 */
function memberNames(members) {
  const names = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
    const name = member.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) names.push(name.text);
  }
  return names;
}

const findings = [];

for (const relative of listFiles()) {
  const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const visit = (node) => {
    // ① 函数/方法签名：参数里有 modelKey 却没有任何供应商参数。modelHealthMemory 就是这么写坏的
    //    ——旧签名 (modelKey, now?)，加一个可选 vendor 还会让旧调用把 now 静默当成 vendor。
    if (
      ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    ) {
      const params = node.parameters
        .map((param) => (ts.isIdentifier(param.name) ? param.name.text : null))
        .filter(Boolean);
      const hasModel = params.some((name) => MODEL_FIELDS.has(name));
      const hasVendor = params.some((name) => VENDOR_FIELDS.has(name));
      if (hasModel && !hasVendor) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const label = `fn(${params.join(",")})`;
        findings.push({ id: `${relative}:${label}`, file: relative, line, label });
      }
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
      const names = memberNames(node.members);
      const hasModel = names.some((name) => MODEL_FIELDS.has(name));
      const hasVendor = names.some((name) => VENDOR_FIELDS.has(name));
      if (hasModel && !hasVendor) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const label = ts.isInterfaceDeclaration(node)
          ? node.name.text
          : names.slice(0, 4).sort().join(",");
        findings.push({ id: `${relative}:${label}`, file: relative, line, label });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

findings.sort((a, b) => a.id.localeCompare(b.id));
const currentIds = findings.map((finding) => finding.id);

if (process.argv.includes("--update-baseline")) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ entries: currentIds }, null, 2)}\n`);
  console.log(`✓ 模型身份基线已更新：${currentIds.length} 条`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`✖ 缺少基线文件 ${path.relative(ROOT, BASELINE_PATH)}；先跑 --update-baseline`);
  process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries);
const added = currentIds.filter((id) => !baseline.has(id));
const removed = [...baseline].filter((id) => !currentIds.includes(id));

console.log(`模型身份：${currentIds.length} 处「带 modelKey 但不带供应商字段」的类型；基线 ${baseline.size} 处（棘轮只减不增）`);

if (removed.length > 0) {
  console.log(`↓ 已清偿 ${removed.length} 处，请跑 --update-baseline 锁定：`);
  for (const id of removed.slice(0, 10)) console.log(`   · ${id}`);
}

if (added.length > 0) {
  console.error(`\n✖ 模型身份回归：${added.length} 处**新增**未登记类型`);
  for (const id of added) {
    const finding = findings.find((item) => item.id === id);
    console.error(`   · ${finding.file}:${finding.line} — ${finding.label}`);
  }
  console.error(`
  模型的身份唯一键是 **(vendor, modelKey)**：同一个模型名可以来自多家供应商，
  只带 modelKey 会让不同家的同名模型身份坍缩——已因此发生过三次真实故障
  （发错供应商 HTTP 400 / 落地反查命中别家 / 健康记账互相牵连）。

  修法：给这个类型补上供应商字段（vendor / vendorKey / modelVendor），让它成对流动。
  真的只在单一供应商作用域里用（上游已按 vendor 过滤）？那就跑 --update-baseline 登记，
  **并在类型旁写一行注释说明它为什么不需要 vendor**——理由会过期，写下来才能被复核。
  绝不允许为了让门岗变绿而随手抬高基线。`);
  process.exit(1);
}

console.log("✅ 模型身份棘轮通过（无新增裸 modelKey 类型；基线只减不增）。");
