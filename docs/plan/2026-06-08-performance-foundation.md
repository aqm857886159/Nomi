# Nomi 性能地基改造 · 立项

> 触发：用户反馈「图片素材一多就明显卡顿」。本文档按 R4 立项，先给用户预读/反驳，执行完回填结果。
> 状态：**待用户拍板分期** · 2026-06-08

---

## 一、技术讲解（给工程视角）

性能 agent 深审真实代码后，定位到一条主因链，修它能解掉「图多卡顿」约 80%：

```
本地导入图 → readAsDataURL 转成完整 base64 → 直接灌进 Zustand 节点
  → 整个画布快照随每次微改动，用【同步阻塞 IPC】sendSync 全量 JSON.stringify 落盘
  → base64 又直接当 <img src> 渲染（无缩略图 / 无 lazy / 无 decode async）
  → undo 栈钉住 80 帧，等于 base64 的 80 倍放大器
```

### 关键证据（file:line）

| 反模式 | 位置 | 影响 |
|---|---|---|
| base64 入 store（导入） | `adapters/assetImportAdapter.ts:106-117, 164-180` | 一次最多 8×30MB 字符串进 React state |
| base64 入 store（全景/卡片/音频上传） | `BaseGenerationNode.tsx:700-713`、`render/CardCommon.tsx:65-78`、`render/AudioStripNode.tsx:70-79` | 每次上传一份 base64 |
| canvas.toDataURL('image/png')（切图/旋转/网格） | `nodes/useNodeImageEditing.ts:79,109,140,203,259,308` | PNG 无压缩，切 3×3 = 9 张大 base64 |
| **同步阻塞 IPC 保存** | `electron/preload.ts:5-11,22-28` + `electron/main.ts:179-204` | `sendSync` 阻塞渲染主线程，每次微改动全量序列化几十 MB |
| 持久化全量快照 | `project/workbenchProjectSession.ts:5-14,150` | 700ms 防抖，但任何画布操作都触发 |
| `<img>` 无 lazy/decode/缩略图 | `BaseGenerationNode.tsx:1241-1255`、`render/SceneCardNode.tsx:42`、`assets/AssetTile.tsx:62` | 全仓 `loading="lazy"` 命中 0 处 |
| 节点订阅 18 个全局 slice | `BaseGenerationNode.tsx:202-254`（`canvasZoom`/`isMultiSelectActive`/`isPendingConnectionTarget`） | 缩放/多选/起连时 N 个节点同时重渲 |
| SVG edges 整层无 memo | `components/GenerationCanvas.tsx:899-987` | 拖拽每帧 nodes 引用变 → 整层重画 |
| 列表无虚拟化 + 项无 memo | `AssetLibraryPanel.tsx:225`、`ProjectLibraryPage.tsx:198`、`explorer/FileTreeNode.tsx`、`sidebar/CategoryTree.tsx` | 素材/项目库/文件树全量渲染 |
| undo 栈钉 80 帧 base64 | `store/generationCanvasStore.ts:137-142` | 内存 80× 放大 |

### 已经做对的部分（不要动）

- 画布节点已 `React.memo` + 显式比较器（`BaseGenerationNode.tsx:1390`）
- 画布视口虚拟化已有（>50 节点，`GenerationCanvas.tsx:175-211`）
- 资产导入的 ArrayBuffer 走异步 `invoke`，读图走 `nomi-local://` 协议无 IPC roundtrip（`main.ts:729-744`）—— 这条链是干净的，问题在导入后 store 没把 base64 换成 URL

---

## 二、通俗讲解（给产品视角）

每张图现在是把**整张图的内容**直接塞进内存里的「当前文档」，而且每点一下、拖一下，就把这份「装满整图」的文档**整个重新存一遍盘**，存盘时还会**卡住界面**。图越多，这份文档越大，越卡。

正确做法：图存到磁盘文件里，内存里只留一个「门牌号」（URL）。文档变小，存盘快，界面不卡；画布上显示用小尺寸缩略图，看不见的图先不加载。

---

## 三、用户看到的变化

