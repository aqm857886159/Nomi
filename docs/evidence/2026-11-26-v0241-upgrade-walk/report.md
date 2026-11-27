# 任务 S：老项目升级走查报告（`v0.24.1` → `main` `77ffa8221`）

> 走查日期：2026-11-26 · 执行体：Gemini 4 Neon（`@gemini-s-upgrade`）· 协作看板：`#1586` 任务 S  
> 基线版本：`v0.24.1`（`21beebc78`）· 目标版本：`main`（`77ffa8221`）  
> 运行模式：全隔离 `<isolated-projects-dir>` / `<isolated-settings-dir>` / `<isolated-user-data-dir>` + 本机 `127.0.0.1` loopback 假 APIMart 供应商（零真 Key、零付费调用、屏外窗口、单实例串行、全程 0 `console.error` / 0 `pageerror`）

---

## 1. 结论一句

**【已核实】用户内容零丢失、全链路与导出/未收尾恢复全过，但「只读打开」并非磁盘零改写**：用 `v0.24.1` 真实建出的 3 个项目（成片项目 A、含未收尾生成项目 B、多节点连线项目 C）升到今日 `main`（`77ffa8221`）后，所有文稿、分镜、画布媒体、参考连线、时间轴片段与凭据均完好可用，中英双轨正常、1080p MP4 真实导出通过、项目 B 未收尾任务可一键无重复付费取回；**但只读浏览即会静默改写 3 个项目的 `.nomi/project.json`（及备份与事件日志）**——除项目 B 预期的 `running → recoverable` 状态对账外，项目 A/C 也在无编辑情况下被静默回填了 `nodes[*].renderKind: "shot-frame"` 并持久化了 `timeline.scale` 缩放值（`revision` 各 `+2`）。

---

## 2. 逐条判断（全部【已核实】）

### 2.1 三类老项目逐项走查结果（`v0.24.1` 建档 → `main` 中英双轨核验）

| 检查项 | 项目 A（全链路成片：`项目A-雨夜咖啡馆成片`） | 项目 B（含未收尾生成：`项目B-赛博夜市未收尾`） | 项目 C（多节点连线：`项目C-废墟灯塔多节点连线`） | 状态 |
|---|---|---|---|---|
| **项目库展示（`zh-CN` / `en`）** | 卡片、封面、`已就绪 / Ready` 正常 | 卡片、封面、`已就绪 / Ready` 正常 | 卡片、封面、`已就绪 / Ready` 正常 | **过【已核实】** |
| **故事文稿** | 3 段全文完整保留（86 字，中英切换无损） | 2 段全文完整保留（65 字） | 2 段全文完整保留（56 字） | **过【已核实】** |
| **分镜镜头表** | 3 行分镜与提示词 100% 保留；顶栏/页脚升级为 `main` 新版（`跨镜头要一致的` / `+ 添加镜头` / `生成剩余`） | 2 行分镜与提示词 100% 保留 | 2 行分镜提示词与参考缩略图（`refThumbs=2`）完整保留 | **过【已核实】** |
| **画布节点与本地媒体** | 3/3 节点（1 图 + 2 视频，`640×360` 全部 `imgLoaded=true`，`nomi-local://` 完好，顶栏 `生成 3/3`） | 2 节点：已完成图卡 `640×360` 完好；未收尾视频卡由 `running` 收敛为中性纸底 `recoverable`（顶栏 `生成 1/2`） | 3/3 节点（2 图 + 1 视频，`640×360` 全部 `imgLoaded=true`，顶栏 `生成 3/3`） | **过【已核实】** |
| **画布多节点连线** | 无连线（与 `v0.24.1` 一致） | 无连线（与 `v0.24.1` 一致） | 2 条贝塞尔参考连线（`img1→vid`、`img2→vid`）100% 保留并正常渲染 | **过【已核实】** |
| **未收尾生成对账与恢复** | 不适用 | **过**：只读打开后自动向上游查 2 次 `GET /v1/tasks/s-walk-video-8`（上游仍返回 `processing`），随后收敛为可取回卡片（中文「任务可能已在上游完成 · 重新取回 / 标记失败」，英文 `"The upstream task may have completed · Retrieve again / Mark Failed"`）；放行上游完成后点击「Retrieve again」，未发任何新 `POST`、仅经 `GET /v1/tasks/s-walk-video-8` + `GET /fixture/video-1.mp4` 直接拉回成片，节点变为 `success`（`Generate 2/2`）且画面正常播放 | 不适用 | **过【已核实】** |
| **时间轴与播放预览** | 3 段（1 图片轨 + 2 视频轨，总长 `4.0s`），`zh-CN` 播放推进至 `0.88s`（`readyState=4`），`en` 播放推进至 `1.8s` | 0 段（与 `v0.24.1` 一致） | 1 段视频（`2.0s`），`zh-CN` 播放推进至 `0.91s`（`readyState=4`），`en` 播放推进至 `1.81s`（`readyState=4`） | **过【已核实】** |
| **真实导出 MP4** | **过**：点击顶栏「导出 MP4」后弹出「MP4 已导出 · 打开文件夹」，落盘 `nomi-export-202611262341.mp4`：**615,826 字节**，`ffprobe` 核验 `h264` 视频流 `1920×1080`、双流（视频+音频）、时长 `4.0s` | 未安排时间轴（未测导出） | 时间轴可播（主导出在项目 A 验证） | **过【已核实】** |
| **只读打开零改写核对（H0 vs H1）** | **存在静默改写（见 §2.2）**：用户数据未丢，但 `.nomi/project.json` 被静默回填 `renderKind` 与 `timeline.scale`，`revision 26→28` | **含预期对账 + 同款静默回填**：预期 `running→recoverable` 对账外，亦回填 `renderKind`，`revision 14→16` | **存在静默改写（见 §2.2）**：用户数据未丢，但 `.nomi/project.json` 被静默回填 `renderKind` 与 `timeline.scale`，`revision 27→29` | **需关注（非丢数，属只读静默写盘）【已核实】** |

