// L2 LLM-judge(analytic rubric,Lane A)。铁律(Hamel critique-shadowing):
//   judge 未对人工标注校准(P/R≥80%)之前,它的判决只展示参考,绝不计入 pass。
//
// 分工(Lane A 核心):客观项(数量/参数/连线结构/长度)归 grading.mjs 规则,免费且已有;
// judge 只评规则查不了的「质量」四维,每维 1-5 档带锚点,逐维独立打分(analytic,非 holistic 单分)。
// 这样能定位「回归在哪一维」,也不拿昂贵 judge 去判规则早能判的东西。
//
// 配置(用户一次性提供便宜档模型,不进仓库): evals/judge.config.json
//   { "baseUrl": "https://api.xxx.com/v1", "apiKey": "sk-…", "model": "gpt-…-mini" }
//   防 self-preference:judge 模型尽量选与被测 agent 不同家族的(避免偏袒自家产出)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./httpProxy.mjs"; // 让 node fetch 走系统代理(否则 vendor 直连被墙超时)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG_PATH = path.join(repoRoot, "evals", "judge.config.json");

/**
 * 容错解析 grader 输出:有的模型(尤其 Claude)即便要求 json_object 仍把 JSON 裹在 ```json 围栏里,
 * 或前后带说明文字。先剥围栏、再抓首个 {…} 块,最后 JSON.parse。解析不出仍冒泡 error(不静默当 fail)。
 */
export function parseJsonLoose(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const brace = s.match(/\{[\s\S]*\}/);
  const candidate = brace ? brace[0] : s;
  // 常见畸形修复:裸控制字符(字符串内字面换行/Tab,JSON 不允许)、对象/数组尾逗号。
  const repair = (str) => str.replace(/[\x00-\x1f]+/g, " ").replace(/,(\s*[}\]])/g, "$1");
  for (const c of [s, candidate, repair(candidate)]) {
    try {
      return JSON.parse(c);
    } catch {
      /* 试下一种 */
    }
  }
  throw new Error(`grader 输出非 JSON: ${candidate.slice(0, 140)}`);
}

