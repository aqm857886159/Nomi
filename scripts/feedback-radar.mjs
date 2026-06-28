#!/usr/bin/env node
// Feedback Radar —— 三渠道单向反馈雷达（确定性抓取层）。
//
// 它做什么：串起 GitHub / B站 / 微信 三个只读 adapter → 归一化 → 按稳定 id 去重 →
//          写 docs/feedback/<date>-raw.json + 打印摘要。**不分诊、不判 bug、不花额度。**
// 它不做什么：分诊「是不是 bug」、定位代码、修复——那是 nomi-feedback-radar 技能里 agent 的活
//            （读这份 raw.json 接着干）。这个分工和 nomi-research-radar 一致：脚本管抓，skill 管脑。
//
// 用法：
//   node ./scripts/feedback-radar.mjs              抓全部已配置渠道，去重，写 raw.json
//   node ./scripts/feedback-radar.mjs --only github   只抓某一渠道（github|bilibili|wechat）
//   node ./scripts/feedback-radar.mjs --no-state   不读写 seen 状态（每次全量，调试用）
//
// 配置：复制 docs/feedback/sources.example.json → docs/feedback/sources.json 填自己的渠道。
//      （sources.json / state.json / *-raw.json 都 gitignore，不入库。）

import fs from "node:fs";
import path from "node:path";
import { collectGithub } from "./lib/feedback/github.mjs";
import { collectBilibili } from "./lib/feedback/bilibili.mjs";
import { collectWechat } from "./lib/feedback/wechat.mjs";
import { FEEDBACK_DIR, SOURCES_EXAMPLE_PATH, loadSources, readState, writeState, dedupe, todayISO } from "./lib/feedback/normalize.mjs";

const ADAPTERS = {
  github: collectGithub,
  bilibili: collectBilibili,
  wechat: collectWechat,
};

function parseArgs(argv) {
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  return { only, useState: !argv.includes("--no-state") };
}

async function main() {
  const { only, useState } = parseArgs(process.argv.slice(2));

  const sources = loadSources();
  if (!sources) {
    console.error(
      `\n  ✗ 还没有配置文件。复制模板并填上你的渠道：\n` +
        `      cp ${path.relative(process.cwd(), SOURCES_EXAMPLE_PATH)} docs/feedback/sources.json\n` +
        `    GitHub 默认自动用本仓库；B站填视频 BV 号；微信填群名（需先开 chatlog）。\n`,
    );
    process.exit(1);
  }

  const channels = only ? [only] : Object.keys(ADAPTERS);
  const state = useState ? readState() : { seen: {}, lastRun: {} };
  const now = new Date().toISOString();

  const allSignals = [];
  const metas = {};
  for (const ch of channels) {
    const adapter = ADAPTERS[ch];
    if (!adapter) {
      console.error(`  ⚠ 未知渠道 "${ch}"，跳过`);
      continue;
    }
    try {
      const { signals, meta } = await adapter(sources[ch] ?? {});
      allSignals.push(...signals);
      metas[ch] = meta;
    } catch (e) {
      metas[ch] = { error: e.message };
      console.error(`  ⚠ ${ch} 抓取失败：${e.message}`);
    }
  }

  const { fresh } = dedupe(allSignals, state, now);
  if (useState) {
    state.lastRun[only || "all"] = now;
    writeState(state);
  }

  // 写当轮原始信号（供 skill 分诊）
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  const rawPath = path.join(FEEDBACK_DIR, `${todayISO()}-raw.json`);
  const existing = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, "utf8")) : { generatedAt: now, signals: [] };
  const merged = [...existing.signals, ...fresh];
  fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: now, meta: metas, signals: merged }, null, 2) + "\n");

  printSummary(metas, fresh, allSignals.length, rawPath);
}

function printSummary(metas, fresh, totalScanned, rawPath) {
  console.log(`\n  Feedback Radar · ${todayISO()}`);
  console.log("  " + "─".repeat(48));
  for (const [ch, m] of Object.entries(metas)) {
    if (m.error) console.log(`  ${ch.padEnd(9)} ✗ ${m.error}`);
    else if (m.skipped) console.log(`  ${ch.padEnd(9)} – ${m.skipped}`);
    else console.log(`  ${ch.padEnd(9)} ✓ ${JSON.stringify(m)}`);
  }
  console.log("  " + "─".repeat(48));
  console.log(`  扫描 ${totalScanned} 条，新增 ${fresh.length} 条（已去重）`);
  console.log(`  原始信号 → ${path.relative(process.cwd(), rawPath)}`);
  console.log(`\n  下一步：跑 nomi-feedback-radar 技能，对这份 raw 分诊 + 修可复现的 bug。\n`);
}

main().catch((err) => {
  console.error(`\n  ✗ 雷达失败：${err.stack || err.message}\n`);
  process.exit(1);
});
