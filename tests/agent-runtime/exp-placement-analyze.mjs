import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = process.env.EXP_ROOT ?? fileURLToPath(new URL('../../.tmp/exp-placement/', import.meta.url));
const ARMS = ['0', 'A', 'B', 'T'];
const LABEL = { '0': '臂0 不放', 'A': '臂A 技能段之前', 'B': '臂B 技能段之后', 'T': '臂T 提示词开头' };
const REG = new Set(readFileSync(`${ROOT}/authority-block.txt`, 'utf8').split('\n')
  .filter(l => l.startsWith('- ')).map(l => l.slice(2, l.indexOf(' |'))));
// 替身行为：过期禁令「绝不调用写画布/生成类工具」被听进去时，模型改去做的那些事。
const SUBSTITUTE = new Set(['make_artifact', 'write_script', 'start_model_setup', 'bash', 'edit', 'nomi_request_tools']);
const HOST = ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'todo_write', 'nomi_request_tools'];
const CONTRA = /绝不|不得调用|不能调用|不应调用|禁止.*工具|只产出方案|不直接落画布|不落画布|矛盾|冲突|过期/;
const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };

function loadArm(arm) {
  // 一次遍历认两种文件：trials-* 是落盘的试次，budget-* 记的是含「被掐断那一次未落盘试次」
  // 在内的真实花费（取它做花费上界）。两种的臂名匹配规则相同，所以没必要走两遍目录。
  const trials = new Map(); let spent = 0, budget = 0;
  for (const f of readdirSync(ROOT)) {
    const m = /^(trials|budget)-(.+)\.json$/.exec(f); if (!m) continue;
    if (m[2] !== arm && !m[2].startsWith(arm + '-')) continue;
    const d = JSON.parse(readFileSync(`${ROOT}/${f}`, 'utf8'));
    if (m[1] === 'budget') { budget += d.spentCny ?? 0; continue; }
    spent += d.spentCny ?? 0;
    for (const t of d.trials ?? []) trials.set(t.index, t);
  }
  return { trials: [...trials.values()].sort((a, b) => a.index - b.index), spent, budget };
}

