# 2026-07-22 · 收编 4 个社区 PR（#47 / #48 / #49 / #50）

用户 2026-07-22 拍板：四个 open PR 全收。本文件锚住执行策略与 #50 的冲突解法。

## 冲突拓扑（已实测 merge-tree dry-run）

- **#47 / #48 / #49 三者互不重叠**，且各自**干净可合到 origin/main**。
- **#50（i18n，311 文件）与三者全撞**，且与 main 有 ~26 冲突文件：
  - #50 ∩ #49 → `NodeGenerationComposer.tsx`
  - #50 ∩ #47 → `CreationAiPanel.tsx`
  - #50 ∩ #48 → 10 个 onboarding/electron 文件
  - **modify/delete**：`browserAssetLibraryStorage.ts`、`BrowserPromptAssetCards.tsx` 在 main 已被 `dfc47477`（素材面二次收敛）删除，#50 还在改 → 取删除、i18n 意图贴到新结构。

## 执行策略：分两批 push（先落稳的，#50 单独啃）

### 批次 1 — #47 + #49 + #48（干净合）
- 分支 `integrate-batch1` 钉 origin/main，`git merge --no-ff` 依次合三个（保署名）。
- 五门 `pnpm run gates` 全过。
- 真机走查（R13，用户可见）：
  - #47：创作助手面板注入超宽串 → 右边缘不再裁切（对应 issue #46 根因分析验收）。
  - #48：ComfyUI 导入面板下拉可展开、删除/编辑按钮在位（有真 workflow_api.json 则跑导入）。
  - #49：光标语义（cursor 非截图可验，走查确认不回归 + 逻辑审）。
- `git push origin integrate-batch1:main`（push 前 fetch 对账，main 被并行狂改）。

### 批次 2 — #50（i18n）单独
- 新集成分支钉「批次 1 落地后的」origin/main，`git merge --no-ff pr-50` → 一次性解 ~26 冲突。
- 冲突解法：i18n 字符串→key 的改动接受；碰 main 的素材面重构以 **main 新结构为准**，把 key 化补到新文件；modify/delete 取删除。
- **验 `check:i18n` 门**：确认它真强制两语言完整性（缺翻译即红）——这是「持续维护负担变结构保证」的关键，用户当初不做 i18n 就担心这个。
- 五门全过 + 双语走查（zh↔en 切换在创作/画布/时间轴/3D/浏览器/模型接入各面生效）。
- push main。

## 验收门
- 每批 `pnpm run gates` 全绿（filesize→tokens→dangling→archetype→secrets→lint→typecheck→test→build）。
- 用户可见改动过 R13 真机走查（截图自己 Read）。
- 保留贡献者署名（--no-ff 合并提交）。

## 回滚
- 每批独立 push；批次 1 落地不依赖 #50。#50 若解冲突后发现结构性问题（i18n 门形同虚设 / 重构冲突太深），停下上报，不硬合。
