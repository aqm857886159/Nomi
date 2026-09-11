# 竞品核心架构对标报告：问题挖矿 + Nomi 优化方案

> 日期：2026-09-09 · 方法：4 个并行子代理分仓执行（OpenChatCut / Velorn / Pireel+FableCut+TimelineStudio / FireRed），主管抽查验收（3 条关键 issue 实核属实）后汇总。
> 范围：**只对标与 Nomi 核心直接相关的底层**——时间轴模型/写入语义/渲染导出/agent 接入/版本管理/ComfyUI 集成；一键流水线类不在范围。
> 关联：[剪辑栈底层分析](2026-09-09-nomi-editing-architecture-analysis.md)（七层盘点）· [主报告](../product/2026-09-09-nomi-competitive-master-report.md)

---

## 一、核心架构对比矩阵（五家 + Nomi）

| 维度 | OpenChatCut (1653★) | Velorn (472★) | pireel (1169★) | FableCut (659★) | TimelineStudio (793★) | FireRed (3381★) | **Nomi** |
|---|---|---|---|---|---|---|---|
| 时间轴模型 | items[]+9 kind+keyframes+多序列+linkGroups/multicam（`src/editor/timelineTypes.ts:26`） | zustand 千行 store，直接 set，无操作原语 | `EDITOR_DOCUMENT_V2.md`：11 条不变量，V1→V2 幂等迁移+CAS guard，302 纯 TS engine 零 React | 整轴=project.json，仅 JSON.parse 校验 | hooks 派生状态 | Pydantic 四轨（video/subtitles/voiceover/bgm）+双毫秒窗口+BGM bpm/beats | **kernel：10 原语+validate+diff** |
| 写入语义 | propose→approve 门，整文档快照撤销（changeLog 20 条，beforeDoc+revision 回滚校验） | MAX_HISTORY=50 快照栈，无 CAS | **applyEditorCommand 不可变原子命令+receipts**（最接近我们） | revision 乐观锁(409/force)+ops patch all-or-nothing；**agent 写入不进撤销栈** | 全量快照 past/current/future(50)+CLI 事务+predicted diff | 无显式事务 | **kernel apply+CAS revision+采纳桥幂等键** |
| 渲染/导出 | **Remotion**（@remotion/player 预览+renderer 无头 Chrome，Metal/D3D） | gpuCompositor 1622 行 WebGL2（仅导出 phase1，预览仍 Canvas2D）；exporter 4228 行单文件逐帧 PNG→ffmpeg stdin 直管 | iframe+GSAP 预览；MediaBunny 采样+Blink foreignObject 栅格化 | Canvas2D 三路导出（ffmpeg/WebCodecs/MediaRecorder） | canvas+WebGPU；MediaRecorder→ffmpeg.wasm | **MoviePy 2.x 全量解码**，libx264 veryfast，无硬加速，PIL 画字幕 | **FFmpeg filtergraph 三链，预览=导出同一帧 resolver** |
| agent 接入 | 内嵌 HTTP MCP+手写 schema（122 edit+23 ask）+ToolSearch 延迟激活（7 boot 常驻） | agentTools.js 读写分模式约 100+ 工具 | registry 约 40 工具 8 组，**每个带 replaces[] 记录工具合并血统** | MCP 8 工具+REST+SSE 热重载 | Skill+CLI+MCP，field-level predicted diff | LangChain create_agent+FastMCP，节点注册表自动转工具 | pi lane+capability 契约（pi/mcp 双通道）+容忍器+守卫 |
| 版本/撤销 | undo=整 doc 替换仍可撤销；命名版本存整 doc（30 条） | checkpoint 一等工具 | 命令历史+legacy tool part 兼容 | 前端快照栈（agent 写入不进） | markers+快照栈 | 无 | 采纳桥一步撤销；命名版本=方案 F' 未做 |
| ComfyUI | 无 | **五层深栈**（launcher/jsonata 提取/依赖包+安装队列/promptGuard/云 API 包装成 workflow） | 无 | 无 | 无 | 无（本地 funasr/librosa） | external connector+对账+缺件预检，不启动进程 |
| 工程质量 | TS 中上；issues 活跃自纠 | 纯 JS；4228 行 exporter/3568 行 comfyui **核心零测试**；大量 localStorage kill switch | TS 强；仅 7 issue（AI 生成 PR 为主） | 零依赖但有 mcp-protocol 测试 | TS 中；双端模型分叉实证 | **全仓零测试**；3000 行 FastAPI 巨石 | kernel 全测+R9 巨壳门岗+影子断言 |

**底层排名**（写入语义严谨度）：pireel ≈ **Nomi** > OpenChatCut > FableCut > TimelineStudio > Velorn > FireRed。渲染效果深度：Velorn > OpenChatCut > 其余。**没有任何一家同时拥有「确定性内核 + 预览导出同源 + agent 契约纪律」——这是我们唯一要守住的东西。**

## 二、他们的失败模式（issue 挖矿提炼，全部带编号实证）

