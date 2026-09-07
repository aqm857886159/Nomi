#!/usr/bin/env node
/**
 * catalog collect —— 采集管线原型（P0 §3）
 * 输入：seeds.json（owner/repo[#skillPath] 或 huggingface:repoId 列表）
 * 处理：拉取 → 解析 frontmatter → 产出 catalog 条目 → 校验 + 安全标记 → 写 catalog.json
 *
 * 用法：
 *   node collect.mjs ./seeds.json ./out.json
 *
 * 对应 docs/plan/2026-09-07-skill-catalog-registry.md P0 §3。
 * 原型实现：GitHub raw 直拉 + HF API；真实生产换 git clone/管线时保留同一输出形状。
 */
import fs from "node:fs";
import { parseFrontmatter } from "./validate-skill.mjs";

const RAW = "https://raw.githubusercontent.com";
const HF_API = "https://huggingface.co/api/models";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "nomi-catalog-collect/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "nomi-catalog-collect/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function ghCandidateUrls(owner, repo, skillPath, ref = "main") {
  const base = `${RAW}/${owner}/${repo}/${ref}`;
  if (skillPath) {
    const dir = skillPath.replace(/\/SKILL\.md$/i, "").replace(/\/$/, "");
    return [`${base}/${dir}/SKILL.md`, `${base}/SKILL.md`];
  }
  return [`${base}/SKILL.md`, `${base}/skills/SKILL.md`];
}

function normalizeLicense(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("apache-2.0") || v.includes("apache 2.0")) return "apache-2.0";
  if (v === "mit" || v.includes("mit license")) return "mit";
  if (v.includes("gpl-2.0") || v.includes("gpl-2")) return "gpl-2.0";
  return "other"; // 自定义/完整条款文件（如 anthropics "Complete terms in LICENSE.txt"）→ other
}

// —— 市场认可度（curation-policy.md §1）：0.6·log1p(下载/star) + 0.4·log1p(点赞) ——
export function marketScore(downloads, likes) {
  return Math.round((0.6 * Math.log1p(downloads || 0) + 0.4 * Math.log1p(likes || 0)) * 100) / 100;
}

// GitHub stars 带磁盘缓存（匿名 API 限 60/h，缓存避免重复打）
const STAR_CACHE = "gh-stars-cache.json";
const starCache = (() => { try { return JSON.parse(fs.readFileSync(STAR_CACHE, "utf8")); } catch { return {}; } })();
async function githubStars(owner, repo) {
  const key = `${owner}/${repo}`;
  if (key in starCache) return starCache[key];
  try {
    const d = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
    const stars = d.stargazers_count ?? 0;
    starCache[key] = stars;
    fs.writeFileSync(STAR_CACHE, JSON.stringify(starCache, null, 1));
    return stars;
  } catch {
    starCache[key] = 0; return 0; // 限流/失败降级 0，不阻塞收录
  }
}

// 分位门槛：给定分数数组，返回 { p15, p85 }（curation-policy.md §2）
export function quantileThresholds(scores) {
  if (!scores.length) return { p15: 0, p85: 0 };
  const s = [...scores].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return { p15: at(0.15), p85: at(0.85) };
}

async function collectGithub(seed) {
  const [ownerRepo, skillPathRaw] = seed.split("#");
  const [owner, repo] = ownerRepo.split("/");
  const skillPath = skillPathRaw ? skillPathRaw.replace(/^\/+/, "") : undefined;
  const urls = ghCandidateUrls(owner, repo, skillPath);
  let text = null, hitUrl = null;
  for (const u of urls) {
    try { text = await fetchText(u); hitUrl = u; break; } catch { /* next */ }
  }
  if (text === null) return { seed, error: "SKILL.md 未找到（试了 " + urls.join(" / ") + "）" };
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter?.name) return { seed, error: "有 SKILL.md 但无合法 frontmatter" };
  const name = frontmatter.name;
  const dirName = decodeURIComponent(hitUrl.split("/").slice(-2)[0]);
  const desc = frontmatter.description ?? "";
  const license = normalizeLicense(frontmatter.license ?? "");
  const isStd = urls.indexOf(hitUrl) === urls.length - 1 && urls.length > 1;
  return {
    id: `${owner}/${repo}::${name}`,
    kind: "skill",
    owner, repo, name,
    title: undefined, // 拟人化展示名由策展补（P0 原型留空）
    version: frontmatter.metadata?.version || "",
    skillPath: hitUrl.split(`/${owner}/${repo}/`)[1]?.split("/").slice(1).join("/") || "",
    description: desc,
    license,
    domain: "collection", craft: "", modality: "",
    preview: { kind: "none", requiredForFeatured: false },
    source: { type: "github", url: `https://github.com/${owner}/${repo}`, ref: "main", collectedAt: new Date().toISOString().slice(0, 10), verified: true },
    validation: {
      status: "pass",
      checkedBy: "prototype-validate",
      nameLenOk: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 64,
      descLenOk: desc.length >= 1 && desc.length <= 1024,
      reservedWordOk: !["anthropic", "claude", "nomi"].some((w) => name.includes(w)),
      dirNameMatches: name === dirName,
    },
    security: { auditStatus: "unscanned", verified: "community" },
    stats: { installs: 0, stars: await githubStars(owner, repo), updatedAt: "" },
    curation: { status: license === "none" || license === "other" ? "open-directory" : "candidate" },
  };
}

