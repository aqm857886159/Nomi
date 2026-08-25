// R16 真实用户任务测试（剧本 → 拆镜头方案）：验证阿泽方法论集成（P1/P2/P3#2）在真实规划师输出里生效。
// 走真实 app 栈 + 真实已连文本模型（复用 app 已配 key 自解密），用**我编辑过的**
// `workbench.storyboard.planner` 技能跑一段带台词+动作+运镜的真戏，捕获 propose_storyboard_plan 的
// 方案 shots，把每镜的 durationSec / prompt 打出来供人眼判断（R16 = 真任务 + 眼见链，不做脆断言）。
//
// 观察点（我方法论该在输出里留下的痕迹）：
//   ① 时长不再一律 5s（演时换算：台词/动作算出的秒数，不同镜不同）；
//   ② prompt 物理化（愤怒/发颤 → 眉/颌/喉/手/呼吸 的具体动作，不写抽象情绪词）；
//   ③ 运镜写成模型认得的措辞（缓缓推近 → 「镜头缓慢向前推近」）。
//
// **只到方案阶段**（收到 propose 即拒绝、不写画布、不生成），只花极少文本额度。
// 额度闸：不显式 NOMI_R16=1 就 SKIP。用法：pnpm run build && NOMI_R16=1 node tests/ux/storyboard-methodology.walk.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import { mkdirSync, mkdtempSync, copyFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";


if (!process.env.NOMI_R16) {
  console.log("SKIP storyboard-methodology.walk: 会花少量文本额度。NOMI_R16=1 node tests/ux/storyboard-methodology.walk.mjs 才跑（用 app 已连文本模型）。");
  process.exit(0);
}

// 隔离的 userData（不撞用户真项目/真运行实例），但拷进真 model-catalog.json 复用已连模型 +
// safeStorage 加密 key（同机同用户可解密）。真 skills 从仓内 skills/ 加载，不需拷。
const realSettings = process.env.NOMI_SETTINGS_DIR || path.join(os.homedir(), "Library/Application Support/Nomi");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "nomi-r16-"));
const userDataDir = path.join(tempRoot, "user-data");
const projectsDir = path.join(tempRoot, "projects");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(projectsDir, { recursive: true });
const realCatalog = path.join(realSettings, "model-catalog.json");
if (existsSync(realCatalog)) copyFileSync(realCatalog, path.join(userDataDir, "model-catalog.json"));
else { console.log(`SKIP: 找不到真 model-catalog.json（${realCatalog}）——app 里接一个文本大脑再跑。`); process.exit(0); }

// 一段有「台词长度 + 动作 beat + 运镜 + 情绪」的真戏——给演时换算/物理化/运镜翻译足够材料。
const STORY =
  "深夜面馆。老陈盯着空荡的店面，慢慢擦着桌子。门帘一挑，多年未见的女儿走进来。" +
  "老陈手一顿，抬头，声音发颤：「你……回来了。这些年，你过得好不好？」" +
  "女儿站在门口没动，眼眶红了，喉咙动了动却没说出话。镜头从老陈颤抖的手缓缓推近到他湿润的眼睛。";

const { app, win } = await launchNomiApp({
  name: "storyboard-methodology",
  userDataDir: userDataDir,
  settingsDir: userDataDir,
  projectsDir: projectsDir,
  args: ["--disable-gpu", "--disable-software-rasterizer"],
});

