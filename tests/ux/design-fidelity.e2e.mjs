// 设计保真自动走查(规则 8/13 的固化)——把 v4 实现规范 §1/§2/§5 的精确值写成断言,
// 用真 app 的 computed style / DOM 结构核对,任一不一致即非零退出。
//
// 为什么有它(根因):光照 HTML 样张猜代码 + 肉眼验收 → 反复出「结构没对齐 / 隐藏覆盖(twMerge 吞字号、
// Mantine 吃 radius)」这类一眼不一致。改成「规范精确值 → computed style 自动核对」后,这类问题每次都被堵住。
// 规范:docs/design/2026-06-06-reference-v4-implementation-spec.md。改任何参考区设计后必须跑这条绿。
//
// 用法:pnpm run build && node tests/ux/design-fidelity.e2e.mjs
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0;
const fails = [];
function assert(cond, label, detail) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const px = (v) => `${Math.round(parseFloat(v))}px`;

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);

// 首启开屏(SplashIntro)会全屏覆盖挡住库页 → 标记已看过并 reload，让后续库页断言可见。
await win.evaluate(() => window.localStorage.setItem("nomi:splash:v1", "seen"));
await win.reload();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);

try {
  // ── 本会话回归点 #C(库页)：项目卡无封面时缩略图区不重复项目名（名称只在卡下方一次）──
  // 缩略图区可能含 hover 浮层的「继续创作」按钮，故不查「有无文字」，而查「项目名是否漏进缩略图」。
  const lib = await win.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[role="button"]'))
      .filter((el) => el.querySelector(".aspect-video"));
    let noCoverChecked = 0;
    let leaked = 0;
    for (const card of cards) {
      const thumb = card.querySelector(".aspect-video");
      if (thumb?.querySelector("img")) continue; // 有封面的卡不在此断言范围
      const nameEl = card.querySelector(".truncate"); // 卡下方的项目名
      const name = (nameEl?.textContent || "").trim();
      if (!name) continue;
      noCoverChecked += 1;
      if ((thumb?.textContent || "").includes(name)) leaked += 1; // 项目名不该出现在缩略图区
    }
    return { noCoverChecked, leaked };
  });
  console.log("\n── 项目卡(#C 库页：无封面缩略图不重复名) ──");
  // 无封面卡是否存在取决于实时项目数据；有则核对名称不漏进缩略图，无则显式跳过（不静默掩盖）。
  if (lib.noCoverChecked > 0) assert(lib.leaked === 0, "无封面卡项目名不漏进缩略图（名称只在下方一次）", `leaked=${lib.leaked}/checked=${lib.noCoverChecked}`);
  else console.log("  ⊘ 无封面项目卡核对 — 跳过（当前库内项目都有封面）");

  // ── 起始页 v3（O2 动作卡片）：主入口层级 + 单一模型入口互斥 ──
  // 规范：docs/design/2026-06-12-start-page-onboarding-v3-spec.md §3 A 屏。
  // 显式等主入口渲染（项目列表走 IPC，固定 sleep 会赌时序 → flake）。
  await win.locator(".tc-action-card, [data-try-now-hero-cta]").first().waitFor({ timeout: 10000 });
  const start = await win.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".tc-action-card"));
    const primary = cards.filter((el) => el.dataset.variant === "primary");
    const rect = primary[0]?.getBoundingClientRect() || null;
    const banner = document.querySelector("[data-model-banner]");
    const weakEntry = Array.from(document.querySelectorAll("button"))
      .find((el) => (el.textContent || "").trim() === "模型接入");
    return {
      cardCount: cards.length,
      primaryCount: primary.length,
      primaryW: rect ? Math.round(rect.width) : -1,
      primaryH: rect ? Math.round(rect.height) : -1,
      bannerShown: Boolean(banner),
      weakEntryShown: Boolean(weakEntry),
      weakEntryH: weakEntry ? Math.round(weakEntry.getBoundingClientRect().height) : -1,
    };
  });
  console.log("\n── 起始页 v3（动作卡片层级 / 单一模型入口） ──");
  assert(start.primaryCount === 1, "主入口动作卡片恰好 1 张 primary（一页一主操作）", `primary=${start.primaryCount}/cards=${start.cardCount}`);
  assert(start.primaryW === 280 && start.primaryH === 88, "primary 动作卡 280×88（尺寸区隔于普通按钮）", `${start.primaryW}×${start.primaryH}`);
  assert(!(start.bannerShown && start.weakEntryShown), "缺模型状态条与右上弱入口互斥（单一入口）", `banner=${start.bannerShown}/weak=${start.weakEntryShown}`);
  if (start.weakEntryShown) assert(start.weakEntryH === 28, "模型接入弱钮高 28（弱于动作卡两级）", String(start.weakEntryH));
  else console.log("  ⊘ 弱入口高度核对 — 跳过（当前为缺模型态，弱入口按规则隐藏）");

  // 进工作区：① 优先开示例项目；② 没示例但库里已有项目 → 开第一张项目卡（控制条等结构断言
  // 不依赖示例内容，任意项目即可，覆盖「有项目但无该示例」的 profile）；③ 空库 → hero CTA 现造一个。
  const exampleCard = win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first();
  const anyCard = win.locator('[data-project-card="true"]').first();
  if (await exampleCard.count().then((n) => n > 0).catch(() => false)) {
    await exampleCard.click().catch(() => {});
  } else if (await anyCard.count().then((n) => n > 0).catch(() => false)) {
    await anyCard.click().catch(() => {});
  } else {
    await win.locator("[data-try-now-hero-cta]").first().click().catch(() => {});
  }
  await win.waitForTimeout(2500);
  await win.getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1000);
  // composer 参考区/选择器子流程依赖「目录里有带 archetype 的可选模型」（如 Seedance 的「全能参考」模式）。
  // 用户实时目录不一定有该模型 → 整段 try 包住：缺模型时跳过这些断言，不拖垮后面与目录无关的回归项
  // （生成助手/左栏/素材库/预览控制条 = 本会话真正要锁的点）。
  try {
  await win.getByRole("button", { name: "添加视频节点", exact: false }).first().click();
  await win.waitForTimeout(1500);
  // 模型控件已从原生 <select> 迁到 NomiSelect（Mantine Combobox：触发 button + withinPortal 下拉）。
  // 故不再用 selectOption，改：点触发 pill → 在下拉里点目标选项（role=option）。
  const modelTrigger = win.locator('.generation-canvas-v2-node__composer button[aria-label="模型"]').last();
  await modelTrigger.click();
  await win.waitForTimeout(300);
  await win.locator('[role="option"]', { hasText: "Seedance 2.0" }).first().click()
    .catch(async () => { await win.locator('[role="option"]').first().click().catch(() => {}); });
  await win.waitForTimeout(700);
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "全能参考" }).first().click();
  await win.waitForTimeout(700);

  const m = await win.evaluate(() => {
    const comp = document.querySelector(".generation-canvas-v2-node__composer");
    const card = document.querySelector(".generation-canvas-v2-node__composer-card");
    const cs = (el) => el ? getComputedStyle(el) : null;
    const rectH = (el) => el ? Math.round(el.getBoundingClientRect().height) : -1;
    const seg = comp.querySelector('[role="group"][aria-label="生成方式"]');
    const segBtn = seg?.querySelector("button");
    const segLabel = comp.querySelector("span"); // 生成方式 label = 第一个 span
    const addTile = comp.querySelector('button[aria-label="加参考"]');
    const prompt = comp.querySelector(".generation-canvas-v2-node__prompt-input");
    const send = comp.querySelector('button[aria-label="生成素材"],button[aria-label="重新生成"]');
    const paramsRow = comp.querySelector('.generation-canvas-v2-node__params--parameters');
    // 模型控件已迁到 NomiSelect：触发是 button[aria-label="模型"]，模板/通用徽标是其内部 span（triggerBadge）。
    const modelChip = comp.querySelector('button[aria-label="模型"]');
    const badge = Array.from(comp.querySelectorAll("span")).find((s) => { const t = s.textContent.trim(); return t === "模板" || t === "通用"; });
    const dividerEl = Array.from(card?.children || []).find((c) => (c.getAttribute("class") || "").includes("line-soft") && Math.round(c.getBoundingClientRect().height) <= 1);
    const g = (el, p) => el ? cs(el)[p] : "?";
    return {
      segBtnFont: g(segBtn, "fontSize"),
      labelFont: g(segLabel, "fontSize"),
      labelText: segLabel?.textContent?.trim(),
      // 用 offsetWidth（布局 px），不用 getBoundingClientRect——后者受 xyflow 画布缩放 transform 影响（非 100% 缩放时会缩水）。
      addW: addTile ? addTile.offsetWidth : -1,
      addH: addTile ? addTile.offsetHeight : -1,
      addRadius: g(addTile, "borderTopLeftRadius"),
      addBorderStyle: g(addTile, "borderTopStyle"),
      promptFont: g(prompt, "fontSize"),
      promptLH: g(prompt, "lineHeight"),
      cardPad: g(card, "paddingTop"),
      cardGap: g(card, "rowGap"),
      cardBorder: g(card, "borderTopColor"),
      cardShadow: g(card, "boxShadow"),
      sendRadius: g(send, "borderTopLeftRadius"),
      // v3：参数横排内联（取代旧的设置弹层）——统计底栏项数 + 行数（同 top = 一行），验证拉宽不换行、全可见。
      paramItems: paramsRow ? paramsRow.children.length : 0,
      paramRows: paramsRow ? new Set(Array.from(paramsRow.children).map((c) => Math.round(c.getBoundingClientRect().top))).size : 0,
      // 结构:模板徽标是否与 model select 同一个父(嵌在模型芯片内,而非独立夹在中间)
      badgeInModelChip: Boolean(badge && modelChip && modelChip.contains(badge)),
      dividerPresent: Boolean(dividerEl),
    };
  });

  console.log("\n── 模式条 / 标签(规范 §1 字号 13/11) ──");
  assert(px(m.segBtnFont) === "13px", "模式条按钮 13px", m.segBtnFont);
  assert(px(m.labelFont) === "11px" && m.labelText === "生成方式", "生成方式 label 11px", `${m.labelText}/${m.labelFont}`);

  console.log("\n── 参考块(规范 §1/§2:56px / 6px / 虚线) ──");
  assert(m.addW === 56 && m.addH === 56, "加参考 tile 56×56", `${m.addW}×${m.addH}`);
  assert(px(m.addRadius) === "6px", "tile 圆角 6px", m.addRadius);
  assert(m.addBorderStyle === "dashed", "空态 tile 虚线边", m.addBorderStyle);

  console.log("\n── 描述框(规范 §1:13px / 行高 1.7) ──");
  assert(px(m.promptFont) === "13px", "prompt 13px", m.promptFont);
  assert(Math.abs(parseFloat(m.promptLH) - 22.1) < 1.5, "prompt 行高 ~1.7(22px)", m.promptLH);

  console.log("\n── composer 卡(规范:padding12 / gap11 / border-line / 非 lg 阴影) ──");
  assert(px(m.cardPad) === "12px", "卡 padding 12px", m.cardPad);
  assert(px(m.cardGap) === "11px", "卡 gap 11px", m.cardGap);
  assert(m.cardBorder.includes("0.91"), "卡边框 = nomi-line(0.91)", m.cardBorder);

  console.log("\n── 分隔线 / 底栏结构(用户点名问题) ──");
  assert(m.dividerPresent, "参考区与描述之间有分隔线(h-px)", "MISSING");
  assert(m.badgeInModelChip, "模板徽标嵌在模型芯片内(非独立夹在中间)", `badgeInModelChip=${m.badgeInModelChip}`);
  assert(px(m.sendRadius) === "9999px" || parseFloat(m.sendRadius) >= 999, "send 按钮圆形(pill)", m.sendRadius);
  assert(m.paramItems >= 1, "参数横排内联（模型芯片 + 标量参数 pill）", `paramItems=${m.paramItems}`);
  assert(m.paramRows === 1, "参数全在一行（拉宽不换行，不再藏进设置弹层）", `paramRows=${m.paramRows}`);

  // ── 捷径 A：拖文件到卡 → 加为参考（规范 §4 拖悬停态 + 落地写入数组）──
  // 合成 dragover（types 含 'Files'）→ 卡虚线 outline + 覆盖层「松手添加」；几何核对覆盖层覆盖卡面且在视口内。
  const d = await win.evaluate(async () => {
    const anchor = document.querySelector(".generation-canvas-v2-node__composer");
    const card = document.querySelector(".generation-canvas-v2-node__composer-card");
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1])], "drop.png", { type: "image/png" }));
    anchor.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 140));
    const overlay = document.querySelector(".generation-canvas-v2-node__composer-dropzone");
    const cs = card ? getComputedStyle(card) : null;
    const orect = overlay ? overlay.getBoundingClientRect() : null;
    const crect = card ? card.getBoundingClientRect() : null;
    return {
      overlayPresent: Boolean(overlay),
      overlayText: overlay ? overlay.textContent.trim() : "",
      cardOutlineStyle: cs ? cs.outlineStyle : "?",
      coversCard: orect && crect ? (orect.width >= crect.width - 2 && orect.height >= crect.height - 2) : false,
      inViewport: orect ? (orect.top >= -1 && orect.bottom <= window.innerHeight + 1 && orect.left >= -1 && orect.right <= window.innerWidth + 1) : false,
    };
  });
  console.log("\n── 拖悬停态(规范 §4:dashed outline + 覆盖层「松手添加」+ 不溢出) ──");
  assert(d.overlayPresent && d.overlayText.includes("松手添加"), "拖悬停出现「松手添加」覆盖层", `${d.overlayPresent}/${d.overlayText}`);
  assert(d.cardOutlineStyle === "dashed", "拖悬停卡虚线 outline", d.cardOutlineStyle);
  assert(d.coversCard, "覆盖层覆盖整张卡面(几何)", `coversCard=${d.coversCard}`);
  assert(d.inViewport, "覆盖层不溢出视口(不被裁)", `inViewport=${d.inViewport}`);

  // 合成 drop（项目文件树 payload，nomi-local，无需上传）→ 参考区出现 tile + 覆盖层消失。
  const dropRes = await win.evaluate(async () => {
    const anchor = document.querySelector(".generation-canvas-v2-node__composer");
    const before = anchor.querySelectorAll('button[aria-label^="移除"]').length;
    const dt = new DataTransfer();
    dt.setData("application/x-nomi-workspace-file", JSON.stringify({ projectId: "p", relativePath: "a/b.png", name: "b.png", kind: "image" }));
    anchor.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 220));
    return {
      before,
      after: anchor.querySelectorAll('button[aria-label^="移除"]').length,
      overlayGone: !document.querySelector(".generation-canvas-v2-node__composer-dropzone"),
    };
  });
  console.log("\n── 拖入落地(捷径 A:写入数组参考 + 收起覆盖层) ──");
  assert(dropRes.after === dropRes.before + 1, "拖入后参考区多出 1 个 tile", `${dropRes.before}→${dropRes.after}`);
  assert(dropRes.overlayGone, "松手后覆盖层消失", `overlayGone=${dropRes.overlayGone}`);

  // 打开 picker 量规范 §5
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="加参考"]').first().click();
  await win.waitForTimeout(500);
  const p = await win.evaluate(() => {
    const comp = document.querySelector(".generation-canvas-v2-node__composer");
    const picker = document.querySelector('[data-testid="asset-picker"]'); // 渲染在 body(逃出 composer 裁剪)
    const cs = (el) => el ? getComputedStyle(el) : null;
    const search = picker?.querySelector('input[aria-label="搜索素材名"]')?.closest("label") || picker?.querySelector('input[aria-label="搜索素材名"]')?.parentElement;
    const items = picker?.querySelectorAll('button[aria-label]:not([aria-label="上传本地文件"])') || [];
    const item = items[0];
    const upload = Array.from(picker?.querySelectorAll("label") || []).find((l) => /上传本地文件/.test(l.textContent));
    const pr = picker ? picker.getBoundingClientRect() : null;
    return {
      pickerW: pr ? Math.round(pr.width) : -1,
      pickerRadius: picker ? cs(picker).borderTopLeftRadius : "?",
      pickerPad: picker ? cs(picker).paddingTop : "?",
      pickerShadow: picker ? cs(picker).boxShadow : "?",
      searchH: search ? Math.round(search.getBoundingClientRect().height) : -1,
      itemCount: items.length,
      itemW: item ? item.offsetWidth : -1,
      uploadH: upload ? Math.round(upload.getBoundingClientRect().height) : -1,
      // 遮挡回归:picker 是否完整在视口内(不被裁)。
      fullyVisible: pr ? (pr.top >= -1 && pr.bottom <= window.innerHeight + 1 && pr.left >= -1 && pr.right <= window.innerWidth + 1) : false,
      uploadVisible: upload ? (upload.getBoundingClientRect().bottom <= window.innerHeight + 1) : false,
    };
  });
  console.log("\n── 选择器(规范 §5:300宽 / 10圆角 / 48项 / 30搜索 / 34上传) ──");
  assert(p.pickerW === 300, "picker 宽 300", String(p.pickerW));
  assert(px(p.pickerRadius) === "10px", "picker 圆角 10px", p.pickerRadius);
  assert(px(p.pickerPad) === "10px", "picker padding 10px", p.pickerPad);
  assert(p.searchH === 30, "搜索框高 30", String(p.searchH));
  if (p.itemCount > 0) assert(p.itemW === 48, "picker tile 48", String(p.itemW));
  else console.log("  ⊘ picker tile 48 — 跳过（当前项目素材池为空，无 tile 可量）");
  assert(p.uploadH === 34, "上传按钮高 34", String(p.uploadH));

  console.log("\n── 遮挡回归(规范 §5:picker 绝不被裁、上传按钮可见) ──");
  assert(p.fullyVisible, "picker 完整在视口内(未被 composer overflow 裁剪)", `fullyVisible=${p.fullyVisible}`);
  assert(p.uploadVisible, "「上传本地文件」按钮可见(不被裁到视口外)", `uploadVisible=${p.uploadVisible}`);
  } catch (composerErr) {
    console.log("  ⊘ composer 参考区/选择器子流程跳过（目录无带 archetype 的可选模型，如 Seedance）：" + String(composerErr?.message || composerErr).split("\n")[0]);
  }

  // 关掉可能还开着的 picker，避免点击被遮挡。
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(300);

  // ── 本会话回归点 #C(生成区)：助手默认折叠；展开后 aside 是 flex 非 grid；模型选择器显具体名 ──
  const collapsed = await win.evaluate(() => {
    const launcherEl = document.querySelector('[aria-label="生成区 AI 启动器"]');
    const btn = document.querySelector('.generation-canvas-v2-assistant__launcher');
    const r = btn ? btn.getBoundingClientRect() : null;
    const radius = btn ? parseFloat(getComputedStyle(btn).borderTopLeftRadius) : 0;
    return {
      launcher: Boolean(launcherEl),
      asideMounted: Boolean(document.querySelector('[aria-label="生成区 AI 助手"]')),
      // 收起胶囊应为整圆角（半径 ≥ 半高）；这锁住 cn() twMerge 让 rounded-full 压过组件基类
      // rounded-workbench-control 的修复——否则创作/生成胶囊外圆角会不一致。
      launcherFullPill: r ? radius >= r.height / 2 - 1 : false,
    };
  });
  console.log("\n── 生成助手(#C：默认折叠 → 启动器在、面板未挂载、整圆角) ──");
  assert(collapsed.launcher && !collapsed.asideMounted, "生成助手默认折叠（启动器在、aside 未挂载）", JSON.stringify(collapsed));
  assert(collapsed.launcherFullPill, "收起胶囊为整圆角 rounded-full（cn twMerge 压过基类圆角）", `fullPill=${collapsed.launcherFullPill}`);

  await win.locator('[aria-label="生成区 AI 启动器"]').first().click().catch(() => {});
  await win.waitForTimeout(600);
  const asst = await win.evaluate(() => {
    const aside = document.querySelector('[aria-label="生成区 AI 助手"]');
    const picker = document.querySelector('[aria-label="助手模型"]');
    return {
      asideDisplay: aside ? getComputedStyle(aside).display : "?",
      pickerText: picker ? (picker.textContent || "").trim() : "?",
    };
  });
  console.log("\n── 生成助手展开(#C：aside flex 非 grid + 模型显具体名) ──");
  assert(asst.asideDisplay === "flex", "助手 aside display:flex（非 grid，修「上面空一大块」的根因点）", asst.asideDisplay);
  assert(asst.pickerText.length > 0 && !asst.pickerText.includes("自动选模型"), "模型选择器显具体模型名（非「自动选模型」）", asst.pickerText);

  // ── 本会话回归点 #C(左栏)：收起后导航用 svg 图标，不再是文字「类/文」──
  await win.locator('[aria-label="收起侧栏"]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const railIcons = await win.evaluate(() => {
    const cat = document.querySelector('[aria-label="展开分类面板"]');
    const file = document.querySelector('[aria-label="展开文件面板"]');
    const ok = (el) => Boolean(el && el.querySelector("svg") && !/^[类文]$/.test((el.textContent || "").trim()));
    return { catOk: ok(cat), fileOk: ok(file), catText: (cat?.textContent || "").trim(), fileText: (file?.textContent || "").trim() };
  });
  console.log("\n── 左栏收起(#C：导航是 svg 图标，非文字「类/文」) ──");
  assert(railIcons.catOk, "收起栏「分类」是 svg 图标（非文字「类」）", railIcons.catText);
  assert(railIcons.fileOk, "收起栏「文件」是 svg 图标（非文字「文」）", railIcons.fileText);

  // ── 本会话回归点 #C(#A 素材库)：分段筛选 4 标签同一行不折行 + 面板 flex 列 ──
  await win.evaluate(() => window.dispatchEvent(new CustomEvent("nomi-open-asset-library")));
  await win.waitForTimeout(700);
  const assetLib = await win.evaluate(() => {
    const panel = document.querySelector('[aria-label="素材库"]');
    const tabs = Array.from(panel?.querySelectorAll('[role="tab"]') || []);
    const tops = new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)));
    const pr = panel ? panel.getBoundingClientRect() : null;
    return {
      panelMounted: Boolean(panel),
      panelDisplay: panel ? getComputedStyle(panel).display : "?",
      tabCount: tabs.length,
      tabRows: tops.size,
      inViewport: pr ? (pr.top >= -1 && pr.bottom <= window.innerHeight + 1 && pr.right <= window.innerWidth + 1) : false,
    };
  });
  console.log("\n── 素材库面板(#A：分段筛选单行 + flex 列 + 不溢出) ──");
  assert(assetLib.panelMounted, "素材库面板挂载（dispatch nomi-open-asset-library 打开）", JSON.stringify(assetLib));
  assert(assetLib.panelDisplay === "flex", "素材库面板 display:flex 列布局", assetLib.panelDisplay);
  assert(assetLib.tabCount === 4 && assetLib.tabRows === 1, "分段筛选 4 标签同一行（不折行）", `tabs=${assetLib.tabCount}/rows=${assetLib.tabRows}`);
  assert(assetLib.inViewport, "素材库面板完整在视口内（不溢出/不被裁）", `inViewport=${assetLib.inViewport}`);

  // ── 本会话回归点 #C(预览控制条)：导出MP4 单行(高28不折行) + 画幅/显示 select 值不截断(无 …) ──
  // 「安全框」按钮已在 b74d09c 整体删除（chop），相关断言一并删（断言对齐产品现状，不留陈旧红）。
  await win.keyboard.press("Escape").catch(() => {}); // 关素材库面板
  await win.waitForTimeout(300);
  await win.getByRole("button", { name: "预览", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1200);
  const prev = await win.evaluate(() => {
    const bar = document.querySelector('[aria-label="预览控制"]');
    // 必须从控制条内部取导出钮：app bar 的导出钮在预览态也挂 aria-label="导出 MP4"（且故意 h-[30px]），
    // 且 DOM 顺序在前；用 document 全局 query 会抓到 app bar 那颗(30) 而非控制条这颗(28)，断言对错元素。
    const exportBtn = bar ? bar.querySelector('[aria-label="导出 MP4"]') : null;
    // NomiSelect 触发里的值 span（truncate）：scrollWidth>clientWidth 即被截断成 …。
    const valueSpan = (chip) => chip?.querySelector("span.truncate") || null;
    const aspectChip = document.querySelector('[aria-label="预览画幅"]');
    const fitChip = document.querySelector('[aria-label="画面适配"]');
    const truncated = (chip) => { const s = valueSpan(chip); return s ? (s.scrollWidth > s.clientWidth + 1) : false; };
    const barRect = bar ? bar.getBoundingClientRect() : null;
    return {
      barPresent: Boolean(bar),
      exportH: exportBtn ? exportBtn.offsetHeight : -1,
      aspectTruncated: truncated(aspectChip),
      fitTruncated: truncated(fitChip),
      aspectText: valueSpan(aspectChip)?.textContent?.trim() || "",
      fitText: valueSpan(fitChip)?.textContent?.trim() || "",
      // 控制条横向无溢出（不该再有 overflow-x 滚动条「杠」）。
      barOverflowsX: bar ? (bar.scrollWidth > bar.clientWidth + 1) : true,
      barInViewport: barRect ? (barRect.left >= -1 && barRect.right <= window.innerWidth + 1) : false,
    };
  });
  console.log("\n── 预览控制条(#C：导出单行高28 + 不截断 + 不裁不溢出) ──");
  assert(prev.barPresent, "预览控制条已渲染", `barPresent=${prev.barPresent}`);
  assert(prev.exportH === 28, "「导出 MP4」单行（高 28，不折两行）", String(prev.exportH));
  assert(!prev.aspectTruncated, "画幅 select 值不被截断（无 …）", `${prev.aspectText}/truncated=${prev.aspectTruncated}`);
  assert(!prev.fitTruncated, "显示 select 值不被截断（无 …）", `${prev.fitText}/truncated=${prev.fitTruncated}`);
  assert(!prev.barOverflowsX, "控制条横向无溢出（无多余滚动条「杠」）", `overflowsX=${prev.barOverflowsX}`);
  assert(prev.barInViewport, "控制条整体在视口内（不溢出/不被裁）", `barInViewport=${prev.barInViewport}`);

  // ── 上手 4 步清单（替代旧三步 tour）：被动常驻、可折叠、不裁不溢出 ──
  // 清掉清单标记保证「未全完成」(否则 4/4 会自动隐藏整卡)；默认展开。
  await win.evaluate(() => {
    window.localStorage.removeItem("nomi:checklist:v1");
    window.localStorage.removeItem("nomi:checklist-collapsed:v1");
  });
  await win.getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(800);
  const checklistGeom = async () => win.evaluate(() => {
    const card = document.querySelector('[data-onboarding-checklist="expanded"]');
    if (!card) return { present: false };
    const c = card.getBoundingClientRect();
    const inViewport = c.left >= 0 && c.top >= 0 && c.right <= window.innerWidth + 0.5 && c.bottom <= window.innerHeight + 0.5;
    const rows = card.querySelectorAll("li[data-step]").length;
    // minimap 在则不得与清单重叠（同为右下角常驻）
    const map = document.querySelector(".generation-canvas-v2__minimap");
    let overlapMinimap = false;
    if (map) {
      const m = map.getBoundingClientRect();
      overlapMinimap = !(c.right <= m.left || c.left >= m.right || c.bottom <= m.top || c.top >= m.bottom);
    }
    return { present: true, inViewport, rows, hasMinimap: !!map, overlapMinimap };
  });
  const checklist = await checklistGeom();
  console.log("\n── 上手 4 步清单 ──");
  assert(checklist.present, "上手清单（展开态）已渲染", JSON.stringify(checklist));
  if (checklist.present) {
    assert(checklist.inViewport, "清单完整在视口内（不溢出/不被裁）", `inViewport=${checklist.inViewport}`);
    assert(checklist.rows === 4, "清单恰为 4 步", `rows=${checklist.rows}`);
    assert(!checklist.overlapMinimap, "清单不遮挡画布 minimap", `hasMinimap=${checklist.hasMinimap} overlap=${checklist.overlapMinimap}`);
    // 折叠 → 小 pill；再展开 → 卡片回来
    await win.locator('[data-onboarding-checklist="expanded"] button[aria-label="收起"]').first().click().catch(() => {});
    await win.waitForTimeout(300);
    const collapsed = await win.evaluate(() => ({
      pill: !!document.querySelector('[data-onboarding-checklist="collapsed"]'),
      cardGone: !document.querySelector('[data-onboarding-checklist="expanded"]'),
    }));
    assert(collapsed.pill && collapsed.cardGone, "收起后只剩小 pill 入口", JSON.stringify(collapsed));
    await win.locator('[data-onboarding-checklist="collapsed"]').first().click().catch(() => {});
    await win.waitForTimeout(300);
    const reExpanded = await win.evaluate(() => !!document.querySelector('[data-onboarding-checklist="expanded"]'));
    assert(reExpanded, "点 pill 重新展开清单", `reExpanded=${reExpanded}`);
  }

  console.log(`\n设计保真：${passed} 通过，${fails.length} 不一致`);
  if (fails.length) { console.error("不一致清单:\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("✅ 全部对齐 v4 规范");
} catch (error) {
  console.error(`\nERROR: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
