#!/usr/bin/env node
// ============================================================================
// 安全门岗：防「明文 API key / 微信聊天记录 / db_key / 私有渠道配置」进 git（会 push 到公开 GitHub）。
//
// 为什么：反馈雷达持续产生微信群消息(raw.json/digest)、取钥产生 db_key(welive.yaml)，
//   都是高敏感隐私。gitignore 只是被动兜底——`git add -f` 能绕过，且**内容级泄露**（把群消息或
//   db_key 粘进某个 .md/.ts）它根本挡不住。本扫描器是主动门岗(shift-left)，被 3 处共用：
//     ① git pre-commit hook（scripts/git-hooks/pre-commit）→ 扫 staged，挡提交那一刻
//     ② pnpm run gates 的 check:secrets → 扫全仓 tracked，push 前兜底
//     ③ Claude PreToolUse hook（pre-push-check.sh）→ 挡 AI/定时 agent 手滑
//   对标 gitleaks/git-secrets 的 defense-in-depth，但轻量自包含、只认 Nomi 的敏感物、零依赖。
//
// 用法：
//   node scripts/check-no-secrets.mjs            扫 git staged（pre-commit 用）
//   node scripts/check-no-secrets.mjs --all      扫全部 tracked（gates / baseline 审计）
//   node scripts/check-no-secrets.mjs <file...>  扫指定文件
// 命中 → 打印详情 + exit 1（拦住）。干净 → exit 0。
// ============================================================================
import { execFileSync } from "node:child_process";
import { gitPaths } from "./lib/gitPaths.mjs";
import fs from "node:fs";

// ── 路径黑名单：这些文件本身绝不该进 git ──
const FORBIDDEN_PATHS = [
  { re: /docs\/feedback\/.*-raw\.json$/, why: "微信/评论原始抓取数据" },
  { re: /docs\/feedback\/.*-digest\.md$/, why: "分诊日报（含用户原话/昵称）" },
  { re: /docs\/feedback\/sources\.json$/, why: "私有渠道配置（群名等）" },
  { re: /docs\/feedback\/state\.json$/, why: "去重状态" },
  { re: /(^|\/)welive\.ya?ml$/, why: "WeLive 配置（含 db_key）" },
  { re: /\.db$/, why: "数据库文件（可能是微信库）" },
  { re: /(^|\/)(all_)?keys?\.json$/, why: "取钥输出（含明文 db_key）" },
  { re: /wechat[-_]?export/i, why: "微信导出目录" },
];

// ── 白名单：放行（代码/文档/模板，含正则模式或占位示例，非真数据）──
const ALLOWLIST = [
  /docs\/feedback\/sources\.example\.json$/,
  /docs\/feedback\/README/i,
  /scripts\/check-no-secrets\.mjs$/, // 本扫描器（含正则定义）
  /scripts\/lib\/feedback\/dump_wechat_key\.py$/, // 取钥脚本（含正则模式，非真 hex）
  /scripts\/welive-setup-mac\.sh$/, // setup 脚本（含路径模式）
  /docs\/plan\/.*(feedback|radar).*\.md$/i, // 方案文档（讲取钥，含占位示例）
  /docs\/.*(security|安全).*\.md$/i, // 本安全系统文档
  /\.gitignore$/,
];