try {

  // 找一个已连的文本模型（vendor+modelKey）当 agent 主控。
  const brain = await win.evaluate(async () => {
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；先 await 才能使用数组方法。
    const models = (await window.nomiDesktop.modelCatalog.listModels?.()) || [];
    const text = (models || []).find((m) => m.enabled && (m.kind === "text" || m.meta?.kind === "text"));
    return text ? { vendorKey: text.vendorKey || text.vendor, modelKey: text.modelKey || text.model } : null;
  });
  if (!brain) {
    console.log("SKIP: 没找到已连的文本模型（app「模型接入」里接一个文本大脑再跑）。");
    await app.close(); process.exit(0);
  }
  console.log(`▶ 用文本大脑 ${brain.vendorKey} · ${brain.modelKey} 跑拆镜头（skill=workbench.storyboard.planner）\n`);

  const outcome = await win.evaluate(async ({ brain, story }) => {
    const prompt =
      `这是**视频分镜**。把下面这段戏拆成分镜，必须调用 propose_storyboard_plan 工具产出结构化方案` +
      `（每个视频镜头填 durationSec 时长、把运镜和物理化的动作/表情写进 prompt），不要只用文字回答。\n\n剧本：\n${story}`;
    const { sessionId } = await window.nomiDesktop.agents.chatV2Start({
      prompt,
      sessionKey: "r16-storyboard-methodology",
      skillKey: "workbench.storyboard.planner",
      mode: "auto",
      agentModelKey: brain.modelKey,
      agentVendorKey: brain.vendorKey,
    });
    return await new Promise((resolve) => {
      const seen = { plan: null, toolName: "", error: "", done: false };
      const off = window.nomiDesktop.agents.onChatV2Event(sessionId, (ev) => {
        if (!ev) return;
        if ((ev.type === "tool-call" || ev.type === "tool-call-pending")) {
          seen.toolName = ev.toolName || "";
          if (ev.toolName === "propose_storyboard_plan" && ev.args) seen.plan = ev.args;
          // 捕到方案就拒绝收尾（不写画布、省额度）。
          if (ev.type === "tool-call-pending" && ev.toolCallId) {
            window.nomiDesktop.agents.confirmTool(sessionId, ev.toolCallId, { ok: false, denied: true, message: "r16: captured, reject to end" });
          }
        }
        if (ev.type === "error") seen.error = ev.message || "unknown";
        if (ev.type === "done") { seen.done = true; off?.(); resolve(seen); }
      });
      setTimeout(() => { off?.(); resolve(seen); }, 120000);
    });
  }, { brain, story: STORY });

  if (outcome.error && !outcome.plan) { console.log(`✗ agent 出错：${outcome.error}`); await app.close(); process.exit(1); }
  if (!outcome.plan) { console.log(`✗ 没捕到 propose_storyboard_plan 方案（toolName=${outcome.toolName || "无"}）。`); await app.close(); process.exit(1); }

  // 打印方案供人眼判断（R16 眼见链）。
  const plan = outcome.plan;
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  console.log(`═══ 方案「${plan.title || "(无题)"}」· ${shots.length} 镜 · anchors ${(plan.anchors || []).length} 个 ═══\n`);
  const durs = [];
  for (const s of shots) {
    durs.push(s.durationSec);
    console.log(`  [S${s.index}] ${s.durationSec}s  ${s.shotKind || ""}`);
    console.log(`     prompt: ${String(s.prompt || "").slice(0, 200)}`);
  }
  // 软观察（不脆断言，供我判断）：时长是否多样、运镜/物理化词是否出现。
  const uniqueDurs = [...new Set(durs.filter((d) => typeof d === "number"))];
  const allText = shots.map((s) => String(s.prompt || "")).join(" ");
  // 运镜措辞：匹配运动动词本身（横移/推近/抬升…）或「镜头…移/推/拉/升/降/摇」，别要求「镜头」紧跟动词
  //（真实输出如「镜头从店内沿桌边极慢横移」会被过严的正则漏掉——2026-08-01 R16 首跑发现并修）。
  const hasCameraPhrase = /(横移|推近|推进|拉[远近]|后退|环绕|抬升|下降|俯拍|仰拍|跟拍|摇镜|升降|镜头[^。]{0,12}[移推拉升降摇])/.test(allText);
  const hasPhysical = /(眉|颌|喉结|瞳孔|呼吸|嘴唇|肩|指|手[微颤])/.test(allText);
  const hasAbstractEmotion = /(愤怒地|焦虑地|深情地|悲伤地|开心地|紧张地)/.test(allText);
  console.log(`\n── 方法论观察（人眼复核用）──`);
  console.log(`  时长多样（非一律同值）：${uniqueDurs.length > 1 ? "✓" : "⚠ 全同"} (${uniqueDurs.join("/")})`);
  console.log(`  运镜翻译成措辞：${hasCameraPhrase ? "✓" : "⚠ 未见"}`);
  console.log(`  物理化身体信号：${hasPhysical ? "✓" : "⚠ 未见"}`);
  console.log(`  抽象情绪词残留：${hasAbstractEmotion ? "⚠ 有" : "✓ 无"}`);

  await app.close();
  process.exit(0);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
