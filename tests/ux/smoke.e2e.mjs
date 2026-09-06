// Playwright _electron 冒烟 e2e（规则 13/14）—— 可断言、可重复、零额度。
// 启动构建产物 → 断言主链路的关键 UI 真实渲染（项目库 → 开项目 → 画布工具栏/导出入口）。
// 任一断言失败即抛错、非零退出（CI-ready）。不触发真实 AI 生成/导出（不花额度）。
//
// 用法：pnpm run build && pnpm run test:e2e
import { launchNomiApp } from "./_launchApp.mjs";
import { addCanvasNodeFromRail } from "./_canvasRail.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "nomi-smoke-e2e-"));
const userDataDir = path.join(tempRoot, "user-data");
const projectsDir = path.join(tempRoot, "projects");
const evidenceDir = path.resolve("outputs/canvas-smoke");
mkdirSync(projectsDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const { app, win } = await launchNomiApp({
  name: "smoke",
  userDataDir: userDataDir,
  settingsDir: userDataDir,
  projectsDir: projectsDir,
  env: { NOMI_E2E_SMOKE: "1" },
});
const rendererDiagnostics = [];
win.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    rendererDiagnostics.push({ type: `console.${message.type()}`, text: message.text() });
  }
});
win.on("pageerror", (error) => {
  rendererDiagnostics.push({ type: "pageerror", text: error?.stack || error?.message || String(error) });
});