| 维度 | 现在 | 改造后 |
|---|---|---|
| 导入 10+ 张图 | 明显卡、界面会顿 | 顺滑 |
| 拖动 / 缩放画布 | 图多时掉帧 | 流畅 |
| 切换项目 / 保存 | 大项目有卡顿 | 几乎无感 |
| 素材库 / 项目库滚动 | 图多时卡 | 流畅 |
| 视觉外观 | — | **不变**（缩略图肉眼无差） |

---

## 四、分期方案（待用户拍板执行哪些 / 顺序）

### 期 A · 低风险快赢（不动存储格式）
1. 所有 `<img>` 加 `loading="lazy"` + `decoding="async"` + 缩略图优先（根因层：包一个统一 `<NomiImage>` 组件，一处改全局生效）
2. 素材库 / 项目库 / 文件树接入虚拟化（`@tanstack/react-virtual`）+ 列表项 `React.memo`
3. 节点订阅瘦身：把 `canvasZoom`/`isMultiSelectActive` 等画布级状态从每个节点的订阅里摘掉，改用 CSS var / context 下发，消除全局操作 fan-out 到 N 节点的重渲
4. SVG edges 层 `React.memo` + 只渲可见边

**风险**：低，纯渲染层优化，不改数据格式，可独立验证、独立回滚。

### 期 B · 中风险地基（动存储格式 + IPC）
5. base64 → 本地文件：导入/上传/编辑产物落盘换 `nomi-local://` URL，store 只存 URL（根因杀手）
6. 同步 IPC 保存 → 异步 `invoke`，消除主线程阻塞
7. undo 栈不再深持 base64（存 URL 引用 / 限制内存）

**风险**：中，触及持久化与历史项目兼容。需：① 历史项目迁移（base64 → 文件，一次性懒迁移）② 完整 E2E 回归 ③ 可回滚开关。

---

## 五、不动什么

- 画布节点 memo / 视口虚拟化机制（已对，不重写）
- 资产导入的 `nomi-local://` 协议链路（已对）
- 设计系统 / 视觉外观（token-only，缩略图肉眼无差）
- 生成链路、模型接入逻辑

---

## 六、回滚策略

- 期 A 每条独立 commit，渲染层改动，`git revert` 即回滚
- 期 B 存储格式改动加 feature flag + 迁移幂等；历史项目读取做向后兼容（仍能读旧 base64 格式），迁移失败回退原值

---

## 七、验收门

- 五门全过（check:filesize → lint:ci → typecheck → test → build）
- 性能基线：用 `tests/ux` 真机驱动导入 N 张图，量 ① 导入耗时 ② 拖动/缩放帧率 ③ 保存阻塞时长，改造前后对比
- R13 走查 J1/J4（产品宣传视频主链路 + 参考图驱动）确认主链路未拆坏
- 锁回归断言：性能基线写成可复跑脚本

---

## 八、执行记录（回填）

- **期A-1（统一图片 NomiImage）** ✅ commit f068f9c。新增 `src/design/media.tsx`，
  lazy/decode/缩略图优先，路由画布节点/卡片/库/时间轴的裸 img。
- **期B-1（base64→本地文件，根因杀手）** ✅ commit 44848da。新增
  `adapters/persistNodeImage.ts` + `useNodeImageUpload.ts`，卡片/全景/音频上传 +
  裁切/旋转/网格切分全部收敛到 nomi-local:// 本地文件，消除永久 base64。+5 单测。
- **期B-2（同步IPC→异步）** ⏸️ **决定不做**。理由：B-1 已把保存载荷从 base64
  缩小 ~100×，sendSync 阻塞从「几十 ms」降到「亚毫秒」，保存卡顿已被 B-1 根治；
  而改异步 invoke 会引入退出时持久化风险（beforeunload 的异步保存可能在渲染进程
  被杀前未完成，sendSync 则保证写盘完成）。按 P2「修根因不修症状」——根因是载荷
  大小（B-1 已修），异步化是在修一个已被治好的症状、还赔上持久化可靠性，故撤销。
- **期A-3 / A-4（节点订阅瘦身 / edges memo）** 进行中——修拖拽/缩放时的逐帧重渲。
- **期B-3（undo 瘦身 + 历史迁移）** 待办。
