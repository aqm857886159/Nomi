# 加模型弹窗 — 减负 + 适配式入口重组

> 用户反馈：东西堆一屏太乱；该按"已有什么"智能决定先给看哪个。功能已跑通，这轮是结构/体验。

## A. 减负（删噪音，4 项）
1. **删「接口类型」手选** → 自动判断：预设决定（Claude=anthropic，其余=openai-compatible）；
   "自定义/中转站"默认 openai-compatible；BaseURL host 含 `anthropic` → 自动识别 anthropic。
   用户不再手选；`DesignSegmentedControl` 移除。
2. **「添加请求头」只在"自定义/中转站"出现**（预设流程不露）。能力保留，噪音消除。
3. **删「供应商名称」字段** → 自动按地址 host / 预设 label 命名（commitManual 已支持空 vendorName 自动命名）。
4. **底部跨模式链接字太小** → 放大成明显入口。

## B. 适配式入口（核心重组）
弹窗打开时查 catalog 是否已有**文本模型**（`modelCatalog.listModels({kind:'text'})`）：
- **无文本模型（首次）** → 默认 `inputMode='manual'`（加文本模型）。因为没文本模型，读文档那条也跑不起来（agent 要用文本模型读文档）。图片/视频入口此时弱化/提示"需先加文本模型"。
- **已有文本模型** → 默认 `inputMode='docs'`（加图片/视频，AI 读文档）。"加文本模型"缩成**次要入口**（明显但非主位的链接/按钮）。

即：不再一屏堆全部，按状态决定主流程；两个模式互留清晰入口。

## 范围 / 不动
- 只动 `OnboardingWizard.tsx`（+ 可能 `providerPresets.ts` 微调）。
- 不动 manualCommit / list-models / 读文档 agent / runtime 逻辑（已验证）。
- 不动 P3 的"去画布开始创作"跳转（之前已搁置）。

## 关键实现点
- `hasTextModel`：`opened` 变 true 时查一次 catalog，决定初始 inputMode。
- providerKind 改为派生（preset + url-sniff），删手选状态的 UI（state 仍保留用于传参）。
- headers 区块 `presetId === 'custom'` 才渲染。
- vendorName 字段删，handleManualSave 传 `vendorName: ''`（后端自动命名）。

## 回滚 / 验收
- 单文件为主，git revert 即回。
- `pnpm build` 绿；`vitest` 不回归；本地重建目测：首次默认文本表单、已有文本模型后默认图片/视频。

## 评审（规则 7：设计师 + 真实用户）

**关键修正（真实用户）**：别把文本入口藏成小链接——"已有文本模型、想加第二个文本却默认图片/视频"会懵。要两个入口都可见、一键切，系统只"猜默认"。
**设计师**：但别用重 Tabs/SegmentedControl（=把刚删的复杂度搬回顶部）→ 轻量"主流程+出口"。
**综合采纳**：顶部一行轻量模式切换 `文本模型 · 图片/视频模型`（当前态加粗 ink、另一态 ink-60 可点链接；无文本模型时图片/视频置 ink-40 禁用 + tooltip "需先添加文本模型"）。取代底部小字链接，A4 自然解决。
**其他采纳**：删接口类型手选（保 url-sniff + 预设派生）；请求头仅 custom；删供应商名称字段。
**搁置（设计师提的债，本轮不做、记录）**：全文件 `Text size=` Mantine 档位 / 内联 `var()` → token 类的系统性 sweep；供应商 chip 手搓 JSX 抽组件；图片/视频配完"当场出图/出视频"实测（读文档流程已有真实 test 调用 + 人话报错，live 预览属更大改）。

## 执行结果（回填 2026-06-03）

- **适配式入口**：`opened` 时查 `modelCatalog.listModels({kind:'text'})`，无文本模型→默认"文本模型"，有→默认"图片/视频模型"。
- **顶部轻量模式切换**：`文本模型 · 图片/视频模型` 两个都可见、可一键切；当前态加粗 ink、另一态 ink-60 可点；无文本模型时图片/视频 ink-40 禁用 + tooltip"需先添加文本模型"。取代了原先上下两处小字链接（A4 解决）。
- **删接口类型手选**：移除 `DesignSegmentedControl`；providerKind 改派生（预设直接给；自定义按 BaseURL host 含 `anthropic` 自动判）。
- **请求头仅"自定义/中转站"出现**；**删供应商名称字段**（vendorName 仍由预设/留空自动命名）。
- 验收：`pnpm build` 绿；`vitest` 48 文件/416 测试过；本地重建重启目测。
- 搁置项（设计师债）未动：Mantine `size=` / 内联 `var()` → token sweep、chip 抽组件、live 预览实测。
