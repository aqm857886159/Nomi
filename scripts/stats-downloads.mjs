#!/usr/bin/env node
// 下载量看板 —— Nomi 的「最小埋点」。
//
// 为什么是它：下载发生在 GitHub Releases，不在用户机器上 → 零隐私足迹、零代码侵入。
// GitHub 为每个 release 资产记了 download_count（累计快照），本脚本把它聚合成人看得懂的表。
//
// 三种用法（一份代码，不开并行实现）：
//   node ./scripts/stats-downloads.mjs            打印当前下载看板（总量/平台/分版本）
//   node ./scripts/stats-downloads.mjs --html     生成 docs/stats/dashboard.html（本地看，不提交）
//   NOMI_STATS_HISTORY_PATH=<file> node ./scripts/stats-downloads.mjs --snapshot
//                                                 追加今日快照到数据分支上的 downloads-history.json
//
// 快照数据为什么不住在 main：main 受保护（必须走 PR + 两个必需 check），
// 机器人每天直推必被 GH006 拒绝——2026-09-02 起这条每日流水线因此连红 20 天、快照断档。
// 派生数据于是有了自己的家：非保护孤儿分支 `stats-data`，根目录只有 downloads-history.json。
// 读写路径因此**显式配置**，不在源码树里 hardcode：
//   · 写（CI）：把数据分支 checkout 到子目录，用 NOMI_STATS_HISTORY_PATH 指过来；没指就拒绝写（fail-closed）。
//   · 读（本地）：不给路径就读 `origin/stats-data` 上那一份。main 上不再留第二份，无双真相源。
//
// 口径：只数真人下载的安装包（.dmg / .exe），剔除 .blockmap / latest*.yml / .zip
//       —— 那些是 electron 自动更新机制拉的，不是人。
// 诚实边界：下载 ≠ 安装 ≠ 活跃用户；重复点/爬虫都会计数。它给的是「触达与平台分布」信号，
//           不是激活信号。要知道「下载后有没有创作出片」，得另上 App 内激活漏斗（本脚本不碰）。

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML_PATH = path.join(ROOT, "docs", "stats", "dashboard.html");

/** 数据分支上快照文件的名字（分支根目录就这一个文件）。 */
export const HISTORY_FILENAME = "downloads-history.json";
/** 本地只读时的默认来源：数据分支的远端跟踪 ref。 */
export const DEFAULT_DATA_REF = "origin/stats-data";

/**
 * 快照文件的落点。显式给了 NOMI_STATS_HISTORY_PATH 才有落点——相对路径按调用者的 cwd 解析，
 * 因为 CI 把数据分支 checkout 到 workspace 下的子目录，而脚本住在另一个 checkout 里。
 * 没给返回 null：写路径据此 fail-closed，读路径据此改走数据分支 ref。
 */
export function resolveHistoryPath({ env = process.env, cwd = process.cwd() } = {}) {
  const configured = typeof env.NOMI_STATS_HISTORY_PATH === "string" ? env.NOMI_STATS_HISTORY_PATH.trim() : "";
  if (configured === "") return null;
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(cwd, configured);
}

/** 本地只读时从哪个 ref 取历史（默认 origin/stats-data，可用 NOMI_STATS_DATA_REF 覆盖）。 */
export function resolveHistoryRef({ env = process.env } = {}) {
  const configured = typeof env.NOMI_STATS_DATA_REF === "string" ? env.NOMI_STATS_DATA_REF.trim() : "";
  return configured === "" ? DEFAULT_DATA_REF : configured;
}

/** 从 GITHUB_REPOSITORY（Action 注入）或 git remote 推断 owner/repo。 */
function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execSync("git remote get-url origin", { cwd: ROOT }).toString().trim();
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`无法从 origin 推断仓库：${url}`);
  return `${m[1]}/${m[2]}`;
}

/** 拉全部 release（翻页）。公开仓库读 download_count 无需 token；有 token 则提速率限。 */
async function fetchReleases(repo) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "nomi-stats" };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** 是否真人安装包：.dmg / .exe，且非 .blockmap。 */
function isInstaller(name) {
  return /\.(dmg|exe)$/i.test(name) && !/blockmap/i.test(name);
}