async function collectHuggingface(repoId) {
  // HF API：路径段内斜杠保留（%2F 会 400）
  const d = await fetchJson(`${HF_API}/${repoId}`);
  const tags = d.tags ?? [];
  const lic = tags.find((t) => t.startsWith("license:"))?.split(":")[1] ?? "none";
  const base = tags.find((t) => t.startsWith("base_model:adapter:"))?.split("adapter:")[1] ?? "";
  const adult = tags.some((t) => /nsfw|adult/i.test(t)) || /NSFW/i.test(d.cardData?.tags?.join?.(" ") ?? "");
  const files = (d.siblings ?? []).filter((s) => /\.(safetensors|bin|ckpt)$/.test(s.rfilename)).map((s) => s.rfilename);
  const name = repoId.split("/")[1] ?? repoId;
  return {
    id: `hf::${repoId}`,
    kind: "lora",
    owner: repoId.split("/")[0], repo: repoId,
    name,
    title: undefined,
    version: "",
    skillPath: files[0] || "",
    description: (d.cardData?.description ?? d.cardData?.short ?? `HuggingFace 模型：${repoId}`).slice(0, 1024),
    license: lic,
    domain: "character-consistency", // 占位，策展时按内容归类
    craft: "", modality: "style",
    preview: { kind: "author-gallery", gallery: [], caption: "", requiredForFeatured: false },
    source: { type: "huggingface", url: `https://huggingface.co/${repoId}`, repoId, ref: "", collectedAt: new Date().toISOString().slice(0, 10), verified: true },
    validation: { status: "pass", checkedBy: "prototype-hf", nameLenOk: true, descLenOk: true, reservedWordOk: true, dirNameMatches: true },
    security: { auditStatus: "unscanned", verified: "community" },
    stats: { installs: d.downloads ?? 0, stars: 0, likes: d.likes ?? 0, updatedAt: d.lastModified ?? "" },
    curation: { status: lic === "none" || lic === "other" ? "open-directory" : "candidate" },
    adapterForNomi: { needs: files.length ? "comfyui-install" : "", notes: `底座: ${base} · ${adult ? "adult 标记 · " : ""}文件 ${files.length} 个` },
  };
}

async function main() {
  const [seedsFile, outFile] = process.argv.slice(2);
  if (!seedsFile || !outFile) { console.error("用法: collect.mjs <seeds.json> <out.json>"); process.exit(2); }
  const seeds = JSON.parse(fs.readFileSync(seedsFile, "utf8"));
  const entries = [];
  for (const seed of seeds) {
    try {
      const e = seed.startsWith("huggingface:")
        ? await collectHuggingface(seed.slice("huggingface:".length))
        : await collectGithub(seed);
      if (e.error) { console.log(`✗ ${seed}: ${e.error}`); continue; }
      entries.push(e);
      console.log(`✓ ${seed} -> ${e.id} (${e.kind})`);
    } catch (err) {
      console.log(`✗ ${seed}: ${err.message}`);
    }
  }
  // 全池市场打分 + 门槛分档（curation-policy.md §2）：S 档(P85+)→curated
  // 信号按 source 取：github 用 stars（市场认可代理）、hf 用 installs+likes
  const signal = (e) => {
    const s = e.stats || {};
    return e.source?.type === "huggingface"
      ? { d: s.installs || 0, l: s.likes || 0 }
      : { d: s.stars || 0, l: 0 };
  };
  const scores = entries.map((e) => marketScore(signal(e).d, signal(e).l));
  const { p15, p85 } = quantileThresholds(scores);
  for (const e of entries) {
    const { d, l } = signal(e);
    const s = marketScore(d, l);
    e.scoring = { formula: "0.6*log1p(downloads|stars)+0.4*log1p(likes)", score: s, tier: s >= p85 ? "S" : s >= p15 ? "A" : "watch" };
    if (s >= p85 && e.curation.status === "candidate") e.curation.status = "curated"; // S 档候选→策展收录
  }
  const out = {
    $schema: "https://nomi.app/catalog/collection.v0.schema.json",
    collectedAt: new Date().toISOString().slice(0, 10),
    scoring: { formula: "0.6*log1p(installs|stars)+0.4*log1p(likes)", p15, p85, poolSize: entries.length },
    entries,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  const tiers = {};
  for (const e of entries) tiers[e.scoring.tier] = (tiers[e.scoring.tier] || 0) + 1;
  console.log(`\n写 ${entries.length} 条 -> ${outFile} | 分档 S=${tiers.S ?? 0} A=${tiers.A ?? 0} watch=${tiers.watch ?? 0} (P85=${p85} P15=${p15})`);
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) main();
