// eval:view —— 轨迹查看器生成器(评测方案 S1.5,"trace 查看界面是最被低估的投资")。
// 把 EventLog JSONL 渲染成单个自包含 HTML:对话气泡 + 工具调用折叠 + 终态清单 +
// 标注模式(pass/fail+critique,localStorage 暂存,导出 JSONL 后放 evals/annotations/)。
// error analysis(S2)与 judge 校准标注(S3)共用此载体。
//
// 用法:
//   pnpm eval:view                       # 最新 eval run → <runDir>/viewer.html
//   pnpm eval:view evals/runs/<dir>      # 指定 run
//   pnpm eval:view --project <项目目录>   # 看真实项目的轨迹(error analysis)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

function readEventsDir(eventsDir) {
  if (!fs.existsSync(eventsDir)) return [];
  const events = [];
  for (const f of fs.readdirSync(eventsDir).filter((n) => /^log-\d+\.jsonl$/.test(n)).sort()) {
    events.push(...readJsonl(path.join(eventsDir, f)));
  }
  return events;
}

/** 汇集渲染单元:{ key, title, events, extra } 数组。 */
function collectSections() {
  const projIdx = args.indexOf("--project");
  if (projIdx >= 0) {
    const projectDir = path.resolve(args[projIdx + 1] || "");
    const events = readEventsDir(path.join(projectDir, ".nomi", "events"));
    if (!events.length) {
      console.error(`该项目没有轨迹: ${projectDir}`);
      process.exit(1);
    }
    return {
      name: path.basename(projectDir),
      outPath: path.join(repoRoot, "evals", `viewer-${path.basename(projectDir).slice(0, 24)}.html`),
      sections: [{ key: path.basename(projectDir), title: `项目轨迹 · ${path.basename(projectDir)}`, events, extra: null }],
    };
  }
  const runsRoot = path.join(repoRoot, "evals", "runs");
  let runDir = args.find((a) => !a.startsWith("--"));
  if (runDir) runDir = path.resolve(runDir);
  else {
    const dirs = fs.existsSync(runsRoot)
      ? fs.readdirSync(runsRoot).filter((n) => fs.existsSync(path.join(runsRoot, n, "output.jsonl"))).sort()
      : [];
    runDir = dirs.length ? path.join(runsRoot, dirs[dirs.length - 1]) : null;
  }
  if (!runDir) {
    console.error("没有可看的 run。先 pnpm eval:run,或用 --project <项目目录>");
    process.exit(1);
  }
  const outputs = readJsonl(path.join(runDir, "output.jsonl"));
  const scores = fs.existsSync(path.join(runDir, "scores.json"))
    ? JSON.parse(fs.readFileSync(path.join(runDir, "scores.json"), "utf8"))
    : null;
  const gradeByKey = new Map();
  for (const c of scores?.cases || []) for (const t of c.trials) gradeByKey.set(`${c.caseId}#${t.trial}`, { ...t, description: c.description });
  const sections = outputs.map((o) => ({
    key: `${o.caseId}#${o.trial}`,
    title: `${o.caseId} #${o.trial}`,
    events: readEventsDir(path.join(runDir, o.eventsRef || "", "events")),
    extra: {
      grade: gradeByKey.get(`${o.caseId}#${o.trial}`) || null,
      terminalState: o.terminalState,
      baselineNodeIds: o.baselineNodeIds,
      metrics: o.metrics,
      assistantModel: o.assistantModel,
      error: o.error,
    },
  }));
  return { name: path.basename(runDir), outPath: path.join(runDir, "viewer.html"), sections };
}

