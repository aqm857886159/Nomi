# CTO 全量审计 · 修复执行单（2026-06-21）

> 来源：2026-06-21 五维并行深审（安全 / 持久化并发 / React 性能 / 代码质量 / 测试与 AI 可靠性）。
> 分支：`worktree-cto-audit`（独立 worktree，因 main 有活跃并行会话做 capability-core，隔离避免抢工作目录）。
> 基线：local main `e7dc0c6`。

## 范围（本批干完）

| # | 维度 | 问题 | 主要文件 | 根治点 |
|---|---|---|---|---|
| 1 | 可靠性 | 缺进程级单实例锁 → 双开并发覆盖全局 index | `electron/main.ts` | `app.requestSingleInstanceLock` |
| 2 | AI | 流式首字后无兜底 deadline → relay 半挂死循环 | `electron/ai/agentStreamConsumer.ts` | chunk 间 idle timeout |
| 3 | AI | 工具确认 promise 无超时 → 渲染层丢事件永久 await + session 泄漏 | `electron/ai/agentChatV2Ipc.ts` | 确认超时自解 |
| 3b | AI | repair 二次 LLM 调用无 abort 传播 | `electron/ai/agentChatHarness.ts` | 透传 abortSignal |
| 4 | 性能 | 创作助手流式每 token 重渲全消息树 | `src/workbench/creation/CreationAiPanel.tsx` | 抽 rAF 合帧 hook（抄 CanvasAssistantPanel） |
| 5 | 性能 | 时间轴播放每帧重渲所有 clip | `TimelineClip.tsx` / `TimelineTrack.tsx` | memo + 收窄订阅 |
| 6 | 性能 | Scene3D 取景每 80ms 全场景 setState | `Scene3DFullscreen.tsx` | 拖动期 ref/draft，落 React debounce |
| 7 | 安全 | 全局无 CSP + 无 will-navigate 拦截 | `electron/main.ts` | CSP header + will-navigate deny |
| 8 | 安全 | 3 处 fetch 绕过 hardenedFetch（SSRF） | `onboardingIpc.ts` / `extractVideoFrame.ts` | 收口 hardenedFetch |
| 9 | 测试 | Agent 工具循环零集成测试 | `electron/ai/agentLoop.test.ts` | MockLanguageModelV1 多步循环测试 |
| 10a | 质量 | GenerationCanvas 800 行顶死/52 hook | `GenerationCanvas.tsx` | 抽 useCanvasViewport/Selection/Hotkeys |
| P2-1 | 可靠性 | agentSessionStore 自写非原子 | `electron/ai/agentSessionStore.ts` | 改用 writeJsonFileAtomic |
| P2-2 | 可靠性 | commitOnboardedModelToCatalog 多次落盘留半截 | `electron/catalog/catalogCommit.ts` | 内存事务一次写 |
| P3-1 | 质量 | getHostedUrl 逐字重复两处 | `persistNodeImage.ts`/`assetImportAdapter.ts` | 提共享工具 |

## 非目标（本批不做，留独立分支）

- **#10b Scene3DFullscreen.tsx 3823 行大拆分**：纯结构重构、回归面在单测兜不住的 3D 编辑器、必须真机走查。塞进本批会拖垮可验证性。留 `refactor/scene3d-split` 独立专注做。

## 顺序（根治整类 → 体感 → 安全 → 测试 → 质量）

1. #1 单实例锁（一个 commit 根治并发覆盖整类）
2. #2+#3+#3b 统一 idle-timeout funnel（同源一次收口所有「永久处理中」）
3. #4 → #5 → #6 性能三连（抄仓内范本）
4. #8 fetch 收口 → #7 CSP/will-navigate
5. #9 Agent 循环集成测试
6. #10a GenerationCanvas 抽 hook
7. P2/P3 quick wins

## 回滚

每项独立 commit，message 带 `[audit#N]`。出问题按 commit 粒度 revert。worktree 隔离，不污染 main。

## 验收门

- 每个逻辑块过相关单测；全批末尾 `pnpm run gates` 五门全过。
- 性能项（#4/#5/#6）：真机走查截图人眼判断（R13），不只 expect 断言。
- 安全项（#7/#8）：构造私网 URL 验证被拦；导航被拦。
- 完成后开 PR，不直接并 main（main 有并行会话）。

## 交付状态（2026-06-21 收尾）

13 项全部实现，**五门全绿**（filesize / tokens / lint 73≤98 / typecheck 双项目 / test 1556 全过 / build）：

| 项 | 状态 | commit |
|---|---|---|
| #1/#7/#8 安全（单实例锁/CSP/will-navigate/抽帧 SSRF） | ✅ | 5719fbf |
| #2/#3/#3b 永久处理中挂起面收口 | ✅ | 25b03b6 |
| #9 Agent 循环集成测试 | ✅ | c7ec32b |
| P2-1/P2-2 落盘原子性 + 接入事务化 | ✅ | 5254733 |
| #4/#5 流式合帧 + 时间轴播放重渲收窄 | ✅ | 69f55bf |
| #6 Scene3D 取景脏判断 | ✅ | 2b22737 |
| P3-1 getHostedUrl 去重 | ✅ | c038e7c |
| #10a GenerationCanvas 抽 useCanvasViewport | ✅ | 9bf2a9c |

**判断微调（落地时）**：
- **#8 onboarding SSRF 不拦私网**：本地优先应用连本机模型服务器（Ollama/LM Studio/vLLM/NAS）是核心功能，桌面端无云元数据可偷、SSRF 价值低；真正 SSRF（extractVideoFrame 机器传入 URL）已加固。
- **#6 改脏判断而非 debounce**：实时预览（CameraPreview）读 React state，debounce 会让预览卡顿；改为静止时跳过 setState（消除空转）、运动时照常提交（保实时），并复用已有 `cameraPoseSampleChanged`（P1 不另造）。
- **#10b Scene3D 3823 行大拆分**：仍留独立分支（纯结构重构、回归面在单测兜不住的 3D 编辑器）。

**真机走查（R13）已做**：Playwright `_electron` 启动**构建产物**（生产 CSP 路径），人眼判断 + 控制台健康全过：
- 单实例锁未卡启动；渲染层非空白、完整渲染（**CSP 没白屏**，body 7.6 万字符）；**0 条 CSP 违规、0 页面错误、0 控制台 error**（CSP 这个最高风险项确认安全）。
- 生成画布：点阵网格 + 节点工具栏 + 视口控制条渲染正常，滚轮缩放 + 中键平移零报错（`useCanvasViewport` 抽取 #10a 非回归）。
- 时间轴：图片/视频/文字三轨在「生成」与「预览」两处均正常渲染（TimelineTrack/Clip memo #5 非回归）。
- 创作编辑器、Scene3D 工具入口（#6）均正常。

仅「流畅度体感」（帧时序更顺滑）属主观、空项目无负载下无法量化——逻辑正确性与无回归已由走查 + 1556 单测 + 集成测试覆盖；真实负载下的顺滑度可在有内容的项目里日常体感确认。