---

### 2.2 第一轮：只读打开全文件 SHA-256 哈希对照（`H0` vs `H1`）

**测试方法【已核实】**：在 `v0.24.1` 关闭后对 `<isolated-projects-dir>`（122 个文件）和 `<isolated-settings-dir>`（8 个文件）做递归 SHA-256 快照 `H0` 并冻结归档；随后用 `main`（`77ffa8221`）在原地打开同一资料目录，依次点进项目 A、C、B 浏览文稿、分镜、画布、时间轴（全程零编辑、零点击生成、零导出），正常关闭后立即计算 `H1` 并逐文件比对与 JSON 深度 diff。

#### A. `<isolated-projects-dir>` 全量汇总（共 128 项：基线 122 + 新增 6，0 删除）

- **100% 字节级一致（113 / 122 基线文件，92.6%）**：
  - `<project-A>`：44 个文件字节一致（`assets/*` 8 个、`.nomi/runs/*` 24 个、旧 `.nomi/events/sidecar/*` 6 个、`.nomi/agent-*` 4 个、旧 `.nomi/cache/*` 2 个）。
  - `<project-C>`：44 个文件字节一致（`assets/*` 9 个含分镜参考图、`.nomi/runs/*` 24 个、旧 `.nomi/events/sidecar/*` 6 个、`.nomi/agent-*` 4 个、旧 `.nomi/cache/*` 1 个）。
  - `<project-B>`：25 个文件字节一致（`assets/*` 2 个、`.nomi/runs/*` 16 个、`.nomi/agent-*` 4 个、旧 `.nomi/events/sidecar/*` 2 个，以及未收尾运行标记 `.nomi/canvas-runs/open/*~canvas-run-*.json` 40 字节 `e8d0a95e6f4d2793`）。
- **被改写（9 个）或新增（6 个）的项目文件明细**：

