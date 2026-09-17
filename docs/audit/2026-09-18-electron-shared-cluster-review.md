# `electron/shared` 症状聚类的结构评审（2026-09-18）

> 状态：现行 · 触发：`check:symptom-cluster` 报「模块 electron/shared：09-12 到 09-18 的 7 天里已有 12 份根因合同」
> 结论先说：**这个桶本身是分桶假象，但桶底下有两个真簇，其中一个是清楚的结构问题。**

## 一、这 12 份到底散在哪儿

按它们真正碰到的 `electron/shared` 子目录分组：

| 子目录 | 份数 | 合同 |
|---|---|---|
| `agentLane/` | 3 | 面板动作回执 · 会话撤权终态 · 跨上下文 handler 错误协议 |
| `canvas/` | 3 | 镜头秒数精度 · 本地转写地基 · 分镜方案缺省透传 |
| `contracts/` | 2 | 素材导入单一 owner · 工程产物存储与投影 |
| `agentCapabilities/` | 2 | 分镜缺省透传 · 跨上下文 handler 错误协议 |
| `modelAvailability.ts` | 1 | 模型可用性单一 owner |
| `integrationContract.ts` | 1 | 花钱闸活得比那笔钱久 |
| `mcpClientRegistry.ts` | 1 | MCP 连接的诚实度 |
| `localSpeech/` | 1 | 片头静音幻听 |
| `surfacePortBinding.ts` | 1 | 跨上下文 handler 错误协议 |

约 8 个互不相关的子系统。更说明问题的是：**12 份里只有 5 份的 `invariant_owner_layer.layer` 真的落在 `electron/shared` 内**，
另外 7 份的 owner 在 `electron/assets`、`electron/capabilityCore`、`electron/downloads`、`src/workbench`、`electron/localSpeech`——
`electron/shared` 对它们只是**路过的那一层**。

这正是键太粗的机制：`electron/shared` 按设计就是「跨进程契约住的地方」，任何非琐碎的修复都会碰它一下。
于是这个桶必然积攒一堆除了路径前缀之外毫无共同点的合同，而门岗把「路过同一个目录」读成了「同一层反复出问题」。

**这是第三次被指出同一件事**：scripts 层曾把 298 个工具压成一个键；`src/workbench` 曾把 71 份合同压成超级键
（提议见 `docs/audit/2026-09-15-numeric-contract-structure.md` §3：改三段键，或直接用合同自己声明的
`invariant_owner_layer.layer`）。本次是第三个实例，证据同构。

## 二、但换个键，信号没有消失——底下有两个真簇

把键换成第二段路径后重算，仍有两个子目录达到阈值。**这两条不是假象，值得各自评审：**

### 2.1 `electron/shared/agentLane/`（3 份）——清楚的结构问题

三份合同的 `class_root` 讲的是同一件事的三个面：**lane 的契约没有把「这件事怎么收场」做成必填的、有类型的、可序列化的值。**

- **面板动作回执**：动作 handler 是可选的（缺了照画按钮，TypeScript 不吭声），终局回执是正文的一个属性（没正文就没回执）→ 界面上「成功了」和「什么都没发生」长得一模一样。
- **会话撤权终态**：把「撤销授权」与「证明没有副作用」混为一谈，且 workspace owner 不发布自己的终态。
- **跨上下文 handler 错误协议**：回调返回任意值与异常，而不是一个可序列化的判别式结果；事务中止把失败身份丢了。

三条都是「终态没有 owner、也没有类型」。**建议**：给 lane 的回调与事务定义一个统一的终态契约
（成功/失败/中止各带身份），并让它在类型层是必填而不是可选。这条值得单独立项，不在本次范围内。

### 2.2 `electron/shared/canvas/`（3 份）——较松，但同一类味道

- **镜头秒数精度**：「该精确到几位」这份领域约束没有 owner，每个碰到数字的地方各自发明一套。
- **本地转写地基**：「按需下载的第三方可执行物与权重」此前只以「深度权重专用」的形态存在，第二家要用只能复制一份。
- **分镜方案缺省透传**：那一层只导出了给界面看的 getter，没导出请求体要用的 resolver，于是调用方自己补。

共同点是**部分所有权**：一层只交出调用方所需的一部分，剩下的让调用方自己发明。比 2.1 松，但方向一致。
**建议**：这三条各自已经修完，先不新立项；下一次同目录再出合同时，按「这一层有没有把调用方需要的全部东西导出」这条问一遍。

## 三、对触发本次门岗的那份合同的裁决

`docs/fixes/2026-09-18-local-speech-silence-hallucination.root-cause.json` 的
`invariant_owner_layer.layer` 是 `electron/localSpeech/localSpeechServer.ts`——
按 owner 层算，这一层在窗口里**只有这一份合同**，没有簇。
它进这个桶，仅仅因为 `scope_paths` 里有一个 `electron/shared/localSpeech/localSpeechAssets.ts`（资产清单）。

**没有为了过门岗去改它的 scope_paths**：那份清单确实被改了（新增 VAD 模型），删掉它才是造假。

## 四、给门岗的建议（不在本次改）

按 `invariant_owner_layer.layer` 聚类，或至少用三段路径键。合同里这一格是**必填的**，
每份都已经声明，改键不需要补数据。这件事已被指出三次，提议正本在
`docs/audit/2026-09-15-numeric-contract-structure.md` §3，等用户裁决键法后一单做掉。
