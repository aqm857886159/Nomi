# 镜头编号与 Agent 指代一致性

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已合入 main（PR #825，b5cf48bc0）。用户已确认：同镜头首帧图/视频共号并显角色；独立镜头不重号。尽量复用现有实现。

## 根因与方案

现有 model/shotNumbering.ts 已定义稳定存储身份，但模板直接复制号、批量粘贴只改视频号、restoreGraph 原号追加、hydrate 仅补缺不修重号；主进程镜像资格和分配；UI/LOD/Agent 又各读原号。复用原编号规则并上提至 electron/shared/canvas/shotNumbering.ts，渲染层仅转导出，主进程删除镜像。

正整数编号只分给独立镜头主体，恢复保留首个有效号，其余重复/非法/缺失确定性续编。创建沿用max+1，移动/整理不改号；删除保留中间空洞，本刀不新增持久化计数器。模板/粘贴/恢复都调用同一校正，不再复制一份分配算法。

已有 storyboardKeyframe 标记+first_frame 边决定首帧归属，首帧UI和Agent编号从目标视频派生，忽略旧复制号。普通独立图片即使作为参考也不凭连线改身份。孤立首帧只标首帧图；一个首帧服务多个视频时返回明确目标id列表，不能伪装唯一号。操作仍用nodeId，编号+角色用于让用户和Agent准确指代，Agent不能拿多个同角色候选随便选第一个。

共享投影 `resolveShotIdentities(nodes, edges)` 返回 Map<id,{shotIndex?:number,shotRole?:'first_frame'|'video'|'image',shotOwnerNodeIds?:string[]}>。完整/轻量画布和canvas.read/compact共用；首帧和视频显示“镜头 N · 首帧图 / 视频”。不从标题解析身份、不引入第二套编号状态。

## 先查别人

- 仓库现役 `model/shotNumbering.ts:3`：编号是存储身份，max+1，位置不参与重排。保留该基本契约，扩展非法/冲突处理。
- 仓库现役 `agent/applyCanvasToolCall.ts:513` 与 `storyboardTimelinePlan.ts:135`：首帧和视频成同一镜，通过first_frame配对，时间轴视频优先、首帧占位。复用关系而非新建配对表。
- 已实读 tldraw ImageShapeUtil 与 React Flow NodeResizer 官方源码/API（同session媒体修复的来源）；框架node.id为交互身份，用户shotIndex作为领域标签。保留nodeId执行，不让展示编号替代图身份。参考 <https://reactflow.dev/api-reference/types/node>。

## 六角色与反方

CTO：一个纯编号owner，主/渲染复用。设计：沿用现有徽标，追加首帧/视频角色词。PM：用户已选定成对共号。前端：full/LOD共享投影缓存，不按拖动排序。后端：canvas.read公开结构显式shotRole/owner ids，严格schema验证。真实用户：“改镜头2首帧”可找到唯一节点id，复制模板/组合后不会指向原镜头。

独立 aspect_review 已复现粘贴首帧1/视频2，以及模板重复镜1；指出默认分类和参考卡口径漂移，纳入验证。用户拍板后不再把有意同镜共号当冲突。回滚为PR整体revert；旧数据修复确定性，不更改媒体/文本内容。

## 验收

先红测模板重复插入、配对粘贴、重复/非法号恢复、删除后恢复冲突；再验证同配对角色、非shots/参考卡排除、Agent结构/紧凑输出与UI一致、移动稳定、undo/redo与事件恢复。桌面真实项目完成复制/模板操作，zh/en截图，Agent工具回执含明确编号角色与nodeId。合同/门表、相关测试、build、Ponytail、PR/merged-main CI通过后交付。


## 补充复核

React Flow Node 官方字段页已于2026-09-20实际抓取阅读，id定义为“Unique id of a node”；继续用原nodeId执行工具，领域镜号只作人类标签。Headless normalizeSnapshot也调用现有共享owner，磁盘读取和渲染恢复同口径。新增headless恢复回归先红（1失败/15通过）后绿。

反方发现批量交换镜号的事件重放中间态会抢号，以及参考卡/首帧跨分类时资格判断漏meta；纳入同一共享边界修复和live/replay等价验证。


最终反方复核：身份单写/批次复用已有snapshot.restored事件保证JSON删除和批量交换镜号与replay/redo等价；常规提示词/进度事件不膨胀。分类迁移复用完整meta资格。自动审片和前镜连续性统一共享身份，前镜查询复用现有previousShotPromptFor。新增回归均先红后绿，独立复核无剩余阻断项。

兼容薄适配器只转导出（model/shotNumbering.ts 与 nodeKindDomain.ts），i18n只增加既有标签词；它们没有可执行状态读写，门表覆盖共享实现及实际消费者。没有为通过门表新增无用包装。