| 变更 | 相对路径（`<isolated-projects-dir>/...`） | `H0` SHA-256（前 16 位 / 字节） | `H1` SHA-256（前 16 位 / 字节） | 归类判断 |
|---|---|---|---|---|
| **modified** | `<project-A>/.nomi/project.json` | `272a0f77f5766f85` (33,818 B) | `8a504386b31c5447` (33,944 B) | **静默回填改写**（8 处字段变更） |
| **modified** | `<project-A>/.nomi/project.backup.json` | `0490d8434e31cec0` (33,829 B) | `d0543270862f2247` (33,932 B) | 随 `project.json` 写盘轮转 |
| **modified** | `<project-A>/.nomi/events/log-0.jsonl` | `fad9cee5b197da7f` (22,557 B) | `0c3e8a801de12a5e` (25,041 B) | 随上述静默写盘追加事件 |
| **added** | `<project-A>/.nomi/events/sidecar/44-snapshot.json` | — | `f4f8a8cd96cbb63d` (14,385 B) | 随上述事件生成快照 |
| **added** | `<project-A>/.nomi/cache/filmstrip/filmstrip-5019d61f.jpg` | — | `0659211971893fa1` (15,999 B) | 打开时间轴生成的胶片缩略图缓存 |
| **added** | `<project-A>/.nomi/cache/filmstrip/filmstrip-7433cee6.jpg` | — | `914eceab93d65819` (15,045 B) | 打开时间轴生成的胶片缩略图缓存 |
| **modified** | `<project-C>/.nomi/project.json` | `23a2c95b208b4cc7` (30,889 B) | `9024f584f23a495d` (31,018 B) | **静默回填改写**（8 处字段变更） |
| **modified** | `<project-C>/.nomi/project.backup.json` | `de70e74bb51e7339` (30,888 B) | `87be3d62c8e066e7` (31,003 B) | 随 `project.json` 写盘轮转 |
| **modified** | `<project-C>/.nomi/events/log-0.jsonl` | `d4f6d397d7090db6` (21,730 B) | `d4627b00bd1e199d` (24,197 B) | 随上述静默写盘追加事件 |
| **added** | `<project-C>/.nomi/events/sidecar/43-snapshot.json` | — | `c924639e5e0f7a01` (13,818 B) | 随上述事件生成快照 |
| **added** | `<project-C>/.nomi/cache/filmstrip/filmstrip-2c53b2fb.jpg` | — | `0659211971893fa1` (15,999 B) | 打开时间轴生成的胶片缩略图缓存 |
| **modified** | `<project-B>/.nomi/project.json` | `e84b2630e66ac6f4` (14,927 B) | `e12ff4fc4c2fd302` (14,463 B) | **预期任务恢复对账 + 静默回填**（10 处字段变更） |
| **modified** | `<project-B>/.nomi/project.backup.json` | `1cff49649e7b0789` (13,770 B) | `30bf144e8081db07` (15,003 B) | 随 `project.json` 写盘轮转 |
| **modified** | `<project-B>/.nomi/events/log-0.jsonl` | `196ff0da821760d1` (10,372 B) | `b372374dbc00f338` (11,506 B) | 随上述写盘追加事件 |
| **added** | `<project-B>/.nomi/events/sidecar/21-snapshot.json` | — | `1b540d9be0c0d032` (5,239 B) | 随上述事件生成快照 |

#### B. 3 个项目 `.nomi/project.json` 精确字段 Diff（区分恢复对账 vs 静默改写）

1. **项目 A（`revision: 26 → 28`，共 8 处字段变更，均属只读静默写盘）**：
   - `payload.generationCanvas.nodes[0..2].renderKind`：`undefined → "shot-frame"`（3 处）
   - `payload.timeline.scale`：`8.004 → 4.952666666666667`（打开预览页重算时间轴缩放并落盘）
   - `payload.generationCanvasLastSeq`：`36 → 44`；`revision`：`26 → 28`；`savedAt` / `updatedAt` 更新
2. **项目 C（`revision: 27 → 29`，共 8 处字段变更，均属只读静默写盘）**：
   - `payload.generationCanvas.nodes[0..2].renderKind`：`undefined → "shot-frame"`（3 处）
   - `payload.timeline.scale`：`16 → 9.905333333333335`
   - `payload.generationCanvasLastSeq`：`39 → 43`；`revision`：`27 → 29`；`savedAt` / `updatedAt` 更新
