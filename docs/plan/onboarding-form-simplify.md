# 手填模型表单优化（A 降噪 + C 自动拉模型 + B 预设）

> 裁决：已被现行模型设置/发现流程取代；证据：`src/ui/onboarding/OnboardingWizard.tsx:6-26`、`docs/plan/2026-08-16-model-settings-approved-implementation.md:26-32`。

> 第一个加模型表单是最大流失点。目标：从"填一张考卷"变成"点几下"。
> 决策（2026-06-02）：A 先做；C 试，能成就上、留手填兜底；B 做但补全且去 Ollama。

## 范围

### A — 降噪（纯 UI，单文件 `OnboardingWizard.tsx`）
1. **删"显示名"列**：模型行只剩一个 id 输入框（全宽）+ 删除。显示名本就默认 = id，几乎无人填；要改名以后在列表里改。
2. **精简提示文案**：
   - 删"供应商名称"那条灰字提示（占位符已示例）。
   - BaseURL、API Key 的提示压到一句。
   - 保留"加密保存"这条（安全感，高价值）。
3. **供应商名称降级**：保留字段但标注"可选"，不再当开场第一格的重头戏（B 阶段会被预设自动填）。

### C — 自动拉模型（多文件，试）
- 新增 IPC `nomi:onboarding:list-models`：`GET {baseUrl}/models`，按类型带认证头
  （openai → `Authorization: Bearer`；anthropic → `x-api-key` + `anthropic-version`），
  叠加自定义 header，12s 超时。返回 `{ ok, models: string[] }` 或 `{ ok:false, error }`。
- UI：填完 BaseURL+Key 后出现「拉取模型」动作；拉到 → 多选勾选，勾中的进模型行；
  拉不到（404/网络/不支持）→ **退回手填 id**（同一个框降级，不是两套 UI）。
- 落点：`main.ts`（IPC）、`preload.ts`（payload 透传，unknown 免改）、`bridge.ts`（类型）、
  `OnboardingWizard.tsx`（拉取 + 多选）。复用已有 `extractVendorExtraHeaders` 思路清洗 header。

### B — 供应商预设（多文件）
- 新增预设数据（`src/ui/onboarding/providerPresets.ts`）：每条 `{ id, label, providerKind, baseUrl }`。
  | 预设 | providerKind | baseURL |
  |---|---|---|
  | OpenAI | openai-compatible | `https://api.openai.com/v1` |
  | Claude | anthropic | 空（默认官方 host）|
  | Gemini | openai-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` |
  | Kimi（月之暗面）| openai-compatible | `https://api.moonshot.cn/v1` |
  | 智谱 GLM | openai-compatible | `https://open.bigmodel.cn/api/paas/v4` |
  | DeepSeek | openai-compatible | `https://api.deepseek.com/v1` |
  | 自定义 / 中转站 | openai-compatible | 空（用户粘贴）|
- **去掉 Ollama**（按用户决策）。
- UI：表单顶部一排芯片，点一下自动填 BaseURL + 接口类型 + 供应商名称。
  「自定义 / 中转站」= 清空地址让用户粘贴（中转站走这条，地址是它独有的，预设猜不到）。
- 接口类型 SegmentedControl 在选了预设后自动定；仅「自定义」时仍可手动切。

## 不动什么
- 底层 `buildAiSdkModel` / `commitManualOpenAiCompatibleModels` / runtime 写入路径 —— 已支持
  providerKind + headers，B/C 只是更好地"喂"它，不改它。
- 读文档自动配置（docs 分支）—— 不动。
- 自定义请求头（已收起按钮）—— 不动。

## 中转站怎么落
中转站 = 通用 OpenAI 兼容 + 自家地址/模型名。预设救不了它的地址（独有），但：
- 走「自定义 / 中转站」芯片 → 粘地址 + 粘 Key；
- **C 自动拉模型**是它的主救星（中转多支持 `/v1/models`）→ 勾选，不用背 id；
- 个别要特殊 header 的 → 已有"添加请求头"。

## 回滚策略
- A：纯 UI，git revert 单 commit。
- C：IPC 与 UI 分两块；拉取失败自动退手填，最坏情况 = 回到 A 的体验，不阻断保存。
- B：预设是纯数据 + 一排芯片，revert 即回手填。
- 三块分 commit，互不依赖回滚。

## 验收门
- `npx tsc -p electron/tsconfig.json --noEmit` 0 错；`pnpm build` 绿；`pnpm test` 全过。
- C：对一个真实 OpenAI 兼容端点（或本地起的 mock）`/models` 能列出模型；失败时手填仍可保存。
- 用户视角：中转站用户动作 = 点「自定义」→ 粘地址 → 粘 Key → 勾模型 → 保存。

## 执行结果（回填 2026-06-02）

三块全部落地，验收门绿（`pnpm build` + electron tsc + `vitest electron/` 34 文件/318 测试全过）。

- **A 降噪**：删"显示名"列；模型录入从多行输入框换成单个 `TagsInput`（同时服务 C）；
  精简 BaseURL/Key 提示；清除所有 Ollama 痕迹（占位符/提示）；"供应商名称"降级为底部可选项
  （留空按地址自动命名）。删掉了 `updateModel/addModelRow/removeModelRow` 旧逻辑（规则 1）。
- **C 自动拉模型**：新增 IPC `nomi:onboarding:list-models`（`GET {baseUrl}/models`，
  openai → Bearer / anthropic → x-api-key+version，叠加自定义 header，12s 超时，解析 `data[].id`）；
  `bridge.ts`/`preload.ts` 加 `listModels` 类型与桥接；表单加「拉取可用模型」按钮，结果作为
  `TagsInput` 的自动补全候选；拉不到时退回手填（同一控件降级，不阻断保存）。
  **实证**：对真实 OpenAI 兼容端点（OpenRouter `/api/v1/models`）HTTP 200、解析出 342 个模型 id，
  路径与 IPC 一致 → 中转站同格式可用。
- **B 预设**：新增 `providerPresets.ts`（OpenAI / Claude / Gemini / Kimi / 智谱 GLM / DeepSeek /
  自定义中转站，**无 Ollama**）；表单顶部一排 `Chip` 选供应商，自动填 BaseURL+接口类型+供应商名；
  「自定义 / 中转站」清空地址让用户粘贴；接口类型 SegmentedControl 仅在 自定义/未选 时显示。

**中转站闭环**：点「自定义 / 中转站」→ 粘地址 → 粘 Key →「拉取可用模型」勾选 → 保存。
