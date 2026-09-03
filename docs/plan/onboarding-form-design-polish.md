# 加模型表单 — 设计打磨方案（对照 Nomi 设计系统）

> 裁决：已被现行模型设置/发现流程取代；证据：`src/ui/onboarding/OnboardingWizard.tsx:6-26`、`docs/plan/2026-08-16-model-settings-approved-implementation.md:26-32`。

> 功能已跑通（预设/拉取/测试/保存全 OK）。这轮纯视觉/体验，逐条对照
> `docs/design/nomi-design-system.md` 找违规与噪音。

## 诊断（每条标注违反的设计系统条款）

| # | 问题 | 违反/依据 | 改法 |
|---|---|---|---|
| 1 | 右上角浮着 `●○○`（手搓的 `ProgressDots`），位置怪、跟标题/X 挤，用户当成 bug | ① 设计系统已有 `NomiStepper`（§3.9）做步骤指示，手搓=重复造轮子；② 更根本：加模型是**单页表单**不是 1→2→3 流程，进度点**无行动价值=噪音**（原则 §1 密度优先 / 规则2） | **直接删** ProgressDots。不是流程，不需要步骤指示 |
| 2 | 选中的 Kimi chip 是**亮蓝**（Mantine 默认色）| §2.1「❌ Tailwind/Mantine 默认色板」；选中态应是 `--nomi-accent` / `--nomi-accent-soft` | chip 选中 = `--nomi-accent-soft` 底 + `--nomi-accent` 文/边 |
| 3 | 用了 Mantine 原生 `SegmentedControl` / `Chip`，没走 design 封装 | §3「优先用现有组件」；有 `DesignSegmentedControl`（§3.4）| 接口类型换 `DesignSegmentedControl`；chip 暂无封装→用 token 类自绘或补一个 `DesignChip` |
| 4 | 成功页（图1）太空：裸 `✓` 小且左对齐孤零零、长 model id 平铺、右上还有怪点 | 原则 §1「一套清晰视觉层级」；状态有 `DesignBadge`/`StatusBadge`（§3.3）成功语义 `--workbench-success` | ✓ 居中放大 + `--workbench-success` 色；model id 用 badge/pill 呈现；信息居中分层 |
| 5 | chip 圆角是 `sm`(6px) | §2.4 chip 应 `pill`(999px) | chip 用 `rounded-full` |
| 6 | 整体偏松：字段间 `gap="md"`(16px) + 每字段都挂 hint 行 → 表单很长 | 原则「密度优先」§1 | 间距收到 `gap-3`(12px)，合并/删低价值 hint（接口类型 hint、API Key「加密保存」可保留，其余精简） |
| 7 | 模型 `TagsInput` 双 X：pill 上一个 X + 输入框右侧 clearable 一个 X | 易混淆（§5.5 视觉状态约定/清晰） | 去掉 `clearable`，只留 pill 上的删除 |
| 8 | 主操作「保存」是浅灰，跟次要按钮没拉开权重；和「测试连接」挤一行 | §3.2 主操作应权重最高（ink 底）；§5.3 CTA | 「保存」= 实心主按钮（ink）；测试连接降为次级 |

## 范围 / 不动什么
- **只动** `OnboardingWizard.tsx`（+ 可能补一个 `DesignChip` 到 `src/design/`）。
- **不动** 表单逻辑（预设/拉取/测试/保存）、IPC、runtime——功能已验证。

## 借鉴（规则 6，可选项）
- 成功态/步骤指示可参考成熟 onboarding（如 Linear/Vercel 的极简单页表单：无伪进度、主操作高对比、成功态一行确认）。这里不需要复杂组件，删繁就简即可。

## 回滚 / 验收门
- 单文件改动，git revert 即回。
- 验收：`pnpm build` 绿；目测对照 token（无 Mantine 默认蓝、chip pill、保存为主按钮、无进度点、成功页居中）；322+ 测试不回归。

