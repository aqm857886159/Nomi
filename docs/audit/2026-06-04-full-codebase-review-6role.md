# Audit：v0.9.1 全量代码体检（6 角色评审）

> 触发：用户要求"以 CTO 视角对整个代码库做一次全量梳理，按规则 7 用 6 个角色 agent 各审一遍，
> 看现状、有哪些问题、未来怎么改进"。
> 方法：结构扫描定基线 → 并行分派 6 个角色 agent（CTO / 设计师 / 产品 / 前端 / 后端 / 真实用户）
> 各做全量审查 → 交叉比对（多角色独立命中 = 最强信号）→ 本文固化。
> 本文是这次体检的**单一真相源**，后续按此推进并回填状态。

## 基线事实（已核实）

- 规模：`src/` 195 文件 / ~35.7k 行（渲染层）；`electron/` 74 文件 / ~15.7k 行（主进程）。
- 技术栈：React 18 + Zustand 4 + Mantine 7 + Tailwind 3 + Three.js/R3F + Tiptap 3 + AI SDK(ai ^4) + Electron 31 + Vite 5 + Vitest。
- 测试：54 文件 / 461 测试全绿（含本次新增）；electron 侧覆盖重，UI 交互层基本为零。
- 历史债已还清：8700 行死 CSS、双目录漂移、构建产物入库——均已处理（见同目录早期 audit）。
- 类型安全：整个 `src/` 仅 2 处 `any`、0 处 `@ts-ignore`。
- 基建空洞：**无 ESLint/Prettier 配置**；TODO/FIXME 全仓仅 1 处。

## 综合结论

**这不是"先跑起来再说"堆出来的项目。** 核心架构决策（IPC 单门面、单一持久化真相源、
数据驱动的 provider 扩展）是对的，历史巨债已认真还清。**剩下的债高度集中、可规划、非结构性烂账**——
主要是 3 个巨壳文件 + 缺 lint 基建 + 设计 token 落地脱节。

### 六维健康度评分

| 维度 | 角色 | 分数 | 核心理由 |
|---|---|---|---|
| 架构与分层 | CTO | 8 | IPC 门面 + 单一真相源 + 数据驱动扩展，地基扎实 |
| 前端实现 | 前端 | 7.5 | 模块化/类型/性能是真功夫，扣分在两个 P0 巨壳 |
| 后端/安全 | 后端 | 7 | 安全基本功超同类平均，扣分在防御纵深缺口 |
| 产品价值 | PM | 6.5 | 护城河硬、定位清晰，闭环"能跑通但不够爽" |
| 真实体验 | 用户 | 6.5 | 骨相好，三处用户旅程关键点掉链子 |
| 设计系统 | 设计师 | 6 | token 引擎一流，但组件层大面积绕过 token |

**综合 ≈ 7/10。**

---

## 问题清单（分级 + 证据）

### 🔴 P0 — 跨角色共识，最该先动

**P0-1 两个"上帝文件"是最大单点风险**（CTO+后端+前端+PM 命中）
- `electron/runtime.ts` **3150 行**：一文件管项目存储/导出编排/模型目录CRUD/密钥加密/资产IO/任务执行/AI chat 六个领域。拆分方案已有专门决策文档 `docs/audit/2026-05-30-B1-decision-runtime-split.md`。
- `src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx` **4598 行**：单组件 18 个 `useState` + `stateRef`/`selectionRef` 镜像 ref（状态管理失控信号）。

**P0-2 手搓画布，未用 React Flow**（前端 P0，违反规则 5）
- 全仓 0 处 `@xyflow`/`reactflow`；`GenerationCanvas.tsx`(1186行) 手写 pan/zoom/连线/命中测试/虚拟化，坐标换算逻辑在 4 处重复（L478/485/651/760）。
- 处置：**需按规则 3 出对比表让用户拍板**是否迁移；拍板前冻结手搓画布的功能扩张。止血可先抽单一 `clientToCanvas()` 消除 4 处重复。