// ── 内容正则：防内容级泄露（路径没命中，但正文里粘了敏感物）──
// 注意：这些正则匹配的是「真实 hex/标识」，代码里的 `[0-9a-fA-F]{96}` 这类元字符不会命中。
const SECRET_PATTERNS = [
  { name: "微信 db_key（内存格式 x'...'）", re: /x'[0-9a-fA-F]{96}'/ },
  { name: "db_key 字段赋值", re: /\b(db_?key|dbkey|session_key)\b\s*[:=]\s*['"]?[0-9a-fA-F]{60,}/i },
  { name: "wxid 个人标识", re: /\bwxid_[a-z0-9]{8,}\b/ },
  { name: "微信群 id", re: /\b\d{6,}@chatroom\b/ },
  { name: "微信数据目录路径", re: /xwechat_files[/\\][^/\\]+[/\\]db_storage/ },
];

// ============================================================================
// 凭证检测：明文 API key / token。**绕过路径白名单**（见 scan()）。
//
// 为什么单独一组、且不受 ALLOWLIST 管：
//   2026-08-25 复盘——一个真实可用的 kie.ai key 从 2026-05-28 起明文躺在
//   docs/onboarding-trials/fixtures/SECURITY-AUDIT.md:5（本仓库是 PUBLIC 的），门岗两处漏：
//     ① SECRET_PATTERNS 里根本没有 API key 模式（只认微信物）；
//     ② 就算加了也没用——ALLOWLIST 的 /docs\/.*(security|安全).*\.md$/i 恰好把那份文件整份放行，
//        而 scan() 里 `if (isAllowed(f)) continue` 是**整体跳过**，路径白名单顺带赦免了内容扫描。
//   白名单本意只是「这份文档本来就要讲微信取钥、含占位示例」，不该连凭证一起赦免。
//   所以：路径黑名单 + SECRET_PATTERNS 仍受白名单管，凭证规则对**所有文件**生效。
//   真要豁免只能用行级标记（INLINE_ALLOW），标记是逐行的、写在现场的、可 grep 审计的。
// ============================================================================

/**
 * Shannon 熵（bit/字符）。用来把「随机凭证」和「结构化数据」分开：
 * 真随机 hex 上限 4.0（实测本仓库真凭证/UUID 都在 3.4-3.9），
 * 而 magic bytes / padding 这类结构化 hex 显著更低（实测 MP4 头 = 2.476，一半字符是 0）。
 */
function shannonEntropy(s) {
  const freq = new Map();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * 供应商前缀凭证：形状本身就唯一，命中即报，不需要熵或上下文佐证。
 * 覆盖 Nomi 实际会碰到的几家 + 通用云厂商。
 */
const VENDOR_KEY_RULES = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: "OpenAI 兼容 API key（sk-）", re: /\bsk-(?!ant-)[A-Za-z0-9]{24,}\b/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { name: "GitHub 细粒度 PAT", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { name: "AWS Access Key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", re: /\bxox[abporsu]-[A-Za-z0-9-]{20,}/g },
  { name: "Replicate API token", re: /\br8_[A-Za-z0-9]{37,}\b/g },
  { name: "HuggingFace token", re: /\bhf_[A-Za-z0-9]{34,}\b/g },
];
/** 前缀对但整串低熵 = 文档占位示例（`sk-aaaaaaaa…`），不是真 key。真凭证实测远高于此。 */
const VENDOR_MIN_ENTROPY = 2.5;

/**
 * 裸 32 位 hex —— kie.ai / 火山 / 多数国内厂商 API key 的形状（也是那次真泄露的形状）。
 *
 * 这条最难做，因为泄露那行**一个上下文词都没有**（`Target: kie.ai (\`<hex>\`)`），
 * 所以不能靠「附近有 key/token/secret」来收窄——只能靠形状 + 熵。两道结构判据（实测全仓验证）：
 *
 *   ① 不「粘连」：前后紧邻 [A-Za-z0-9_\-./] 说明它是更大标识符的一段，不是独立凭证。
 *      滤掉：ComfyUI 哈希文件名 `<hex>_<hex>.png`、sketchfab 模型 ID（URL 尾部）、无横线 UUID（URL 段）。
 *   ② 熵 ≥ 3.0：滤掉 magic bytes 这类结构化 hex（MP4 头 H=2.476）。真凭证实测 H≥3.44。
 *      3.0 落在实测的 2.476 ↔ 3.441 大空档正中，两边都留足余量。
 *
 * 只认**恰好 32 位**：40 位 = git SHA-1、64 位 = SHA-256，在任何 git 仓库里都海量合法出现
 * （本仓库实测 60+ 处：commit ref、产物校验和、skills-lock）。那两个长度改由 KEYWORD_ASSIGNMENT
 * 兜（要求附近有 key/token 字样），是刻意的精度/召回取舍。
 */
const BARE_HEX32 = /(?<![0-9a-zA-Z])(?:[0-9a-f]{32}|[0-9A-F]{32})(?![0-9a-fA-F])/g;
const HEX32_MIN_ENTROPY = 3.0;
const GLUE_CHAR = /[A-Za-z0-9_\-./]/;

/**
 * 关键词赋值：`api_key = "<长随机串>"` 这类。给 32 位以外的形状（40/64 位 hex、base64 token）兜底——
 * 那些长度裸扫会被 git hash 淹没，所以这里要求有明确的「这是凭证」的上下文词才报。
 */
const KEYWORD_ASSIGNMENT =
  /\b(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|api[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'`]([A-Za-z0-9+/=_-]{24,})["'`]/gi;
const KEYWORD_MIN_ENTROPY = 3.0;
/**
 * 「一条不断的随机串」判据 —— 把真凭证和「描述性测试假值」分开。
 *
 * 实测本仓库测试里到处是 `apiKey: "main-process-secret-must-not-leak"` 这种 kebab 英文散文，
 * 长度和字符熵都够（≥24 位、H>3），光靠长度/熵分不开。但结构上完全不同：
 *   凭证 = 一整条不带分隔符的长随机串（hex/base64 都是）；
 *   散文 = 一串被 - _ 切开的短单词（最长那段也就 "walkthrough" 11 位）。
 * 所以按分隔符切开后取最长一段，要求 ≥20 位且熵够——散文全灭，真凭证全留。
 */
const MIN_RANDOM_RUN = 20;
const longestRun = (value) => {
  let best = "";
  for (const m of value.matchAll(/[A-Za-z0-9+/=]+/g)) if (m[0].length > best.length) best = m[0];
  return best;
};
/** 明显是占位符的赋值不算泄露（文档/示例里到处都是）。 */
const PLACEHOLDER = /^(?:x+|y+|z+|a+|0+|1+|\*+|\.+|-+|_+)$|your|example|placeholder|dummy|sample|redacted|changeme|replace|xxx|todo|fake|test[-_]?key|<.+>/i;

/**
 * 行级豁免标记。**必须带理由**（标记后面要有非空白内容），否则不生效。
 *
 * 为什么用行级标记而不是往 ALLOWLIST 加路径：路径白名单赦免整份文件——那正是这次漏掉真泄露的病根。
 * 行级标记只赦免那一行，同文件其余部分照扫；写在现场，review 时看得见；可 grep 审计（见下面棘轮）。
 */
const INLINE_ALLOW = /nomi-secret-scan:allow\s+\S/;

/**
 * 豁免标记棘轮：只减不增。想加第 N+1 个必须顺手把这个数字改大，
 * 一行 diff、review 看得见——防止「随手标一下就绿了」把门岗降级成橡皮图章。
 * 当前 3 个：scripts/lib/feedback/bilibili.test.mjs 的 B站 WBI 公开测试向量（社区文档已知答案，非凭证）。
 */
const MAX_INLINE_ALLOWS = 3;

/** 扫一行里的凭证。返回 [{name, sample}]。 */
function findCredentials(line) {
  const out = [];
  for (const { name, re } of VENDOR_KEY_RULES) {
    for (const m of line.matchAll(re)) {
      // 文档里的占位示例（`sk-xxxxxxxx…`、`AKIAIOSFODNN7EXAMPLE`）形状也对，但不是真 key。
      if (PLACEHOLDER.test(m[0])) continue;
      if (shannonEntropy(m[0]) < VENDOR_MIN_ENTROPY) continue;
      out.push({ name, sample: m[0] });
    }
  }
  for (const m of line.matchAll(BARE_HEX32)) {
    const start = m.index;
    const end = start + m[0].length;
    const glued = GLUE_CHAR.test(line[start - 1] ?? "") || GLUE_CHAR.test(line[end] ?? "");
    if (glued) continue; // URL 段 / 文件名 / 复合 ID 的一部分
    if (shannonEntropy(m[0]) < HEX32_MIN_ENTROPY) continue; // magic bytes 之类结构化数据
    out.push({ name: "疑似明文 API key（32 位 hex）", sample: m[0] });
  }
  for (const m of line.matchAll(KEYWORD_ASSIGNMENT)) {
    const value = m[2];
    if (PLACEHOLDER.test(value)) continue;
    const run = longestRun(value);
    if (run.length < MIN_RANDOM_RUN) continue; // 被分隔符切碎 = 描述性假值，不是凭证
    if (shannonEntropy(run) < KEYWORD_MIN_ENTROPY) continue;
    out.push({ name: `疑似明文凭证赋值（${m[1]}）`, sample: value });
  }
  return out;
}

/** 凭证只脱敏成「头4…尾4」，避免门岗自己把 key 完整打进 CI 日志。 */
const maskSample = (s) => (s.length <= 12 ? `${s.slice(0, 2)}…` : `${s.slice(0, 4)}…${s.slice(-4)}（${s.length} 位）`);

const normalizeScanPath = (f) => String(f).replaceAll("\\", "/");
const isAllowed = (f) => ALLOWLIST.some((re) => re.test(normalizeScanPath(f)));

function listStaged() {
  try {
    // `-z`：默认 quotePath 把非 ASCII 路径转义成 `"docs/\\344..."`，按该串读文件必然失败，
    // 而读失败被下面的 catch 吞掉 —— 敏感数据扫描会**静默跳过**中文名的文件。
    return gitPaths(["diff", "--cached", "--name-only", "--diff-filter=AM"]);
  } catch {
    return [];
  }
}
function listAllTracked() {
  try {
    return gitPaths(["ls-files"]);
  } catch {
    return [];
  }
}
/** 读内容：staged 模式读 index 里的版本（git show :path），否则读工作区。跳过二进制。 */
function readContent(f, staged) {
  let raw;
  if (staged) {
    // execFileSync 而非拼 shell 串：路径里的引号/空格/中文都不该由 shell 再解析一次。
    try { raw = execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
    catch { raw = ""; }
  } else {
    try { raw = fs.readFileSync(f, "utf8"); } catch { raw = ""; }
  }
  return raw.includes("\u0000") ? "" : raw; // 含 NUL = 二进制，跳过内容扫描（路径黑名单仍生效）
}

function scan(files, staged) {
  const hits = [];
  let inlineAllows = 0;
  for (const f of files) {
    // 白名单**只**赦免路径黑名单 + 微信类内容规则；凭证规则往下对所有文件生效。
    // （整体 continue 正是当初漏掉 kie.ai key 的原因，见文件顶部凭证检测那段注释。）
    const allowed = isAllowed(f);
    const scanPath = normalizeScanPath(f);
    if (!allowed) {
      for (const { re, why } of FORBIDDEN_PATHS) {
        if (re.test(scanPath)) hits.push({ f, kind: "禁止路径", detail: why });
      }
    }
    const content = readContent(f, staged);
    if (!content) continue;
    if (!allowed) {
      for (const { name, re } of SECRET_PATTERNS) {
        const m = content.match(re);
        if (m) hits.push({ f, kind: "内容命中", detail: `${name}（如 "${m[0].slice(0, 20)}…"）` });
      }
    }
    const lines = content.split("\n");
    const perLine = lines.map((line) => findCredentials(line));
    lines.forEach((line, i) => {
      const found = perLine[i];
      if (!found.length) return;
      // 行级豁免：标记写在本行；若上一行是「只有标记、自己不含凭证」的注释行，也算标这一行。
      // 关键：带凭证的行上的标记**不会**顺延到下一行——否则标一行就悄悄赦免了两行，
      // 又变成范围失控的赦免（本文件的病根就是范围过大的赦免）。
      const marked =
        INLINE_ALLOW.test(line) ||
        (INLINE_ALLOW.test(lines[i - 1] ?? "") && perLine[i - 1].length === 0);
      if (marked) {
        inlineAllows += found.length;
        return;
      }
      for (const { name, sample } of found) {
        hits.push({ f: `${f}:${i + 1}`, kind: "明文凭证", detail: `${name}（${maskSample(sample)}）` });
      }
    });
  }
  // 棘轮：豁免标记只减不增（只在全仓模式下判——staged/指定文件模式看不到全量）
  if (scanningAll && inlineAllows > MAX_INLINE_ALLOWS) {
    hits.push({
      f: "scripts/check-no-secrets.mjs",
      kind: "豁免超标",
      detail: `行级豁免标记 ${inlineAllows} 个 > 基线 ${MAX_INLINE_ALLOWS} 个。豁免只减不增：先确认新标记真不是凭证，再把 MAX_INLINE_ALLOWS 改成 ${inlineAllows}`,
    });
  }
  return hits;
}

// ── 主流程 ──
const args = process.argv.slice(2);
let files, mode, staged;
const scanningAll = args.includes("--all");
if (scanningAll) { files = listAllTracked(); mode = "全部 tracked 文件"; staged = false; }
else if (args.length && !args[0].startsWith("--")) { files = args; mode = "指定文件"; staged = false; }
else { files = listStaged(); mode = "git staged 文件"; staged = true; }

const hits = scan(files, staged);

if (hits.length) {
  console.error("\n  🔴 安全门岗拦截：检测到疑似敏感数据（明文凭证 / 微信记录 / db_key / 私有配置）");
  console.error("  " + "─".repeat(56));
  for (const h of hits) console.error(`     ✗ ${h.f}\n         [${h.kind}] ${h.detail}`);
  console.error("  " + "─".repeat(56));
  console.error("  这些绝不能进 git（会 push 到公开 GitHub，且 git 历史永久留存）。处理：");
  console.error("     · 明文凭证      → 先去厂商后台轮换/吊销那把 key，再改本仓库正文脱敏");
  console.error("                        （公开仓库改 git 历史没意义：已被抓取/fork/缓存，轮换才是止血）");
  console.error("                        流程见 docs/security/feedback-data-safety.md「明文凭证泄露」");
  console.error("     · 数据文件误 add → git rm --cached <file>（确认它已在 .gitignore）");
  console.error("     · 内容级泄露    → 删掉正文里的敏感串（db_key/群消息/wxid）");
  console.error("     · 凭证确属误报  → 在**那一行**加注释 `nomi-secret-scan:allow <为什么不是凭证>`");
  console.error("                        （别往 ALLOWLIST 加路径——那会赦免整份文件，正是漏掉真泄露的病根）");
  console.error("     · 非凭证类误报  → 加进 scripts/check-no-secrets.mjs 的 ALLOWLIST");
  console.error("     · 已经提交了    → 见 docs/security/feedback-data-safety.md 的应急处理\n");
  process.exit(1);
}
console.log(`  ✓ 安全门岗通过：扫 ${files.length} 个${mode}，无明文凭证/微信记录/db_key/私有配置泄露。`);