try {

  // 1) 主进程启动 + 渲染层加载（runtime.ts 拆分后的回归底线）
  assert((await win.title()).toLowerCase().includes("nomi"), "窗口标题含 Nomi");

  // 1b) 内置模型 seed 在启动时生效（ensureBuiltinModelSeeds）——Seedance 开箱在目录里、带 archetypeId。
  const seed = await win.evaluate(() => {
    const mc = window.nomiDesktop?.modelCatalog;
    if (!mc) return { ok: false };
    const seedance = mc.listModels({ kind: "video", enabled: true }).find((m) => m.modelKey === "bytedance/seedance-2");
    return {
      ok: true,
      hasKie: mc.listVendors().some((v) => v.key === "kie"),
      archetypeId: seedance?.meta?.archetypeId ?? null,
      hasMapping: mc.listMappings().some((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video"),
    };
  });
  assert(seed.ok && seed.hasKie, "启动后目录里有内置 kie vendor（seed 生效）");
  assert(seed.archetypeId === "seedance-2", "Seedance 模型在位且 meta.archetypeId=seedance-2");
  assert(seed.hasMapping, "(kie, image_to_video) mapping 在位");

  // 2) 项目库渲染（渲染 → IPC listProjects → projects/repository 真实数据）
  // 空库与有项目走同一套布局：主入口动作卡片「新建空白项目」恒在（hero 介绍首屏已删）。
  await win.getByText("项目库", { exact: false }).first().waitFor({ timeout: 8000 });
  const primaryCard = win.locator('[data-variant="primary"]', { hasText: "新建空白项目" });
  assert((await primaryCard.count()) > 0, "项目库主入口动作卡片「新建空白项目」可见");

  // 3) 开项目 → 工作台画布（开项目 → readProject/资产 → 画布挂载）
  // 优先打开已有项目卡（不污染库）；空库时走「新建空白项目」。
  const projectCard = win.locator("[data-project-card]").first();
  if ((await projectCard.count()) > 0) {
    await projectCard.click();
  } else {
    await win.getByText("新建空白项目", { exact: false }).first().click();
  }
  await win.waitForTimeout(2500);
  // 「导出」在控件层级梳理（U 系列）里拆成诚实的「去出片」跳转钮（预览页隐藏，真导出=预览页「导出 MP4」）
  for (const name of ["创作", "生成", "预览", "去出片"]) {
    assert(await win.getByRole("button", { name, exact: false }).first().isVisible(), `工作台工具栏「${name}」可见`);
  }
  assert(/projectId=/.test(win.url()), "工作台 URL 含 projectId");

  // 4) 生成画布 composer：超长提示词必须在编辑区内部滚动、底栏生成钮永远可点
  //（回归 2026-07-15：滚动容器无高度上限 → 长 prompt 溢出盖住底栏，提交钮点不到）。
  await win.getByRole("button", { name: "生成", exact: false }).first().click();
  await win.waitForTimeout(800);
  const flowNodeCountBeforeAdd = await win.locator('.react-flow__node[data-id]').count();
  await win.locator('button[aria-label="添加图片节点"]').first().click();
  const flowNode = win.locator('.react-flow__node[data-id]').last();
  await flowNode.waitFor({ timeout: 5000 });
  const flowNodeCountAfterAdd = await win.locator('.react-flow__node[data-id]').count();
  assert(
    flowNodeCountAfterAdd === flowNodeCountBeforeAdd + 1,
    `mount 后添加图片节点使画布节点计数 +1（${flowNodeCountBeforeAdd} → ${flowNodeCountAfterAdd}）`,
  );
  const flowNodeId = await flowNode.getAttribute('data-id');
  await win.waitForFunction((nodeId) => {
    const outer = Array.from(document.querySelectorAll('.react-flow__node[data-id]'))
      .find((candidate) => candidate.getAttribute('data-id') === nodeId);
    const card = outer?.querySelector('.generation-canvas-v2-node');
    return Boolean(card && !card.hasAttribute('data-appear'));
  }, flowNodeId, { timeout: 2000 });
  const nodeGeometry = await flowNode.evaluate((outer) => {
    const inner = outer.querySelector('.generation-canvas-v2-node');
    const outerRect = outer.getBoundingClientRect();
    const innerRect = inner?.getBoundingClientRect();
    return {
      outer: { left: outerRect.left, top: outerRect.top, width: outerRect.width, height: outerRect.height },
      inner: innerRect ? { left: innerRect.left, top: innerRect.top, width: innerRect.width, height: innerRect.height } : null,
      innerInlineTransform: inner instanceof HTMLElement ? inner.style.transform : null,
    };
  });
  assert(Boolean(nodeGeometry.inner), "新增图片节点挂载真实业务卡片");
  assert(
    Math.abs(nodeGeometry.inner.left - nodeGeometry.outer.left) < 2 &&
      Math.abs(nodeGeometry.inner.top - nodeGeometry.outer.top) < 2 &&
      !nodeGeometry.innerInlineTransform,
    "React Flow 节点弹入结束后只定位一次（业务卡片与外层左上角对齐）",
  );
  const composer = win.locator(".generation-canvas-v2-node__composer-card").first();
  await composer.waitFor({ timeout: 5000 });
  const longPrompt = Array.from({ length: 14 }, (_, i) => `第${i + 1}段：超长提示词溢出回归压测，逐行填满编辑区直到超过卡片高度上限，验证底栏不被盖住。`).join("\n");
  const promptInput = composer.locator(".generation-canvas-v2-node__prompt-input").first();
  await promptInput.click();
  await promptInput.fill(longPrompt);
  await win.waitForTimeout(500);
  // 画布平移：把 composer 拉进「AppBar 之下、窗口底之上」的可视带（节点落点随机，卡可能伸出窗口
  // → elementFromPoint 打在视口外恒 null，误报被挡）。wheel 落在远离卡片的空白区。
  for (let i = 0; i < 6; i++) {
    const box = await composer.boundingBox();
    if (!box) break;
    const vp = await win.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
      appbarBottom: document.querySelector(".nomi-appbar")?.getBoundingClientRect().bottom ?? 0,
    }));
    let dy = 0;
    if (box.y < vp.appbarBottom + 8) dy = box.y - (vp.appbarBottom + 8);
    else if (box.y + box.height > vp.h - 16) dy = Math.min(box.y + box.height - (vp.h - 16), box.y - (vp.appbarBottom + 8));
    if (Math.abs(dy) < 4) break;
    await win.mouse.move(vp.w - 80, Math.max(vp.appbarBottom + 40, 200));
    await win.mouse.wheel(0, dy);
    await win.waitForTimeout(250);
  }
  const composerCheck = await composer.evaluate((card) => {
    const editorEl = card.querySelector(".generation-canvas-v2-node__prompt-input");
    let scroller = editorEl;
    while (scroller && scroller !== card && !/(auto|scroll)/.test(window.getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scrolls = Boolean(scroller && scroller !== card && scroller.scrollHeight > scroller.clientHeight);
    const btn = card.querySelector('button[aria-label="生成素材"], button[aria-label="重新生成"]');
    const r = btn?.getBoundingClientRect();
    const hitEl = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return { scrolls, btnClickable: Boolean(btn && hitEl && (btn === hitEl || btn.contains(hitEl))) };
  });
  assert(composerCheck.scrolls, "超长提示词在编辑区内部滚动（不撑爆卡片）");
  assert(composerCheck.btnClickable, "超长提示词下生成钮 hit-test 可点（底栏未被溢出文字盖住）");

  // 5) 3D 导演台：右栏「整运镜→轨迹」点「新建」→ 轨迹属性面板必须即时激活
  //（回归 2026-08-04：createdId 从 setState updater 里往外带，依赖 React eager-eval 才同步执行；
  // 「新建」handler 先 setTimelineOpen(true) 把 fiber 弄脏 → updater 推迟 → active 从未设置 →
  // 面板永远停在「请选择一条轨迹」，用户被迫再去时间轴点一次「轨迹1」行）。
  await win.evaluate(() => window.localStorage.setItem("nomi.onboarding.scene3dCoach.v1", "seen"));
  // 3D 场景自 2026-09-06「第三档」起住在左缘的「更多」里；点法收口在 _canvasRail，找不到当场抛。
  await addCanvasNodeFromRail(win, "scene3d");
  await win.waitForTimeout(1200);
  // 新节点落点不定（画布已被上一段平移过），Playwright actionability 可能够不着 → DOM click 兜底
  await win.locator('[aria-label="打开 3D 编辑器"]').first().click({ timeout: 3000 })
    .catch(() => win.evaluate(() => document.querySelector('[aria-label="打开 3D 编辑器"]')?.click()));
  await win.waitForTimeout(3000);
  const coachSkip = win.locator('[data-coach-skip="true"]').first();
  if (await coachSkip.count()) {
    await coachSkip.click({ timeout: 1500 }).catch(() => win.evaluate(() => {
      const button = document.querySelector('[data-coach-skip="true"]');
      if (button instanceof HTMLElement) button.click();
    }));
    await coachSkip.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  }
  await win.getByRole("button", { name: "轨迹", exact: true }).first().click();
  await win.waitForTimeout(400);
  await win.getByRole("button", { name: "新建", exact: true }).first().click();
  await win.waitForTimeout(800);
  const trajectoryPanel = await win.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return {
      // setTimelineOpen 是普通布尔 setter 永远成功 → 修复前时间轴已有「轨迹1」行而面板未激活，
      // 两个断言拆开才能把「建成了但没激活」与「压根没建成」分开。
      rowExists: buttons.some((b) => /^轨迹\d/.test((b.textContent || "").trim())),
      appendPointVisible: buttons.some((b) => (b.textContent || "").includes("追加点")),
      stillPlaceholder: Boolean(document.body.textContent?.includes("请选择一条轨迹")),
    };
  });
  assert(trajectoryPanel.rowExists, "3D 轨迹「新建」后时间轴出现「轨迹1」行（轨迹已创建）");
  assert(
    trajectoryPanel.appendPointVisible && !trajectoryPanel.stillPlaceholder,
    "3D 轨迹「新建」后属性面板即时激活（「追加点」可见、无「请选择一条轨迹」占位，无需再点时间轴行）",
  );

  console.log(`\nSMOKE PASS: ${passed} assertions`);
  await finishAndExit(0);
} catch (error) {
  const diagnostic = {
    error: error?.stack || error?.message || String(error),
    url: win.url(),
    rendererDiagnostics,
    alerts: await win.getByRole("alert").allTextContents().catch(() => []),
    nodes: await win.locator('.react-flow__node[data-id]').evaluateAll((nodes) => nodes.map((node) => {
      const inner = node.querySelector('.generation-canvas-v2-node');
      const outerRect = node.getBoundingClientRect();
      const innerRect = inner?.getBoundingClientRect();
      return {
        id: node.getAttribute('data-id'),
        outer: { left: outerRect.left, top: outerRect.top, width: outerRect.width, height: outerRect.height },
        inner: innerRect ? { left: innerRect.left, top: innerRect.top, width: innerRect.width, height: innerRect.height } : null,
        innerTransform: inner instanceof HTMLElement ? inner.style.transform : null,
      };
    })).catch(() => []),
  };
  writeFileSync(path.join(evidenceDir, "failure.json"), JSON.stringify(diagnostic, null, 2));
  await win.screenshot({ path: path.join(evidenceDir, "failure.png") }).catch(() => undefined);
  console.error(`\n${error?.message || error}`);
  await finishAndExit(1);
}

// 断言已判定即成败——但 electron teardown 在部分环境会 hang（app.close() 永不 resolve）或让 node 带非零码
// 收尾，两者都会让串跑（test:system release）误判本 stage：hang → 整条卡死，非零 → 挡掉后续 stage。
// 故给 close 3s 超时兜底、随后强制退出确定的码：既尽量清干净 electron，又保证进程一定退、退出码可信。
async function finishAndExit(code) {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
  process.exit(code);
}