/** 共享:POST chat/completions 取 JSON,解析失败自动重试一次(畸形 JSON 多为偶发)。单写者:judge+VLM 共用。 */
export async function postChatJson(cfg, body) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await fetch(`${String(cfg.baseUrl).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || "";
    try {
      return parseJsonLoose(text);
    } catch (error) {
      lastErr = error; // 解析失败 → 重试一次(温度 0 但畸形多偶发);仍失败才冒泡
    }
  }
  throw lastErr || new Error("grader 输出解析失败");
}

export function loadJudgeConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (cfg.baseUrl && cfg.apiKey && cfg.model) return cfg;
  } catch {
    /* fallthrough */
  }
  return null;
}

/** few-shot 来自人工 critique(evals/annotations/*.jsonl);没有就零样例起步。 */
export function loadFewshots(limit = 6) {
  const dir = path.join(repoRoot, "evals", "annotations");
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const a = JSON.parse(line);
        if (a.verdict && a.critique) rows.push(a);
      } catch {
        /* skip */
      }
    }
  }
  // pass/fail 各取一半,防 judge 学成单边
  const pass = rows.filter((r) => r.verdict === "pass").slice(0, Math.ceil(limit / 2));
  const fail = rows.filter((r) => r.verdict === "fail").slice(0, Math.floor(limit / 2));
  return [...pass, ...fail];
}

/**
 * 拆镜头质量四维(analytic rubric)。每维 1-5 档,锚点写清各档啥样——让 judge「对着标准打第几档」,
 * 比直接吐模糊小数稳得多。客观项(参数/数量/连线)不在这里,归 grading.mjs 规则。
 */
export const QUALITY_DIMENSIONS = [
  {
    key: "faithfulness",
    name: "忠实原文",
    desc: "镜头是否覆盖了文案的关键情节/卖点,没遗漏、没瞎编文案外的情节",
    anchors: { 5: "关键节点全覆盖,无遗漏无杜撰", 3: "覆盖主线但漏了次要节点,或轻微发挥", 1: "明显漏掉关键情节,或大量编造文案没有的内容" },
  },
  {
    key: "generatable",
    name: "画面可生成",
    desc: "每个镜头是否写成「画得出来的具体画面」(主体/环境/动作/镜头/光线),而非抽象口号或内心戏",
    anchors: { 5: "每个镜头都是具体可拍画面", 3: "约一半镜头偏抽象或只有概括", 1: "基本是内心戏/口号,模型生成不出来" },
  },
  {
    key: "continuity",
    name: "叙事连续",
    desc: "镜头按文案顺序连成一个有节奏的小故事,无跳跃断裂",
    anchors: { 5: "顺序连贯、节奏成立", 3: "大体连贯但有 1-2 处跳跃", 1: "镜头打乱或彼此割裂,不成故事" },
  },
  {
    key: "consistency",
    name: "跨镜一致",
    desc: "同一主体(角色/产品)与画风在各镜头描述里保持一致(决定生成出来像不像一个片子)",
    anchors: { 5: "主体外观与画风跨镜一致", 3: "主体一致但画风/细节偶有漂移", 1: "同一主体在不同镜头描述矛盾(如镜1橘猫镜3黑猫)" },
  },
];

/** 维度 1-5 档 → 0-1 归一(画质量分卡用):1→0, 3→0.5, 5→1。 */
export function normalizeDimensionScore(score) {
  const s = Math.max(1, Math.min(5, Number(score) || 1));
  return +((s - 1) / 4).toFixed(3);
}

// 任一维度低于此档即判该组拆镜头质量不过关(转正后才计入 pass)。
export const QUALITY_PASS_THRESHOLD = 3;

/** 兼容旧引用:把四维 rubric 文字化(校准/few-shot 提示里可读)。 */
export const STORYBOARD_RUBRIC = QUALITY_DIMENSIONS
  .map((d, i) => `${i + 1}. ${d.name}——${d.desc}(5档=${d.anchors[5]};1档=${d.anchors[1]})`)
  .join("\n");

function buildRubricBlock() {
  return QUALITY_DIMENSIONS
    .map((d) => `- ${d.key}「${d.name}」：${d.desc}\n    5档：${d.anchors[5]} ｜ 3档：${d.anchors[3]} ｜ 1档：${d.anchors[1]}`)
    .join("\n");
}

/**
 * 调 OpenAI-compatible chat completions 评一条拆镜头结果。
 * 返回 { scores:{维度:1-5}, normalized:{维度:0-1}, qualityScore:0-1, pass:boolean, reason, dimensions:[...] }。
 * 向后兼容:仍带 .pass(任一维度 < 阈值即 false)与 .reason,eval-score / calibrate 无需改调用。
 */
export async function judgeOne(cfg, { userMessage, createdNodes, fewshots = [] }) {
  const shots = createdNodes.map((n, i) => `镜头${i + 1}《${n.title || ""}》: ${n.prompt || "(无提示词)"}`).join("\n");
  const fewshotText = fewshots
    .map((f) => `<Example verdict="${f.verdict}">${String(f.critique).slice(0, 300)}</Example>`)
    .join("\n");
  const keys = QUALITY_DIMENSIONS.map((d) => d.key);
  const body = {
    model: cfg.model,
    temperature: 0,
    stream: false, // 有的 relay(如 apimart)默认流式 → res.json() 会拿到 SSE 解析失败
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是视频创作领域的资深评审。逐维度按 Rubric 给这组拆镜头结果打分,每维 1-5 档(对着锚点判该打第几档)。" +
          "reason 务必简短(不超过 80 字、一句话概括,不要分点长篇),否则后续解析会出错。打分铁律:① 不要因为提示词写得长就给高分——长而空洞应低分;" +
          "② 拿不准时给保守(偏低)分;③ 只评质量四维,不评数量/参数是否填齐(那由规则另查)。" +
          `只输出 JSON: {"reason": string, "scores": {${keys.map((k) => `"${k}": 1-5`).join(", ")}}}。` +
          (fewshotText ? `\n以下是领域专家过往判例口径,对齐它:\n${fewshotText}` : ""),
      },
      {
        role: "user",
        content: `<UserRequest>${userMessage}</UserRequest>\n<Output>\n${shots}\n</Output>\n<Rubric 逐维度 1-5 档>\n${buildRubricBlock()}\n</Rubric>`,
      },
    ],
  };
  // 解析失败自动重试一次(畸形 JSON 偶发);仍失败冒泡 error,不静默当 fail(promptfoo 纪律)。
  const parsed = await postChatJson(cfg, body);
  if (!parsed.scores || typeof parsed.scores !== "object") {
    throw new Error(`judge 输出缺 scores 字段: ${text.slice(0, 120)}`);
  }
  const scores = {};
  const normalized = {};
  for (const d of QUALITY_DIMENSIONS) {
    const raw = Number(parsed.scores[d.key]);
    if (!Number.isFinite(raw)) throw new Error(`judge 输出缺维度 ${d.key}: ${text.slice(0, 120)}`);
    scores[d.key] = Math.max(1, Math.min(5, raw));
    normalized[d.key] = normalizeDimensionScore(scores[d.key]);
  }
  const dims = QUALITY_DIMENSIONS.map((d) => d.key);
  const qualityScore = +(dims.reduce((s, k) => s + normalized[k], 0) / dims.length).toFixed(3);
  const pass = dims.every((k) => scores[k] >= QUALITY_PASS_THRESHOLD);
  return { scores, normalized, qualityScore, pass, reason: String(parsed.reason || ""), dimensions: dims };
}