/** 资产名 → 平台。按扩展名定平台，不靠命名习惯（早期资产名不带 win/arch 字样），保证每个安装包必落一类、账永远平。 */
function platformOf(name) {
  if (/\.exe$/i.test(name)) return "windows"; // .exe 只存在于 Windows
  if (/arm64/i.test(name)) return "macArm"; // .dmg 带 arm64 = Apple 芯
  return "macIntel"; // 其余 .dmg（x64 / intel / 早期不带架构的裸 dmg）= Mac Intel/通用
}

function aggregate(releases) {
  const byPlatform = { windows: 0, macArm: 0, macIntel: 0 };
  const byVersion = {};
  for (const rel of releases) {
    let verTotal = 0;
    for (const asset of rel.assets ?? []) {
      if (!isInstaller(asset.name)) continue;
      const n = asset.download_count ?? 0;
      byPlatform[platformOf(asset.name)] += n;
      verTotal += n;
    }
    byVersion[rel.tag_name] = { dl: verTotal, published: rel.published_at };
  }
  const total = Object.values(byPlatform).reduce((a, b) => a + b, 0);
  return { total, byPlatform, byVersion };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** 默认读法：从数据分支的 ref 里取文件内容；ref 或文件不在就回 null（由调用者决定红不红）。 */
function readFromDataBranch(ref) {
  try {
    return execFileSync("git", ["show", `${ref}:${HISTORY_FILENAME}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * 历史快照的唯一读法。给了文件路径读文件（CI 的数据分支 checkout），没给读数据分支 ref。
 * 两条通向同一份数据，不是两个真相源；`missing` 让调用者自己决定「空历史」是否可接受。
 */
export function loadHistory({
  env = process.env,
  cwd = process.cwd(),
  readFileAt = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null),
  readFromRef = readFromDataBranch,
} = {}) {
  const file = resolveHistoryPath({ env, cwd });
  const source = file ?? `${resolveHistoryRef({ env })}:${HISTORY_FILENAME}`;
  const raw = file ? readFileAt(file) : readFromRef(resolveHistoryRef({ env }));
  if (raw === null || raw === undefined) return { history: { snapshots: [] }, source, missing: true };
  return { history: JSON.parse(raw), source, missing: false };
}

/**
 * 写今日快照（同日幂等覆盖）。返回与上一份不同日快照的总量差，供打印「自上次 +N」。
 * 没有显式落点就抛——宁可流水线红，也不把数据默默写回受保护的源码主线。
 */
export function writeSnapshot(agg, { env = process.env, cwd = process.cwd(), writeFileAt, loadHistoryImpl = loadHistory } = {}) {
  const file = resolveHistoryPath({ env, cwd });
  if (!file) {
    throw new Error(
      "--snapshot 需要 NOMI_STATS_HISTORY_PATH 指向 stats-data 分支 checkout 里的 downloads-history.json（见 docs/stats/README.md）",
    );
  }
  const { history } = loadHistoryImpl({ env, cwd });
  const date = todayISO();
  const flatVersions = Object.fromEntries(Object.entries(agg.byVersion).map(([k, v]) => [k, v.dl]));
  const snap = { date, total: agg.total, byPlatform: { ...agg.byPlatform }, byVersion: flatVersions };

  const prior = history.snapshots.filter((s) => s.date !== date);
  const lastDifferentDay = prior[prior.length - 1];
  const next = { ...history, snapshots: [...prior, snap] }; // 同日只留最新一份

  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (writeFileAt) writeFileAt(file, serialized);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized);
  }
  return { file, sinceLast: lastDifferentDay ? agg.total - lastDifferentDay.total : null };
}

function pct(n, total) {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function printDashboard(agg, sinceLast) {
  const { total, byPlatform, byVersion } = agg;
  const bar = (n, max, width = 24) => "█".repeat(Math.round((n / Math.max(max, 1)) * width));

  console.log(`\n  Nomi 下载看板 · ${todayISO()}`);
  console.log("  " + "─".repeat(46));
  console.log(`  真人安装包下载总计   ${total}` + (sinceLast != null ? `   (自上次快照 ${sinceLast >= 0 ? "+" : ""}${sinceLast})` : ""));
  console.log("");
  console.log(`  Windows      ${String(byPlatform.windows).padStart(5)}  ${pct(byPlatform.windows, total).padStart(4)}  ${bar(byPlatform.windows, total)}`);
  console.log(`  Mac Apple芯  ${String(byPlatform.macArm).padStart(5)}  ${pct(byPlatform.macArm, total).padStart(4)}  ${bar(byPlatform.macArm, total)}`);
  console.log(`  Mac Intel    ${String(byPlatform.macIntel).padStart(5)}  ${pct(byPlatform.macIntel, total).padStart(4)}  ${bar(byPlatform.macIntel, total)}`);

  const versions = Object.entries(byVersion)
    .filter(([, v]) => v.published)
    .sort((a, b) => new Date(b[1].published) - new Date(a[1].published))
    .slice(0, 12);
  const maxVer = Math.max(...versions.map(([, v]) => v.dl), 1);
  console.log("\n  近 12 个版本");
  console.log("  " + "─".repeat(46));
  for (const [tag, v] of versions) {
    console.log(`  ${tag.padEnd(11)} ${String(v.dl).padStart(4)}  ${bar(v.dl, maxVer, 28)}`);
  }
  console.log("");
}

/** 生成自包含可视化看板（数据 baked in,单一真相源=本脚本聚合器,HTML 只是纯视图）。 */
function generateHtml(agg, history) {
  const versions = Object.entries(agg.byVersion)
    .filter(([, v]) => v.published)
    .sort((a, b) => new Date(a[1].published) - new Date(b[1].published))
    .slice(-14)
    .map(([tag, v]) => ({ tag, dl: v.dl }));
  const trend = history.snapshots.map((s) => ({ date: s.date, total: s.total }));
  const data = {
    generatedAt: todayISO(),
    total: agg.total,
    byPlatform: agg.byPlatform,
    versions,
    trend,
  };

  const head =
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Nomi 下载看板</title>" +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></scr' + "ipt>" +
    "<style>" +
    ":root{--bg:#faf9f5;--card:#fff;--ink:#1f1e1b;--muted:#6b6a64;--line:#e7e5dd;--accent:#534ab7;--win:#534ab7;--marm:#1d9e75;--mintel:#d85a30}" +
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;padding:32px 20px}" +
    ".wrap{max-width:880px;margin:0 auto}h1{font-size:22px;font-weight:600;margin:0 0 4px}.sub{color:var(--muted);font-size:13px;margin:0 0 24px}" +
    ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:28px}" +
    ".card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.card .lbl{font-size:13px;color:var(--muted);margin-bottom:6px}.card .num{font-size:26px;font-weight:600}.card .num span{font-size:14px;color:var(--muted);font-weight:400}" +
    ".panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:20px}.panel h2{font-size:14px;font-weight:600;margin:0 0 14px;color:var(--muted)}" +
    ".row{display:grid;grid-template-columns:1.4fr 1fr;gap:20px}@media(max-width:680px){.row{grid-template-columns:1fr}}" +
    ".note{color:var(--muted);font-size:12px;margin-top:18px;line-height:1.7}.cv{position:relative;height:260px}" +
    "</style></head><body><div class=\"wrap\">";

  const body =
    "<h1>Nomi 下载看板</h1>" +
    '<p class="sub">真人安装包下载（剔除自动更新噪音）· 数据生成于 ' + data.generatedAt + "</p>" +
    '<div class="cards">' +
    '<div class="card"><div class="lbl">下载总计</div><div class="num">' + agg.total + "</div></div>" +
    '<div class="card"><div class="lbl">Windows</div><div class="num">' + agg.byPlatform.windows + " <span>" + pct(agg.byPlatform.windows, agg.total) + "</span></div></div>" +
    '<div class="card"><div class="lbl">Mac Apple 芯</div><div class="num">' + agg.byPlatform.macArm + " <span>" + pct(agg.byPlatform.macArm, agg.total) + "</span></div></div>" +
    '<div class="card"><div class="lbl">Mac Intel</div><div class="num">' + agg.byPlatform.macIntel + " <span>" + pct(agg.byPlatform.macIntel, agg.total) + "</span></div></div>" +
    "</div>" +
    '<div class="panel"><h2>累计下载趋势（随每日快照累积）</h2><div class="cv"><canvas id="trend"></canvas></div></div>' +
    '<div class="row">' +
    '<div class="panel"><h2>各版本下载量</h2><div class="cv"><canvas id="ver"></canvas></div></div>' +
    '<div class="panel"><h2>平台分布</h2><div class="cv"><canvas id="plat"></canvas></div></div>' +
    "</div>" +
    '<p class="note">口径：只数 .dmg / .exe 真人下载，剔除 .blockmap / latest*.yml / .zip（electron 自动更新机制拉取，非真人）。' +
    "诚实边界：下载 ≠ 安装 ≠ 活跃用户（重复点 / 爬虫都会计数）。趋势曲线由每日 GitHub Action 快照累积，刚启用时只有一两个点，会逐日生长。" +
    "刷新数据：<code>pnpm stats:html</code>。</p>";

  const script =
    "<scr" + "ipt>const DATA=" + JSON.stringify(data) + ";" +
    "const winC='#534ab7',marmC='#1d9e75',mintelC='#d85a30';" +
    "new Chart(document.getElementById('trend'),{type:'line',data:{labels:DATA.trend.map(p=>p.date),datasets:[{label:'累计下载',data:DATA.trend.map(p=>p.total),borderColor:winC,backgroundColor:'rgba(83,74,183,.08)',fill:true,tension:.25,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});" +
    "new Chart(document.getElementById('ver'),{type:'bar',data:{labels:DATA.versions.map(v=>v.tag),datasets:[{data:DATA.versions.map(v=>v.dl),backgroundColor:winC,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{maxRotation:60,minRotation:60,font:{size:10}},grid:{display:false}},y:{beginAtZero:true}}}});" +
    "new Chart(document.getElementById('plat'),{type:'doughnut',data:{labels:['Windows','Mac Apple 芯','Mac Intel'],datasets:[{data:[DATA.byPlatform.windows,DATA.byPlatform.macArm,DATA.byPlatform.macIntel],backgroundColor:[winC,marmC,mintelC],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:12}}}}}});" +
    "</scr" + "ipt>";

  return head + body + script + "</div></body></html>\n";
}

async function main() {
  const snapshot = process.argv.includes("--snapshot");
  const html = process.argv.includes("--html");
  const repo = resolveRepo();
  const releases = await fetchReleases(repo);
  const agg = aggregate(releases);

  let sinceLast = null;
  if (snapshot) {
    const written = writeSnapshot(agg);
    sinceLast = written.sinceLast;
    console.log(`  已记录今日快照 → ${written.file}`);
  } else {
    const { history } = loadHistory();
    const prior = history.snapshots.filter((s) => s.date !== todayISO());
    const last = prior[prior.length - 1];
    if (last) sinceLast = agg.total - last.total;
  }

  if (html) {
    // 趋势图就是历史快照本身：读不到历史就红，不画一条空曲线冒充「刚启用」。
    const { history, source, missing } = loadHistory();
    if (missing) {
      throw new Error(
        `趋势图需要历史快照，但读不到 ${source}。先 \`git fetch origin stats-data\`，` +
          "或用 NOMI_STATS_HISTORY_PATH 指向本地快照文件（见 docs/stats/README.md）",
      );
    }
    fs.mkdirSync(path.dirname(HTML_PATH), { recursive: true });
    fs.writeFileSync(HTML_PATH, generateHtml(agg, history));
    console.log(`  已生成可视化看板 → ${path.relative(ROOT, HTML_PATH)}（浏览器打开）`);
  }

  printDashboard(agg, sinceLast);
}

// 只在被直接执行时跑；被单测 import 时不许有副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n  ✗ 拉取下载数据失败：${err.message}\n`);
    process.exit(1);
  });
}