| # | 失败模式 | 实证 | 病根 |
|---|---|---|---|
| F1 | **工具业务失败被当成 success** | OpenChatCut #114（open）：`{error}/{ok:false}` 被传输/持久化为 success，run 仍 completed，自认「无共享失败判定」 | 无统一的失败判定层 |
| F2 | **读模型不完备→agent 验证结论错误** | OpenChatCut #113：read_project/read_timeline 省略媒体关联与关键帧状态 | 发现阶梯省 token 省过头 |
| F3 | **工具间隐式契约断裂** | OpenChatCut #111：add_audio 不建 sourceAssetId→analyze_music 失败 | 无 validate 层 |
| F4 | **预览与导出渲染器分叉** | TimelineStudio #100：agent 侧 split 全过、浏览器重开丢右半 clip（双端模型漂移）；Velorn「95 分钟导出后丢音轨」→ 逼出 validateOnly 预检；FireRed #85/#53/#46 渲染假死 | 两套渲染真相源 |
| F5 | **上游格式漂移打破对账** | Velorn #108（open）：ComfyUI 动态 COMBO `["COMBO",{options}]` 破坏 /object_info 子文件夹模型解析 | 对账只覆盖旧格式 |
| F6 | **能力探测不足→静默失败** | Velorn #83：Linux ffmpeg-static 无 NVENC，只查 encoders 列表不实探，硬件导出静默卡死 | 探测≠实探 |
| F7 | **锁与会话生命周期反复返工** | OpenChatCut #63（Windows store lock busy 死锁）、#86/#105/#93/#124（心跳/stale/孤儿会话） | 分布式问题用本地思路硬扛 |
| F8 | **双通道状态不一致** | Velorn comfyui.js ws+history 双通道；#95 preview/apply 读不同 readiness 信号跨 12 版未修 | 状态源不唯一 |
| F9 | **巨石文件+核心零测试** | FireRed agent_fastapi.py 近 3000 行+全仓零测试；Velorn exporter 4228 行核心零测试 | 无门岗 |
| F10 | **原子批校验过严/过宽摇摆** | OpenChatCut #112：easing 别名不认→整批被拒 | 容忍族缺失 |
| F11 | **启发式优先级反了** | Velorn #93：歌词模糊匹配静默覆盖用户显式时间戳 | 显式输入必须赢过启发式 |
| F12 | **依赖体积失控** | FireRed #80：安装占几十 G；#82 缺 torchaudio 本地 ASR 挂 | 无可选依赖分层 |

## 三、Nomi 优化清单（失败模式 → 动作）

> 已有方案不重复（kernel/CAS/同源 resolver/采纳桥/F'–G' 已覆盖 F4 大部/F10 容忍器/版本），只列**新增的、可直接立项的**：

| 优先 | 动作 | 治什么 | 落点 |
|---|---|---|---|
| **P0·N1** | ComfyUI 对账加**动态 COMBO 新格式**回归用例：`["COMBO",{options:…}]` 解析进 `/object_info` 对账与缺件预检（Velorn #108 是现成的靶子，我们接入认证流程 R5 本就要求实测——把这条加进认证矩阵） | F5 | ComfyUI 对账代码+认证矩阵 |
| **P0·N2** | ffmpeg 硬件编码能力**实探**（起 1 秒真实编码任务验证，不只查 encoders 列表），失败明确降级路径+人话提示 | F6 | `electron/export/` |
| **P0·N3** | **agent 工具失败传播门**：领域回执 `ok:false`/`needs_attention` 必须反映到 run/回合终态，禁止「文字说完了但领域失败」——加一条影子比对断言（新旧通路同一 loopback 剧本里注入一个必失败工具调用，终态必须红） | F1 | `tests/agent-runtime/` 影子断言族 |
| **P1·N4** | `read_timeline` 字段完备性进 #547 评测面：关键帧/媒体关联/transition 状态必须在读结果里可判定，防「agent 依据残缺读结果得出错误验证结论」（F2） | F2 | lane 评测用例 |
| **P1·N5** | 导出前**validateOnly 预检**对齐 Velorn 教训：音轨存在性/素材可达性在起渲染前校验（我们 exportManifest 校验已接近，补「有声轨素材缺失」用例即可） | F4 | `electron/export/exportManifest.ts` |
| **P1·N6** | 从 Velorn 借 `analyze_timeline` 健康摘要工具（缺资产/间隙/禁用片段一工具体检）+ `prepare_generation_from_timeline_context` 动词族——见 [Velorn 深挖 §四](2026-09-09-velorn-deep-dive.md) | — | lane canvas-agent 组 |
| **P2·N7** | 命令血统记录借鉴 pireel `replaces[]`：工具合并/改名时在契约里记映射，旧会话不炸 | 工具演化 | agentCapabilities 契约 |
| **P2·N8** | 显式输入优先于启发式的铁律写进 kernel/工具守则（F11） | F11 | kernel validate 顺序 |

**反向确认（我们已对、不要动）**：预览=导出同一 resolver（F4 的结构性免疫）；kernel validate+容忍器（F3/F10）；R9 巨壳门岗+测试纪律（F9）；影子断言（F1 的检测手段已存在，N3 只是补一个特定用例）；不捆绑 ComfyUI 进程（FireRed F12 的体积失控反证）。

## 四、结论

1. **写入语义赛道上 Nomi 已经在第一梯队**：pireel 的原子命令+receipts 与我们的 kernel+CAS 是全场唯二的「操作层事务」设计；OpenChatCut 靠 propose 门+整文档快照补课，Velorn/FireRed 根本没有这一层。
2. **竞品 issue 挖矿的最大价值是「免费的失败清单」**：12 条失败模式里 6 条（F1/F2/F3/F5/F6/F11）我们靠既有架构天然免疫或已半覆盖，真正要新立项的只有 N1–N6 六条，其中三条是 P0 且都很小（回归用例/实探/一条断言）。
3. **底层唯一没补的短板仍是 transcript 层与预览帧回读**（方案 B'/D'）——四家竞品的 agent 都「看得见听得见」自己的时间轴，这是我们写入链骨架之外最后一块。
4. 渲染效果深度（GLSL/关键帧/WebGPU）是 Velorn/OpenChatCut 的领先面，但属于「不做通用 NLE」边界外，按 X4 治理判据排队，不追。

---
*调研执行：4 子代理并行（分仓深挖+issue 挖矿）；主管抽查：#114/#108/#85 三条关键 issue 实核属实后验收。各仓细目见子报告要点，本文为汇总裁决版。*