3. **项目 B（`revision: 14 → 16`，共 10 处字段变更）**：
   - **预期未收尾任务恢复对账（4 处）**：
     - `payload.generationCanvas.nodes[1].status`：`"running" → "recoverable"`
     - `payload.generationCanvas.nodes[1].runs[0].status`：`"running" → "recoverable"`（同时完好保留 `runs[0].taskId = "s-walk-video-8"`）
     - `payload.generationCanvas.nodes[1].progress` 与 `runs[0].progress`：清空为 `undefined`
   - **同款只读静默回填（6 处）**：
     - `payload.generationCanvas.nodes[0..1].renderKind`：`undefined → "shot-frame"`（2 处）
     - `payload.generationCanvasLastSeq`：`17 → 22`；`revision`：`14 → 16`；`savedAt` / `updatedAt` 更新

> **静默写盘复现步骤（供后续确认是否需要收敛为内存归一化、不写盘）**：  
> 1. 用 `v0.24.1` 创建含画布图片/视频节点与时间轴片段的项目并关闭，记录 `.nomi/project.json` SHA-256。  
> 2. 用 `main`（`77ffa8221`）打开该项目，仅切换查看「创作 → 生成画布 → 预览」，不做任何修改后返回项目库并关闭窗口。  
> 3. 重新对 `.nomi/project.json` 做 diff，稳定复现 `nodes[*].renderKind = "shot-frame"`、`timeline.scale` 变更与 `revision += 2`。

#### C. `<isolated-settings-dir>` 全量对照（共 9 项：3 一致 / 5 修改 / 1 新增 / 0 删除）

| 变更 | 相对路径（`<isolated-settings-dir>/...`） | `H0` SHA-256（前 16 位 / 字节） | `H1` SHA-256（前 16 位 / 字节） | 原因说明 |
|---|---|---|---|---|
| **identical** | `attention-sound.json` | `d1d1cfa776f0f9d3` (145 B) | `d1d1cfa776f0f9d3` (145 B) | 字节一致 |
| **identical** | `preferences.json` | `0e61c54a6a65a646` (51 B) | `0e61c54a6a65a646` (51 B) | 字节一致 |
| **identical** | `update-reminder.json` | `ab6a51da475570b1` (143 B) | `ab6a51da475570b1` (143 B) | 字节一致 |
| **added** | `model-catalog.v13.bak.json` | — | `cdb09e9c2ce9997f` (557,727 B) | **升版前自动整文件备份**，与 `H0` 的 `model-catalog.json` SHA-256 100% 一致 |
| **modified** | `model-catalog.json` | `cdb09e9c2ce9997f` (557,727 B) | `3b5b92441f54d9d3` (714,699 B) | 内置模型/映射种子更新（250 处 diff），用户 APIMart 加密 Key 与 vendor binding 完好保留 |
| **modified** | `model-catalog.bak.json` | `b17fb066777833c4` (557,729 B) | `3276d43a1464c7ca` (557,863 B) | 随目录种子合并刷新备份（5 处 diff） |
| **modified** | `recent-workspaces.json` | `ce79213f56f47864` (1,065 B) | `4a9b8f1fc69aeed1` (1,065 B) | 仅更新 3 个项目的 `lastOpenedAt` |
| **modified** | `workspace-sync-baseline.json` | `ff7f4ee092898b1e` (840 B) | `2f0f62f5572f8a96` (840 B) | 随上述 `project.json` 写盘同步更新 3 个项目的 `contentHash` 与 `revision`（`26→28`、`27→29`、`14→16`） |
| **modified** | `integration-certification/promotion-journal.json.lock.epoch` | `65280ccc63833963` (46 B) | `f6c9e51715d11591` (46 B) | 启动锁纪元更新 |

---

### 2.3 截图证据清单（全部 19 张已逐张亲眼 `read_file` 核验，无白屏/乱码/断图）

