# N1–N8 · 对标挖矿硬化清单（竞品 issue 实证 → 直接立项）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[竞品核心架构对标报告](../../research/2026-09-09-competitor-core-architecture-benchmark.md)（12 条失败模式 F1–F12，全部 issue 编号实证）

## 先查别人

- 生态里已有？—— 本清单 N1–N8 的每一条都锚定 [竞品核心架构对标报告](../../research/2026-09-09-competitor-core-architecture-benchmark.md) 里已经用 issue 编号实证过的失败模式（F1–F12），不是臆测出来的假想问题——例如 N1 对应 Velorn #108（ComfyUI 动态 COMBO 解析崩溃）、N4 对应 OpenChatCut #113（read 结果省略媒体关联导致 agent 误判）。
- 仓库里已有？—— N4「读模型完备性」要收紧的落点已经存在实现：`electron/video/deconstructVideo.ts:1` 是当前拆解引擎读取媒体信息的实际文件，N4 的判定完备性检查加在这个既有读取路径上，不新建读取通路。
- 仓库里已有？—— N1/N2 涉及的接入认证矩阵已经存在于本仓：`electron/integrationCertification/httpConnector.ts:19`，本清单是给这个既有认证矩阵加实测项，不新建一套认证框架。
- 结论：N1–N8 全部是「已发生在同类产品身上、有 issue 号可查」的失败模式在 Nomi 自己代码上的对账用例，属于治未病而非猜测性加固。

## P0 三条（小而硬，先红后绿）

### N1 · ComfyUI 动态 COMBO 对账用例（治 F5）
Velorn #108（open）：ComfyUI 新版动态 COMBO `["COMBO",{options:…}]` 破坏 `/object_info` 子文件夹模型解析。**动作**：对账与缺件预检加该格式的解析+回归用例；纳入接入认证矩阵实测项（R5）。落点：ComfyUI 对账代码+认证矩阵。

### N2 · ffmpeg 硬件编码能力实探（治 F6）
Velorn #83：只查 `encoders` 列表不实探，Linux ffmpeg-static 无 NVENC 导致硬件导出静默卡死。**动作**：起 1 秒真实编码任务验证能力；失败走明确降级路径+人话提示。落点：`electron/export/`。

### N3 · agent 工具失败传播门（治 F1）
OpenChatCut #114（open，自认「无共享失败判定」）：工具 `{ok:false}` 被各层当 success，run 仍 completed。**动作**：影子比对断言族加一用例——loopback 剧本注入必失败工具调用，断言回合终态必须红（文字结束不覆盖领域失败）。落点：`tests/agent-runtime/` 影子断言。

## P1 三条

### N4 · 读模型完备性进 #547 评测面（治 F2）
OpenChatCut #113：read 结果省略媒体关联/关键帧状态→agent 得出错误验证结论。**动作**：`read_timeline` 返回字段的判定完备性进 lane 评测用例（关键帧/关联/transition 状态可判定）。

### N5 · 导出前预检补音轨用例（治 F4 局部）
Velorn：95 分钟导出后才发现丢音轨→逼出 validateOnly。**动作**：exportManifest 校验补「有声轨素材缺失」用例（结构已有，补 case）。

### N6 · 健康摘要 + timeline-context 生成动词（Velorn 可借清单）
`analyze_timeline`：一工具返回缺资产/间隙/禁用片段统计（agent 排障成本大降）；`prepare_generation_from_timeline_context` 动词族：从时间轴选中区间/缺口语境反推生成任务批量排队（执行端走 `generationSubmission.ts`，产物落画布→采纳桥落轴）。

## P2 两条

### N7 · 契约 `replaces[]` 血统（pireel 模式）
工具合并/改名时契约里记映射，旧会话不炸（pireel registry 每工具带 replaces[] + history 兼容 legacy part）。

### N8 · 显式输入优先于启发式（Velorn #93 教训）
歌词模糊匹配静默覆盖用户显式时间戳=优先级反了。**动作**：kernel validate 与工具守则写明铁律——显式输入永远赢过启发式推断，冲突时报人话而不是静默覆盖。

## 反向确认（既有架构已免疫，不动）

F3/F10（kernel validate+容忍器）· F4 大部（预览=导出同源 resolver）· F9（R9 巨壳门岗+测试纪律）· F1 检测（影子断言已存在，N3 只补用例）· F12（不捆绑 ComfyUI 进程）。