## 评审（规则 7，用户选：设计师 + 真实用户 2 角）

**设计师补充/修正**：
- ❌ 不新建 `DesignChip`（违反规则1/§9 Step2）→ 供应商单选用 `DesignSegmentedControl` 或 token 自绘 pill。
- ❌ 成功态不用 `StatusBadge`（那是"生成中/完成"状态语义）→ 纯文字分层。
- 系统性违规（我漏的）：`size="xl/md/sm"` 是 Mantine 别名非 token（§2.3）；`✓/✗` 文本字符违反 §6"只用 @tabler"→ `IconCheck/IconX`；测试失败用 ink-60 应为 `--workbench-danger`；成功 ✓ 应 `--workbench-success`。

**真实用户补充**：
- 最易放弃在 **API Key 步**（不知去哪拿 key）→ 每预设带"去 X 官网拿 Key →"链接。
- BaseURL/"v1" 术语吓人，预设已填好应弱化。
- 一屏 3 个 X 怕误清。
- 成功页"节点"是黑话 → 给"去画布开始创作 →"动作。

## 最终方案（分级）

**P1 视觉卫生（纯 token，单文件，低风险）**：删进度点 + 顶部包裹；`SegmentedControl`→`DesignSegmentedControl`；供应商 pill 选中=`accent-soft`底+`accent`字/边、`rounded-full`；保存=主按钮(ink)、测试连接=subtle；`✓/✗`→`IconCheck/IconX`、成功=`workbench-success`/失败=`workbench-danger`；`size` 别名→字号 token；`gap="md"`→`gap-3`；去 TagsInput `clearable`（消一个 X）。
**P2 体验（小范围）**：API Key 下加"去 {预设} 拿 Key →"链接（预设表加 keyUrl 字段）；预设已自动填 BaseURL 时弱化该字段（次级/缩小）；成功态居中重构（IconCheck 圆底 + 标题 + 副文，纯文字非 badge）。
**P3 待定（较大，需导航）**：成功页"去画布开始创作 →"按钮（要接 onCommitted 后的跳转）；可选字段措辞淡化。

## 回滚 / 验收门
- 单文件（P1/P2）改动，git revert 即回。
- `pnpm build` 绿；目测对照 token；测试不回归。

## 执行结果（回填 2026-06-03，做了 P1+P2）

**P1 视觉卫生**：删 `ProgressDots`（函数+顶部 Group 全删）；供应商 chip 改 token 自绘 pill（选中 `bg-nomi-accent-soft`+`text/border-nomi-accent`、`rounded-full`、hover `bg-nomi-ink-05`），**零新组件**（采纳设计师意见，不建 DesignChip）；接口类型 `SegmentedControl`→`DesignSegmentedControl`；保存/完成 `variant="filled"`（主按钮，primaryColor=dark=ink）；测试结果与 MilestoneRow 的 `✓/✗` 文本→`IconCheck/IconX`，成功=`--workbench-success`、失败=`--workbench-danger`；去 TagsInput `clearable`（消一个 X）；表单 Stack `gap={12}`。
**P2 体验**：`providerPresets` 加 `keyUrl`，API Key 下出现"没有 Key？去 {预设} 官网获取 →"外链；`main.ts` 加 `setWindowOpenHandler`→`shell.openExternal`（外链走系统浏览器）；选具名预设后 BaseURL 字段折叠成"接入地址已自动填好 · 自定义"一行（`editBaseUrl` 展开）；成功页居中重构（圆底 IconCheck 成功色 + 标题 + 副文，纯文字非 badge）。

**未做（P3，待定）**：成功页"去画布开始创作 →"跳转（需接 onCommitted 导航）。
**已知遗留**：全文件 `Text size="sm/xs/md"` 仍是 Mantine 别名（设计师指出的系统性 token 违规），本轮未全量替换，留作后续 sweep。

**验收**：`pnpm build`（renderer+electron tsc）绿；`vitest electron/` 318 过；本地 app 重建重启目测。