**P0-3 设计 token "纸面富翁"**（设计师 P0）
- 字号 token (`text-caption/body/title`) 全仓消费 **0 次**；arbitrary `text-[Npx]` **276 处**，含 `11.5/12.5/10.5px` 等 off-grid（不在 token 表）。
- `globals.css` 残留整套暗色 token（产品 Light-only，违反规则 10"只可减"）；`src/design/surfaces.tsx` 的 `PanelCard`/`InlinePanel` 零消费且暗色（死代码）；两套重复的 AI 聊天面板 CSS（`generation-canvas-v2-assistant__*` vs `workbench-creation-ai__*`）。
- 风险：276 处 arbitrary px 会滚成下一个 `styles.css`。

### 🟡 P1 — 高价值专项

**安全（后端，按 ROI）**
- **S2 SSRF 边界不一致** ⚠️待决策：provider 生成请求用裸 `fetch`（`runtime.ts:2238/2341`、`main.ts:598/653`）绕过 `hardenedFetch`，且注入用户 API key 到 Authorization 头。**取舍**：直接收口 `hardenedFetch` 会拦私网 → 打断本地模型（Ollama/LM Studio @127.0.0.1），与"本地优先"定位冲突。需"放行 localhost、仅拦非预期外网"的带策略方案。
- **S5 项目存盘非原子** ✅已修：见状态追踪。
- **S1 缺 CSP + 导航白名单**（被 `sandbox:false` 放大）；`will-navigate` / `setPermissionRequestHandler` 全仓缺失。
- **S3 IPC 零 schema 校验**：IPC payload 全 `unknown` 手动强转；zod 已在依赖却未用于 IPC 边界。
- **S4 safeStorage 不可用时静默明文落盘**：仅 `console.warn`，无 UI 警示；catalog 文件未设 0600。
- **S6 onboarding test_curl 目标 host 不受同源约束**：被投毒文档可诱导 agent 把用户 key POST 到公网任意 URL。

**前端**
- TimelinePanel 订阅整个 `timeline` 对象，拖拽时全量重渲染（`TimelinePanel.tsx:69`）。
- UI 交互层零测试：时间轴拖拽吸附 / 节点等比缩放 / drag-to-connect 全无测试（最易回归）。
- 跨组件用 `window` CustomEvent 通信，绕过 store（第二条隐形数据流）。

**产品**
- 闭环隐性断点：text/分镜节点无法直接上时间轴（`buildClipFromGenerationNode.ts:76` 只放行带 URL 的 media 节点），且无 UI 提示。
- Scene3D 严重 scope creep：4598 行 3D 编辑器只为"截图当参考图"，面向极窄人群。

**真实体验** ⚠️ 改动用户可见，按规则 8 须先出样张
- 首页"30 秒体验"示例不检查是否已配模型就开跑（`NomiStudioApp.tsx:204`）→ 新人静默失败在最想惊艳的入口。
- 画布一次甩出 11 种节点（关键帧/全景图/3D场景），对"只想出片"的人认知过载。

**工程基建**
- 无 ESLint/Prettier；`electron/`(分号双引号) 与 `src/`(无分号单引号) 已是两套风格；无 `react-hooks` 插件 → 两个巨壳组件 hook 依赖无人审。
- 迁移链每次 hydrate 串跑 4 道且只增不减（`projectPersistenceService.ts:93-97`）→ 应引入 `schemaVersion` + 单一 runner。

### 🟢 P2 — 收尾/低风险

- `src/api/server.ts` 命名误导（实为渲染层 DTO 门面，无真实 server）→ 改名 `desktopClient.ts`。
- `react-pannellum@1.1.2-alpha.1` alpha 供应链风险，仅服务一个全景节点 → 可用现有 R3F 自实现替代。
- `animations.css` 9 处 `@apply`（相对良性，规则 10 严格仍违规）。
- `workbench-ai.css`(757行) 第三方覆盖应迁入 `vendor-overrides.css`。

---

## 状态追踪

