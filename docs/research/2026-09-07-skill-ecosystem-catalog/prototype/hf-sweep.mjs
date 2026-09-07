#!/usr/bin/env node
/**
 * HF 全量扫描（curation-policy.md §7 B1）
 * 对视频底座关键词逐个搜索 → 过滤 adapter/lora → 打分 → 分档 S/A/watch → 写 catalog + watchlist
 * 用法: node hf-sweep.mjs <out-catalog.json> <out-watchlist.json> [--min-score 阈值]
 * 注: HF API 无严格限流, 匿名可用。
 */
import fs from "node:fs";
import { marketScore, quantileThresholds } from "./collect.mjs";

const HF = "https://huggingface.co/api/models";
const QUERIES = ["minimax lora", "minimax-h3 lora", "h3 lora", "wan lora", "hunyuan lora", "wan2.5 lora"];

async function search(q, limit = 300) {
  const res = await fetch(`${HF}?search=${encodeURIComponent(q)}&limit=${limit}`, { headers: { "User-Agent": "nomi-sweep/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${q}`);
  return res.json();
}
function isAdapter(tags) {
  return tags.some((t) => t === "lora" || t.startsWith("base_model:adapter") || t === "peft");
}
function licOf(tags) {
  const t = tags.find((x) => x.startsWith("license:"));
  return t ? t.split(":")[1] : "none";
}
// 真人 likeness / NSFW 启发式（不替代人工审查——只用于分区默认值）
function contentRisk(id, tags) {
  const s = id.toLowerCase();
  const nsfw = tags.some((t) => /nsfw|adult/i.test(t));
  const likeness = /(real|people|person|portrait|face|girl|actress|cosplay|celebrity|likeness|photo|vtuber|character-consistency)/.test(s);
  return { nsfw, likeness, adult: nsfw };
}

async function main() {
  const [outFile, watchFile] = process.argv.slice(2);
  if (!outFile || !watchFile) { console.error("用法: hf-sweep.mjs <out-catalog.json> <out-watchlist.json>"); process.exit(2); }
  const seen = new Map();
  for (const q of QUERIES) {
    try {
      const list = await search(q);
      for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
      console.log(`✓ ${q}: ${list.length} 命中`);
    } catch (e) { console.log(`✗ ${q}: ${e.message}`); }
  }
  const adapters = [...seen.values()].filter((m) => isAdapter(m.tags ?? []));
  console.log(`\n去重 ${seen.size}，其中 adapter/lora ${adapters.length}`);

  const entries = [];
  for (const m of adapters) {
    const tags = m.tags ?? [];
    const lic = licOf(tags);
    const base = tags.find((t) => t.startsWith("base_model:adapter:"))?.split("adapter:")[1] ?? "";
    const risk = contentRisk(m.id, tags);
    const files = m.siblings?.filter((s) => /\.(safetensors|bin|ckpt)$/.test(s.rfilename)).length ?? 0;
    const comfyBase = /comfy-org|comfy/i.test(base);
    const needs = comfyBase || files ? "comfyui-install" : "reference-only";
    entries.push({
      id: `hf::${m.id}`,
      kind: "lora",
      owner: m.id.split("/")[0], repo: m.id, name: m.id.split("/")[1],
      title: undefined, version: "",
      description: m.cardData?.description ?? m.cardData?.short ?? `HuggingFace 模型：${m.id}`,
      license: lic,
      domain: risk.likeness ? "character-consistency" : "collection",
      craft: "", modality: "style",
      preview: { kind: "author-gallery", gallery: [], caption: "", requiredForFeatured: false },
      source: { type: "huggingface", url: `https://huggingface.co/${m.id}`, repoId: m.id, ref: "", collectedAt: new Date().toISOString().slice(0, 10), verified: true },
      validation: { status: "pass", checkedBy: "hf-sweep-v1" },
      security: { auditStatus: "unscanned", verified: "community" },
      stats: { installs: m.downloads ?? 0, stars: 0, likes: m.likes ?? 0, updatedAt: m.lastModified ?? "" },
      curation: { status: (lic === "none" || lic === "other" || risk.likeness || risk.nsfw) ? "open-directory" : "candidate" },
      adapterForNomi: { needs, notes: `底座: ${base || "未知"} · ${risk.nsfw ? "NSFW" : risk.likeness ? "真人 likeness 启发式标记" : ""} · 权重文件 ${files} 个` },
      contentRisk: risk,
    });
  }

  // 打分分档（同 collect：动态分位）
  const scores = entries.map((e) => marketScore(e.stats.installs, e.stats.likes));
  const { p15, p85 } = quantileThresholds(scores);
  const catalog = [], watch = [];
  for (const e of entries) {
    const s = marketScore(e.stats.installs, e.stats.likes);
    e.scoring = { formula: "0.6*log1p(downloads)+0.4*log1p(likes)", score: s, tier: s >= p85 ? "S" : s >= p15 ? "A" : "watch" };
    if (e.scoring.tier === "S" && e.curation.status === "candidate") e.curation.status = "curated";
    (e.scoring.tier === "watch" ? watch : catalog).push(e);
  }
  const out = { $schema: "https://nomi.app/catalog/collection.v0.schema.json", collectedAt: new Date().toISOString().slice(0, 10), scoring: { formula: "0.6*log1p(downloads)+0.4*log1p(likes)", p15, p85, poolSize: entries.length }, entries: catalog };
  const wl = { collectedAt: out.collectedAt, note: "市场认可度低于 P15 或 0 下载——不进 catalog，月更观察是否升温", entries: watch };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  fs.writeFileSync(watchFile, JSON.stringify(wl, null, 2));
  const t = {};
  for (const e of entries) t[e.scoring.tier] = (t[e.scoring.tier] || 0) + 1;
  console.log(`写 catalog ${catalog.length} / watchlist ${watch.length} | 分档 S=${t.S ?? 0} A=${t.A ?? 0} watch=${t.watch ?? 0} | P85=${p85} P15=${p15}`);
}

main();