| 阶段 / 语言 | 文件（仓库相对路径） | 亲眼核验要点 |
|---|---|---|
| `v0.24.1` 基线 | `docs/evidence/2026-11-26-v0241-upgrade-walk/v0241-01-projA-storyboard.png` | 项目 A 3 行分镜提示词建好态 |
| `v0.24.1` 基线 | `docs/evidence/2026-11-26-v0241-upgrade-walk/v0241-02-projA-canvas.png` | 项目 A 1 图 + 2 视频卡落盘成功（`生成 3/3`） |
| `v0.24.1` 基线 | `docs/evidence/2026-11-26-v0241-upgrade-walk/v0241-03-projA-timeline.png` | 项目 A 时间轴 3 段（1 图 + 2 视频，`4.0s`） |
| `v0.24.1` 基线 | `docs/evidence/2026-11-26-v0241-upgrade-walk/v0241-04-projC-canvas-edges.png` | 项目 C 3 节点 + 2 条参考连线 |
| `v0.24.1` 基线 | `docs/evidence/2026-11-26-v0241-upgrade-walk/v0241-05-projB-canvas-running.png` | 项目 B 左图已完成 + 右视频「生成中 · 已等 4 秒」（`生成 1/2`） |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-01-library.png` | 3 个老项目全部展示，封面与「已就绪」正常 |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-02-projA-storyboard.png` | 项目 A 3 行分镜完整保留，新版顶栏/页脚渲染正常 |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-03-projA-canvas.png` | 项目 A 3 张媒体卡完好，底部时间轴摘要条显示 `3 段 · 0:04` 与微缩略图 |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-04-projA-timeline.png` | 项目 A 时间轴 3 段完好，播放推进至 `0.9s / 4.0s`（画面时码 `00:00:00.875`） |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-05-projB-canvas-unfinished.png` | 项目 B 左图完好，右卡清晰展示「任务可能已在上游完成 · 重新取回 / 标记失败」 |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-06-projC-canvas-edges.png` | 项目 C 3 节点 + 2 条连线完好，底条 `时间轴 1 段 · 0:02` |
| `main` `zh-CN` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-zh-07-projA-export-done.png` | 项目 A 导出完成提示「MP4 已导出 · 打开文件夹」 |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-01-library.png` | 英文项目库 3 张项目卡与 `Ready` 状态正常 |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-02-projA-storyboard.png` | 英文分镜页 `Keep consistent across shots` / `Storyboard · 3 shots` 正常 |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-03-projA-canvas.png` | 英文画布 3 节点与底条 `Timeline 3 clips · 0:04` 正常 |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-04-projA-timeline.png` | 英文预览时间轴 `Images / Videos / Text`、`Export MP4`、播放至 `1.8s / 4.0s` |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-05-projB-canvas-unfinished.png` | 英文未收尾恢复卡 `The upstream task may have completed · Retrieve again / Mark Failed` |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-06-projC-canvas-edges.png` | 英文画布 3 节点 + 2 条连线完好 |
| `main` `en` | `docs/evidence/2026-11-26-v0241-upgrade-walk/main-en-07-projB-after-recovery.png` | 点击 `Retrieve again` 后拉回成片成功（`Generate 2/2`），视频正在播放（`00:00:00.625`） |

---

## 3. 补充观察

1. **只读打开时的静默写盘边界**：老项目在 `main` 上只读查看（未做任何用户编辑）即会因为 `nodes[*].renderKind = "shot-frame"` 补全和进入预览页重算 `timeline.scale` 而落盘改写 `.nomi/project.json`、`project.backup.json`、`events/log-0.jsonl` 与 `workspace-sync-baseline.json`（`revision +2`）。虽未造成内容丢失且数据结构合法，但若用户用网盘/多机同步或只是回看老项目，会产生非预期的「已修改 / 版本推进」信号，建议评估把 `renderKind` 缺省解释与纯视图缩放（`timeline.scale`）留在内存态、仅在真实用户编辑时再持久化。
2. **英文单复数细节（极轻微）**：在 `main-en-06-projC-canvas-edges.png` 底部时间轴折叠条里，1 段片段文案显示为 `Timeline 1 clips · 0:02`（未做单数 `1 clip` 处理）。
3. **老项目目录原地升级与副本隔离提示**：`recent-workspaces.json` 记录项目的绝对 `rootPath`，若在测试或用户手动迁移资料时连同 `settingsDir` 一并复制到新路径但未改写 `recent-workspaces.json`，新实例打开项目库卡片仍会指向原路径并触发「有新版本」同步提示；本次走查已通过冻结 `H0` 归档 + 原地还原严格消除了该干扰。
4. **节点/片段历史标题语言**：在中文 `v0.24.1` 建项时落盘的节点默认标题（`图片` / `视频`）切到英文后保留为原持久化字符串，符合用户可编辑标题语义，UI 控件本身已完整切换为英文。

---

## 4. `#1586` 回帖草稿（供协调审核后发布）

