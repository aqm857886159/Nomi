# 3D-BOX 3b · 门槛 ① 真机回合证据（2026-10-04，Windows 11）

脚本：`tests/ux/director-3dbox-3b-agent.walk.mjs`（Electron 主进程 dist-electron + 本仓 vite dev 渲染端，开关 `NOMI_DIRECTOR_3DBOX=true`）。
隔离资料目录（不读用户真实资料）；Agent 模型 = DeepSeek 官方 `deepseek-chat`（协调会话提供的密钥只经进程环境 → safeStorage 密文写进隔离 catalog）；
视频供应商只放占位密钥。**替身模型的回合不算方案 §1.10 的切换门槛**，只证明「一句话 → 工具调用 → 预演 → 挂节点」这条链在真 App 里通。

## 第 5 跑（最终版本代码）

| 步 | 用户说 | 结果（落盘 / 真页面） | 截图 |
|---|---|---|---|
| 1 | 建一个 6 秒视频镜头（不生成）+ 面馆门口两人说话、正反打、最后慢推的 3D 预演 | 模型 `look_at_canvas` → `list_models` → `draft_shots`（视频草稿，未生成）→ `stage_shot` 整份计划（4 镜）一次成功；3D-BOX 节点修订号 `dplan-682c…`、问题 0；离屏渲染完成，**以 video_ref 挂到视频镜头**（节点切到全能参考模式、参考视频 1 条、提示词带 `@Video1`） | `run5-02-preview-attached.png` |
| 2 | 预演里把最后一镜改成特写，别的不动 | 模型交**按名字的补丁** `replace /shots/<末镜>/size = 特写`（带 baseRevision），新修订号 `dplan-d8fd…`；实测回读最后一镜 = 特写；预演重渲并重新挂好 | `run5-03-after-patch.png` |
| 3 | 预演可以了，就用它出这一镜 | 模型读到草稿候选仍是**文生视频（t2v）**、吃不下参考视频，**没有出报价卡**，改用 `ask_user` 让用户选图生 / 全能参考 | `run5-04-agent-asks-mode.png` |

## 第 4 跑（修「Host 未挂」之前）

前两步同上（预演在 Host 挂上之后才就绪）。第 3 步 `generate` 出了卡，**走查脚本误把报价卡当成可撤销写入的确认卡点了确认**，
于是发出一次生成提交：被视频供应商的占位密钥当场拒绝（`invalid API key`），**没有扣费**。派发出去的信封是 `t2v`、`references: []`——
预演挂在画布节点上，但 Agent `generate` 派发的是草稿候选，候选里没有这条预演。脚本已改成出卡即停、从不点。截图 `run4-04-generate-dispatched.png`。

## 前三跑抓到并已修的根因

1. 计划字段外层 `.describe()` 盖掉内层 → lane 装配期无损断言抛错，整条 lane 起不来（`b24dda5bd`）。
2. 主进程执行器的契约白名单漏了 `director.write` → `stage_shot` 全部 `capability_unsupported`（`07cbeea8f`）。
3. 画布壳的懒挂门只认运镜小片 → 预演一直 rendering（`c321f08fb`）。

## 用量

DeepSeek 共 3 跑真正发出请求（第 3、4、5 跑），约 26 次模型请求，输入约 83 万 token（含缓存命中），输出约 6 千 token。

## 拍板 A 之后（第 6–8 跑，同一脚本，出卡即停、从不点；跑前自查脚本里没有任何点确认的动作）

| 跑 | 结果 | 截图 |
|---|---|---|
| 6 | 建预演、补丁都通；出片回合模型只把这一镜换成全能参考、没放预演素材，然后先问时长，没调 generate | — |
| 7 | 模型同样没放预演素材就调了 generate，**报价卡出了、参考槽是空的**（未点确认、零扣费）。根因：预检按落地幂等章 `materializationOperationId` 认镜头，它的值是 `canvas-landing:<operationId>`，一镜都认不出，Agent 路上的三条闸全部失效；改用唯一 owner `productionMetaOf`（`dea424652`） | `run7-04-card-without-preview-before-fix.png` |
| 8 | 模型先把素材塞进 `storyboard.referenceBindings`（不是候选 references）→ `generate` **被预检拒**：「the 3D-BOX preview is ready, but the draft that would be generated does not use it (shot shot-1 needs preview asset …)」→ 模型照提示用 `draft_shots` 把素材放进 references → 再 `generate` → **报价卡出现**：全能参考、参考槽 1 项。落盘候选 = `omni` + 预演素材 id；`runs/<op>/jobs` 不存在，没有任何提交 | `run8-02-preview-attached.png`、`run8-04-spend-card-with-preview.png` |

未验证：报价卡把这条视频参考的缩略图显示成「图已失效」（素材本身是 `video/mp4`）；它在派发时进不进视频参考槽，没点确认所以没验证。

用量（第 6–8 跑）：约 35 次模型请求，输入约 113 万 token（含缓存命中），输出约 5.6 千 token。