| 项 | 状态 | commit |
|---|---|---|
| 修 user-guide 导出章节（WebM/无音频 → MP4+音频+letterbox） | ✅ 已修 | `49151d2` |
| 删导出 UI 残留"暂不包含音频"文案（exportCopy + TimelinePreview toast） | ✅ 已修 | `ab88a70` |
| S5 项目存盘改原子写（新增 `electron/jsonFile.ts` + 接 manifest/registry） | ✅ 已修 | `936582e` |
| 本审查文档落盘 | ✅ | `82f4288` |
| **规则 12 + 文件体积门岗**（`check-file-sizes.mjs`，棘轮只减不增，接入 CI） | ✅ 已立 | `95f4510` |
| 修 `NodeParameterControls` 条件调用 Hook 的真崩溃 bug（lint 揪出） | ✅ 已修 | `45b42af` |
| **ESLint + Prettier + react-hooks** 宽松起步接入 CI（0 error/81 warn） | ✅ 已立 | `a05b2ff` |
| `src/api/server.ts` → `desktopClient.ts`（消除误导命名） | ✅ 已修 | `2947ac2` |
| 补 `micro`(11px) 字号 token（启用 `text-micro`） | ✅ 已修 | `2554e9f` |

"音频自相矛盾"这条跨角色共识（P0/信任命门）已通过 `49151d2`+`ab88a70` 完全收口：文档、app 内文案、实际行为三者一致。
工程基建空洞（lint）+ 巨型文件无约束 两条已通过 `95f4510`+`a05b2ff` 补齐：CI 现在有「文件体积门岗 + lint」双闸门挡增量。

---

## 行动路线

### 立即（低风险高回报，无需用户决策 — 可自主推进）
1. ✅ ~~音频文案三处一致~~（`49151d2`+`ab88a70`）
2. ✅ ~~S5 项目存盘原子写~~（`936582e`）
3. ✅ ~~引入 ESLint + Prettier + react-hooks 宽松接入 CI~~（`a05b2ff`，0 error/81 warn）
4. ✅ ~~`src/api/server.ts` 改名~~（`2947ac2`）
5. ✅ ~~tailwind 补 `micro`(11px) 字号 token~~（`2554e9f`）；⏳ 「禁新增 `text-[*px]` 的 px 棘轮门岗」可仿 `check-file-sizes.mjs` 后补。
6. ⏳ 抽 `clientToCanvas()` 去重 —— **暂缓**：4 处换算读的真相源不同（ref vs 响应式 vs 局部），统一会改变行为；该画布零测试、需在 App 内验证后再做，不盲改。
7. ✅ ~~规则 12 + 文件体积门岗~~（`95f4510`，本次新增需求）。

### 中期（按规则 4 写执行文档 + 规则 7 过角色评审）
7. 拆 `runtime.ts`（决策文档已就绪，按 6 模块逐个 commit）。
8. 拆 `Scene3DFullscreen`：几何/工厂/mannequin 工具化 + 状态收进 reducer/局部 store，干掉镜像 ref。
9. 清理设计债：删 globals.css 暗色双轨 + 死代码 PanelCard + 合并两套聊天面板 CSS + off-grid 字号吸附。
10. 补 UI 交互层测试（先把 resize 几何等纯计算从组件 handler 抽成纯函数再测）。
11. 引入项目 `schemaVersion` + 单一 migration runner，老迁移满版本跨度后退役。

### 长期
12. 评估去掉 `react-pannellum` alpha 依赖（R3F 自实现全景）。
13. 重新评估 Scene3D 范围，把精力挪回核心闭环（分镜直喂时间轴 + 字幕/转场）。

---

## ⚠️ 待用户拍板（我有意未自主推进）

1. **S2 SSRF 收口**：有"防密钥外泄 vs 不打断本地模型"的真实取舍，需用户确认策略（私网白名单方案）。
2. **手搓画布 vs 迁 React Flow**（P0-2）：范围大、回归风险高，按规则 3 须出对比表拍板。
3. **Try-Now 模型预检 + 画布节点减负**（真实体验）：用户可见交互，按规则 8 须先出 HTML 样张、用户确认后才实现。

---

## 验收门 / 复核命令

```sh
# 字号 token 失效现状（P0-3 基线 = 276，应随回填下降）
grep -rohE 'text-\[[0-9.]+px\]' src --include='*.tsx' --include='*.ts' | wc -l

# React Flow 幻影依赖确认（P0-2，应为 0）
grep -rn '@xyflow\|reactflow' package.json src | wc -l

# 巨壳行数监控
wc -l electron/runtime.ts src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx

# 验证门槛（规则 11）
pnpm build && npx vitest run
```