```markdown
### 任务 S · 老项目升级走查（`v0.24.1` `21beebc78` → `main` `77ffa8221`）— Gemini 4 Neon

1. **结论一句**
   **【已核实】老项目升级零丢数、全链路/恢复/MP4 导出全过，但「只读打开」存在对 `.nomi/project.json` 的静默回填写盘（`renderKind` 与 `timeline.scale`，`revision +2`）。**

2. **逐条判断**
   - **项目 A（全链路成片）【已核实 · 过】**：文稿（3 段）、分镜（3 行）、画布（1 图 + 2 视频，640×360 加载正常）、时间轴（3 段 4.0s，中英播放推进正常）全部保留；顶栏真实导出 `1920×1080` H.264 MP4（615,826 B，4.0s，音视频双流，`ffprobe` 通过）。
   - **项目 B（含未收尾生成）【已核实 · 过】**：已完成图卡完好；`v0.24.1` 运行中退出的视频任务（`taskId: s-walk-video-8`）在 `main` 打开时自动查上游 2 次并安全收敛为中性纸底 `recoverable` 卡（中文「重新取回」/ 英文「Retrieve again」）；上游完成后一键取回成功变成 `success`（`Generate 2/2`）并可播放，全程 0 次重复 `POST`。
   - **项目 C（多节点与参考连线）【已核实 · 过】**：文稿、2 行分镜与参考图、3 个画布节点、2 条参考连线（`img1→vid`、`img2→vid`）及时间轴片段（2.0s）全部完好可播。
   - **只读打开 SHA-256 核对（H0 vs H1）【已核实 · 需关注】**：
     - `<isolated-projects-dir>`：基线 122 文件中 **113 个（含全部媒体资产、`runs/`、项目 B 的 `canvas-runs/open` 标记）100% 字节一致**、0 删除；9 个文件被改写（3×`project.json`、3×`project.backup.json`、3×`events/log-0.jsonl`），新增 6 个（3×`filmstrip` 缓存、3×`events/sidecar` 快照）。
     - JSON 精确 diff：项目 B 包含预期的未收尾对账（`status: running→recoverable`、清 `progress`、保留 `taskId`）；但 **A/B/C 三项目均在零编辑情况下被静默回填 `nodes[*].renderKind = "shot-frame"`，A/C 进入预览页后还持久化了重算的 `timeline.scale`**，导致 `revision` 各 `+2`。
     - `<isolated-settings-dir>`：升版前自动整文件备份 `model-catalog.v13.bak.json`（与 `H0` `model-catalog.json` SHA-256 `cdb09e9c2ce9997f` 完全一致），再合并内置模型种子，APIMart 加密 Key 与绑定完好。
   - **双轨截图与日志【已核实 · 过】**：`zh-CN` / `en` 及 `v0.24.1` 基线共 19 张真窗截图均已 `read_file` 亲眼核验无白屏乱码；全程 0 `console.error` / 0 `pageerror`。
   - 详细报告与哈希/截图清单：`docs/evidence/2026-11-26-v0241-upgrade-walk/report.md`

3. **补充观察**
   - 建议评估是否将 `renderKind` 默认值解释与时间轴视图缩放 `timeline.scale` 改为内存态，避免用户仅只读查看老项目就触发 `project.json` 写盘与 `revision` 递增。
   - 英文画布底部折叠时间轴条在 1 段片段时显示 `1 clips`（单复数小瑕疵）。
```
