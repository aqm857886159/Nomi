# F/F'/G'/G/M · 版本、标注、互操作、预设流、技能存档（P2 批次）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 F'/G'](../2026-09-09-agent-native-editing-plan.md) · [AdCraft 方案 F/G](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md)

## F+M-F' 候选版本/回滚（生成+剪辑两侧统一）

- 资产 `lineage`（来源/生成参数/被谁引用）+ 重生成两段式「候选→确认」（复用 #232 候选语义+采纳桥幂等模式）；语义对标 AdCraft supersession/revision candidates 与 OpenCreator「每次修改新版本」。
- agent 侧工具：`undo_last_change` / `manage_versions`（命名检查点）——**前提 F 语义先落，不双轨**。OpenChatCut 教训：它的 undo 是整 doc 替换+changeLog(20 条)+revision 回滚校验——我们 kernel diff 更省，命名版本存 diff 即可。
- 验收：同节点重生成 3 候选，切换/回滚后画布与素材库一致。

## G' 标注层 + 语义 diff 预览

- `manage_markers {action}`：章节/节拍/修改备注，项目时间坐标，human 可见可编辑（非 agent 私有）。
- 计划卡每操作附「改前/改后」语义摘要（时间轴统计+受影响区间）。
- 节拍标注与 E' 共享数据（detect_beats 结果可落 marker，human 微调后再跑 planner）。
- 验收：agent 长任务全程 markers 规划→执行→清除；human 手改后 agent 不覆盖（先验旧纪律）。

## F'-互操作

- `export_jianying_draft`（剪映草稿导出）优先——OpenChatCut 用它抢存量用户，国内用户面最大；序列化器（P1-1）是地基。
- FCPXML 导入 v2 登记；ToolSearch 延迟激活：工具面>30 再建（登记触发条件）。
- pireel 借鉴：契约 `replaces[]` 血统记录（工具合并/改名旧会话不炸）。

## G 广告预设流（Skill Pack 承载，零产品代码）

三条 playbook 模板（产品展示/游戏买量/电商种草）；**先写死节拍骨架再 LLM 填充**（AdCraft `script_beats.py` 6 拍实证：钩子→揭示→利益→证明→CTA→补充，按时长均衡分秒）。验收：零代码新增一条预设流并真实跑通一个品类。

## M 剪辑技能存档

把成功 EditPlan 序列（节奏/字幕样式/BGM 结构）参数化存成 Skill Pack，换素材批量复刻（FireRed Editing Skill Archiving 范式）；依赖 C'/F 落地。与 G 共用 Skill Pack 通道。