const { name, outPath, sections } = collectSections();
const data = JSON.stringify({ name, sections }).replace(/</g, "\\u003c");

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>轨迹查看器 · ${name}</title>
<style>
  :root{--ink:#1c1c1c;--ink60:#666;--ink40:#999;--paper:#fafaf8;--card:#fff;--line:#e6e3dd;--good:#2e7d32;--bad:#c62828;--accent:#3949ab}
  body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:var(--ink);background:var(--paper);margin:0;padding:24px;max-width:980px;margin-inline:auto}
  h1{font-size:18px} h2{font-size:15px;margin:8px 0}
  .section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
  .meta{color:var(--ink60);font-size:12px}
  .bubble{border-radius:10px;padding:10px 12px;margin:8px 0;white-space:pre-wrap;word-break:break-word}
  .user{background:#eef1fb;border:1px solid #d8defa}
  .agent{background:#f6f6f2;border:1px solid var(--line)}
  .sys{color:var(--ink60);font-size:12px;margin:6px 0}
  details{margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:#fcfcfa}
  details summary{cursor:pointer;font-size:13px;color:var(--ink60)}
  pre{font-size:12px;overflow:auto;max-height:280px;background:#f4f4f0;padding:8px;border-radius:6px}
  .ok{color:var(--good)} .err{color:var(--bad)}
  .node{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13px;background:#fffdf7}
  .node .t{font-weight:600}
  .annot{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}
  .annot button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 14px;cursor:pointer;font-size:13px;margin-right:8px}
  .annot button.sel-pass{background:#e8f5e9;border-color:var(--good)}
  .annot button.sel-fail{background:#ffebee;border-color:var(--bad)}
  .annot textarea{width:100%;box-sizing:border-box;min-height:52px;margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:8px;font:13px/1.5 inherit}
  .toolbar{position:sticky;top:0;background:var(--paper);padding:10px 0;border-bottom:1px solid var(--line);z-index:2;display:flex;gap:12px;align-items:center}
  .toolbar button{border:1px solid var(--accent);color:var(--accent);background:#fff;border-radius:6px;padding:6px 16px;cursor:pointer}
  .grade{font-size:13px;padding:2px 10px;border-radius:99px;display:inline-block;margin-left:8px}
  .grade.p{background:#e8f5e9;color:var(--good)} .grade.f{background:#ffebee;color:var(--bad)}
</style></head><body>
<div class="toolbar"><h1 style="margin:0;flex:1">轨迹 · ${name}</h1>
<span class="meta" id="annot-count"></span>
<button onclick="exportAnnotations()">导出标注 JSONL</button></div>
<p class="meta">标注存浏览器 localStorage;「导出」下载 JSONL 后放到 <code>evals/annotations/</code>(error analysis 与 judge 校准共用)。</p>
<div id="root"></div>
<script>
const DATA = ${data};
const LS_KEY = "nomi-eval-annotations:" + DATA.name;
const store = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(store)); document.getElementById("annot-count").textContent = Object.keys(store).length + " 条标注"; }
function esc(s){ const d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; }
function fold(summary, obj){ return '<details><summary>'+esc(summary)+'</summary><pre>'+esc(typeof obj==="string"?obj:JSON.stringify(obj,null,2))+'</pre></details>'; }

function renderEvents(events){
  let h = "";
  for (const e of events){
    const p = e.payload || {};
    switch(e.type){
      case "agent.turn.started": h += '<div class="bubble user"><b>用户</b> · '+esc(e.ts)+'\\n'+esc(p.promptHead||"")+'</div>'; break;
      case "agent.tool.proposed": h += fold("🔧 提议 "+(p.toolName||"?")+"  (seq "+e.seq+")", p.args); break;
      case "agent.proposal.approved": h += '<div class="sys ok">✓ 用户批准 (seq '+e.seq+')</div>'; break;
      case "agent.proposal.rejected": h += '<div class="sys err">✗ 用户拒绝: '+esc(p.message||"")+'</div>'; break;
      case "agent.tool.completed": h += fold((p.ok===false?"💥":"✓")+" 工具结果 "+(p.toolName||"")+" (seq "+e.seq+")", p.resultHead ?? p.message ?? p); break;
      case "agent.turn.finished": {
        const u = p.usage || {};
        h += '<div class="bubble agent"><b>AI</b> · '+(u.totalTokens? u.totalTokens+" tokens":"")+'\\n'+esc(p.finalTextHead||"")+'</div>'; break;
      }
      case "agent.turn.error": h += '<div class="bubble agent err"><b>AI 错误</b>\\n'+esc(p.message||"")+'</div>'; break;
      case "vendor.call.requested": h += fold("📡 生成请求 runId="+(p.runId||"")+" model="+(p.recipe?.modelKey||"?"), p.recipe); break;
      case "vendor.call.completed": h += '<div class="sys '+(p.status==="succeeded"?"ok":"err")+'">📡 生成'+(p.status==="succeeded"?"成功":"失败")+' runId='+esc(p.runId||"")+(p.error?(" — "+esc(p.error.category||"")):"")+'</div>'; break;
      default:
        if (String(e.type).startsWith("canvas.")) break; // 画布域瞬态太密,折叠展示无意义
        h += '<div class="sys">'+esc(e.type)+' (seq '+e.seq+')</div>';
    }
  }
  return h || '<div class="sys">(无事件)</div>';
}

function renderTerminal(extra){
  if (!extra || !extra.terminalState) return "";
  const baseline = new Set(extra.baselineNodeIds||[]);
  const created = (extra.terminalState.nodes||[]).filter(n=>!baseline.has(n.id));
  const edges = extra.terminalState.edges||[];
  let h = '<h2>画布终态(创建 '+created.length+' 节点 / '+edges.length+' 边)</h2>';
  for (const n of created){
    h += '<div class="node"><span class="t">'+esc(n.title||n.id)+'</span> <span class="meta">'+esc(n.kind)+' · '+esc(n.categoryId||"")+' · '+esc(n.meta?.modelKey||"无模型")+'</span><br>'+esc(n.prompt||"(无 prompt)")+'</div>';
  }
  return h;
}

function annotBlock(key){
  const a = store[key] || {};
  return '<div class="annot" data-key="'+esc(key)+'">'
    +'<button class="'+(a.verdict==="pass"?"sel-pass":"")+'" onclick="mark(this,\\'pass\\')">✓ pass</button>'
    +'<button class="'+(a.verdict==="fail"?"sel-fail":"")+'" onclick="mark(this,\\'fail\\')">✗ fail</button>'
    +'<span class="meta">二元判定+一句为什么(弃 1-5 分制)</span>'
    +'<textarea placeholder="critique:哪里好/哪里翻车?(给 judge few-shot 用)" oninput="note(this)">'+esc(a.critique||"")+'</textarea></div>';
}

window.mark = (btn, verdict) => {
  const key = btn.closest(".annot").dataset.key;
  store[key] = { ...(store[key]||{}), verdict, ts: new Date().toISOString() };
  btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("sel-pass","sel-fail"));
  btn.classList.add(verdict==="pass"?"sel-pass":"sel-fail");
  save();
};
window.note = (ta) => {
  const key = ta.closest(".annot").dataset.key;
  store[key] = { ...(store[key]||{}), critique: ta.value, ts: new Date().toISOString() };
  save();
};
window.exportAnnotations = () => {
  const lines = Object.entries(store).map(([key,a]) => JSON.stringify({ source: DATA.name, key, ...a }));
  const blob = new Blob([lines.join("\\n")+"\\n"], { type: "application/jsonl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "annotations-"+DATA.name+".jsonl";
  a.click();
};

const root = document.getElementById("root");
root.innerHTML = DATA.sections.map(s => {
  const g = s.extra?.grade;
  const badge = g ? '<span class="grade '+(g.pass?"p":"f")+'">'+(g.pass?"机器判 ✓":"机器判 ✗ "+esc(g.reason||""))+'</span>' : "";
  const head = '<h2 style="margin-top:0">'+esc(s.title)+(g?.description?(' <span class="meta">'+esc(g.description)+'</span>'):"")+badge+'</h2>'
    + (s.extra?.metrics ? '<div class="meta">'+Math.round((s.extra.metrics.latencyMs||0)/1000)+'s · '+(s.extra.metrics.tokens?.totalTokens||"?")+' tokens · '+esc(s.extra.assistantModel||"")+'</div>' : "");
  return '<div class="section">'+head+renderEvents(s.events)+renderTerminal(s.extra)+annotBlock(s.key)+'</div>';
}).join("");
save();
</script></body></html>`;

fs.writeFileSync(outPath, html);
console.log(`查看器已生成: ${path.relative(process.cwd(), outPath)}`);
console.log(`打开: open "${outPath}"`);
