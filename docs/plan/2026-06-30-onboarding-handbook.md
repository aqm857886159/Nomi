# 新手上手手册（一份内容 · 两处出口）

> 2026-06-30。补现有引导缺的「能转发的一页 + App 内可查阅帮助」那层。
> 现状已有：首页「60 秒回放」（首胜）+ 顶栏「上手 4 步」清单（进度）。
> 缺口：① 能截图发群/挂官网的一页速查 ② App 内随时可查的帮助页 ③ 0.16 的 3D 操控/Agnes 免费两个新招牌没进任何引导。

## 范围

**做**：
1. `src/workbench/onboarding/handbookContent.ts` —— 唯一内容源（纯数据+文案，无 React）。四块：
   - `PIPELINE`：写故事→AI拆分镜→落画布→锁身份/运镜→时间轴→导出 MP4（一行图）
   - `FIRST_WIN`：90 秒首胜 4 步（看回放 / 接模型 / 写一句+拆镜 / 生成+导出）
   - `INTENT_ROUTES`：「我想做 X→走哪」对照（身份锁/站位/3D操控[新]/Agnes免费[新]/字幕/⚠️唇形同步暂无）
   - `GOTCHAS`：卡住自查 4 条（缺文本大脑/脸不一致/档位闸/导出静音）
2. `src/workbench/onboarding/HandbookPanel.tsx` —— App 内 overlay。**照 `SkillLibraryPanel` 同款**：mantine `Portal` 居中模态 + ESC 关闭 + `{opened,onClose}` props + token-only。读 `handbookContent`。
3. 接线（照 skill-library 同口径）：
   - `NomiAppBar` 右簇加 ghost 按钮「上手手册」(`IconBook2`) → `dispatchEvent('nomi-open-handbook')`
   - `NomiStudioApp` 监听 `nomi-open-handbook` → `setHandbookOpened(true)`；`lazyWithChunkBoundary` 挂 `HandbookPanel`
4. `scripts/build-handbook-html.mjs` —— 读同一份 `handbookContent` → 渲成独立 `marketing/handbook.html`（自包含、明暗、可截图发群+挂官网）。`package.json` 加 `build:handbook`。

**不动**：现有首页回放 JourneyTour、上手 4 步清单（它们是首胜+进度，手册是「查阅+发群」，三者互补不重叠，不删不改）。AboutNomiPopover 不塞手册（它是版本/外观/更新的家，职责分清）。

## 关键决策

- **单源机制 = 内容数据 + 两个薄渲染器**（用户拍板 C）。React overlay 与 marketing html 共享 `handbookContent.ts`；脚本经 `tsx`/esbuild 读 TS。改文案只改一处。
- **复用不平行**（P1）：overlay 外壳照搬 SkillLibraryPanel 的 Portal+模态结构，不新造一套弹层；appbar 按钮照搬现有 ghost 按钮样式与事件驱动开法。
- **诚实标缺口**（D4）：唇形同步当场标 ⚠️ 暂无。

## 回滚

纯新增 + 一颗按钮。回滚 = 删 4 个新文件 + appbar 按钮 + NomiStudioApp 监听块；现有引导不受影响。

## 验收门

- 五门全过（filesize→tokens→lint→typecheck→test→build）
- R13 真机走查：开 App→点顶栏「上手手册」→overlay 正常弹出/四块齐/明暗都对/ESC 关；截图人眼判断
- `pnpm build:handbook` 出 `marketing/handbook.html`，浏览器打开版式正确、可截图
- 两处内容一致（同源，改 `handbookContent` 一处验证两边变）
