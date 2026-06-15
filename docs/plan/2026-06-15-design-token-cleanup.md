# 设计 token 纪律根治（2026-06-15）

> 用户拍板「P1 + P2 打包根治 + 加 lint 门」。来源审计 `docs/audit/2026-06-15-full-design-review.md`。
> 策略：**先做零视觉变化的安全大头（px→token 1:1），再做有视觉影响的小头，最后上守门脚本根治整类**。分片，每片过五门 + 抽样验证。

## 分片

### S1 · 字号 1:1 迁移（零视觉变化，机械）
- 加 h2 token：`--tc-font-size-h2: 20px`（globals.css）+ tailwind config `h2` + cn.ts twMerge font-size 组注册 `h2`。
- 全仓 src tsx 替换（px 完全等于 token 值,渲染零变化）：
  `text-[12px]→text-caption` · `text-[11px]→text-micro` · `text-[13px]→text-body-sm` · `text-[14px]→text-body` · `text-[16px]→text-title` · `text-[20px]→text-h2`（~206 处）
- 验：五门 + computed-style 抽样确认尺寸不变。

### S2 · off-token 颜色 → 语义 token（~11 处，P1）
- `#b42318`/`text-red-600`/`bg-red-500` → `text-workbench-danger`/`bg-workbench-danger-soft`；`bg-blue-500`→`-info-soft`；`bg-[#f7f7f9]`→画布底 token。
- Scene3D XYZ 轴色：3D 内语义色，酌情保留并在守门 allowlist。
- 验：真机看红/蓝处颜色不突兀。

### S3 · sub-11px + 文本字形图标 + 非 4 倍数间距（P1）
- sub-11px(9/9.5/10/10.5)→`text-micro`(11)。轻微变大,真机看角标不挤。
- `×`→`IconX`、`▾▸`→`IconChevronDown/Right`（ProvenancePanel/AssetTile/AgentPlanCard/FileTreeNode/Group/CategoryItem）。
- `gap-[7px]`等非 4 倍数 → 最近标准类（7→gap-2/8、5→gap-1/4、6→gap-1.5/6 标准类非 bracket）。
- 验：真机看这些面布局没塌。

### S4 · 圆角 → token（84 处，P2）
- `rounded-[6px]→rounded-nomi-sm` `[10px]→rounded-nomi` `[14px]→rounded-nomi-lg`（1:1）。
- 非 1:1（5/8/12px 等）就近归（5→6、8→10、12→10或14 视语境）——轻微视觉,真机抽查。

### S5 · 守门脚本根治整类（结构保证 P2）
- 新 `scripts/check-design-tokens.mjs`：扫 src tsx,禁 `text-[Npx]` / `rounded-[Npx]` / hex 色 / Tailwind 默认色板 / 非 4 倍数 `*-[Npx]` 间距。
- baseline allowlist（仿 check:filesize 棘轮）：放行确实无法 token 化的（Scene3D 3D 编辑器、ProjectLibraryPage 28px 品牌 display 标题、CSS var 形式的 `text-[var(--…)]` 颜色不算违规）。棘轮只减不增。
- 接 package.json `check:design-tokens` + push 门序列 + CLAUDE.md「Push 前必过」。

## 不动项
- `text-[var(--…)]`（用 token 变量的颜色）不算违规,不动。
- Scene3DFullscreen 深度重构留后（仅迁能安全迁的,其余 allowlist）。
- 不改任何组件结构/交互,纯 className token 化。

## 回滚
分片 commit,任一片可单独 revert。S1 零视觉故最安全。

## 验收门
每片五门全过；S1 抽样 computed-style 不变；S2/S3/S4 真机抽查布局/颜色；S5 守门脚本绿 + 接入 CI。