const out = [];
for (const arm of ARMS) {
  const { trials, spent, budget } = loadArm(arm);
  if (!trials.length) { console.log(`ARM ${arm}: (no data)`); continue; }
  let draftT1 = 0, draftAny = 0, textOnlyT1 = 0, badName = 0, allCalls = 0,
      argsFirstOK = 0, argsTried = 0, mentions = 0, trialErrs = 0;
  const surv = []; const reqPerTurn = []; const reqPerTrial = []; const detail = [];
  for (const t of trials) {
    if (t.trialError) trialErrs++;
    const turns = t.turns ?? [];
    const c1 = turns[0]?.calls ?? [];
    const cAll = turns.flatMap(x => x.calls ?? []);
    const rAll = turns.flatMap(x => x.results ?? []);
    allCalls += cAll.length;
    badName += cAll.filter(c => !REG.has(c.name) && !HOST.includes(c.name)).length;
    if (c1.some(c => c.name === 'draft_shots')) draftT1++;
    if (cAll.some(c => c.name === 'draft_shots')) draftAny++;
    if (!c1.length) textOnlyT1++;
    const fd = rAll.find(r => r.name === 'draft_shots');
    if (fd) { argsTried++; if (!fd.isError) argsFirstOK++; }
    if (CONTRA.test(turns.map(x => x.assistantText ?? '').join('\n'))) mentions++;
    let s = 0; for (const tn of turns) { reqPerTurn.push(tn.httpCalls); s += tn.httpCalls; } reqPerTrial.push(s);
    // 偏离点：第一次「替身工具出现在 draft_shots 之前」；从未调 draft_shots 的，偏离点记在序列末尾+1（停手）
    const names = cAll.map(c => c.name);
    const firstDraft = names.indexOf('draft_shots');
    let dev = Infinity;
    for (let k = 0; k < names.length; k++) {
      if (firstDraft >= 0 && k >= firstDraft) break;
      if (SUBSTITUTE.has(names[k])) { dev = k + 1; break; }
    }
    if (dev === Infinity && firstDraft < 0) dev = names.length + 1;
    for (let n = 1; n <= Math.max(names.length, dev === Infinity ? 0 : dev); n++) {
      surv[n - 1] ??= { at: 0, ok: 0 };
      if (names.length >= n || dev === n) { surv[n - 1].at++; if (dev > n) surv[n - 1].ok++; }
    }
    detail.push({ i: t.index, seq: names.join('>'), dev: dev === Infinity ? '-' : dev });
  }
  out.push({ arm, n: trials.length, draftT1, draftAny, textOnlyT1, badName, allCalls, argsFirstOK, argsTried,
    mentions, trialErrs, spent, budget, surv, detail,
    reqTurnMed: med(reqPerTurn), reqTurnMax: Math.max(...reqPerTurn), reqTurnCap: reqPerTurn.filter(x => x >= 12).length,
    reqTurnN: reqPerTurn.length, reqTrialMed: med(reqPerTrial), reqTrialMax: Math.max(...reqPerTrial) });
}
const pct = (a, b) => b ? ` (${(100 * a / b).toFixed(0)}%)` : '';
console.log('| 指标 | ' + out.map(o => LABEL[o.arm]).join(' | ') + ' |');
console.log('|---|' + out.map(() => '---|').join(''));
const row = (name, fn) => console.log(`| ${name} | ` + out.map(fn).join(' | ') + ' |');
row('试次 n', o => o.n);
row('**整场调过写工具 draft_shots**', o => `${o.draftAny}/${o.n}${pct(o.draftAny, o.n)}`);
row('第 1 轮就调了 draft_shots', o => `${o.draftT1}/${o.n}${pct(o.draftT1, o.n)}`);
row('工具名写对（在注册表内/总调用）', o => `${o.allCalls - o.badName}/${o.allCalls}${pct(o.allCalls - o.badName, o.allCalls)}`);
row('draft_shots 参数一次就对', o => `${o.argsFirstOK}/${o.argsTried}${pct(o.argsFirstOK, o.argsTried)}`);
row('第 1 轮只回文字没动手', o => `${o.textOnlyT1}/${o.n}`);
row('先掏替身工具（未调 draft 就 make_artifact 等）', o => `${o.n - o.draftAny}/${o.n}`);
row('回复里复述那条过期禁令/提到矛盾', o => `${o.mentions}/${o.n}${pct(o.mentions, o.n)}`);
row('试次级异常', o => o.trialErrs);
row('花费(CNY，落盘试次)', o => '¥' + o.spent.toFixed(2));
row('花费(CNY，含被掐断的在飞试次)', o => '¥' + o.budget.toFixed(2));
console.log('\n### 模型请求次数（每回合上限被 harness 钳在 12）');
row('每回合中位数 / 最大 / 撞上限次数', o => `${o.reqTurnMed} / ${o.reqTurnMax} / ${o.reqTurnCap}/${o.reqTurnN}`);
row('每试次（两回合合计）中位数 / 最大', o => `${o.reqTrialMed} / ${o.reqTrialMax}`);
console.log('\n### 第 N 次工具调用时仍未偏离（未偏离数/走到 N 的试次数）');
const maxD = Math.max(...out.map(o => o.surv.length));
console.log('| N | ' + out.map(o => LABEL[o.arm]).join(' | ') + ' |');
console.log('|---|' + out.map(() => '---|').join(''));
for (let i = 0; i < Math.min(maxD, 16); i++) {
  console.log(`| ${i + 1} | ` + out.map(o => o.surv[i] ? `${o.surv[i].ok}/${o.surv[i].at}${pct(o.surv[i].ok, o.surv[i].at)}` : '—').join(' | ') + ' |');
}
console.log('\n### 两比例差的双侧 Fisher 精确检验（整场调过 draft_shots）');
function logf(n){let s=0;for(let i=2;i<=n;i++)s+=Math.log(i);return s;}
function fisher(a,b,c,d){const N=a+b+c+d;
  const p=(x)=>Math.exp(logf(a+b)-logf(x)-logf(a+b-x)+logf(c+d)-logf(a+c-x)-logf(c+d-(a+c-x))+logf(a+c)+logf(b+d)-logf(N));
  const lo=Math.max(0,a+c-(c+d)), hi=Math.min(a+b,a+c); const obs=p(a); let s=0;
  for(let x=lo;x<=hi;x++){const v=p(x); if(v<=obs*1.0000001) s+=v;} return Math.min(1,s);}
for (const key of ['draftAny', 'draftT1']) {
  console.log(`-- 终点：${key === 'draftAny' ? '整场调过 draft_shots' : '第 1 轮就调 draft_shots'}`);
  for (const [x, y] of [['B','A'],['A','0'],['B','0'],['T','0']]) {
    const ox = out.find(o => o.arm === x), oy = out.find(o => o.arm === y);
    if (!ox || !oy) continue;
    const p = fisher(ox[key], ox.n - ox[key], oy[key], oy.n - oy[key]);
    console.log(`- ${LABEL[x]} ${ox[key]}/${ox.n} vs ${LABEL[y]} ${oy[key]}/${oy.n} → p=${p.toFixed(3)} ${p < 0.05 ? '显著' : '不显著'}`);
  }
}
console.log('\n### 逐试次轨迹（dev = 第几次调用开始偏离，- = 全程未偏离）');
for (const o of out) for (const d of o.detail) console.log(o.arm, `dev=${d.dev}`, d.seq);
