# 方向检查（类根因复盘）：3D 预演参考挂接（I-3d-ref）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：提交时 `fix-churn` 命中 `directorPreviewState.ts`（近 14 天已有 `aafea7949`、`e65ffa7d4` 两个 fix，这一刀是第 3 个）与目录 `director/model/`（第 5 个）、词典 `director.ts#agent`（第 3 个）。开工时对三个文件一起跑 `fix-churn` 输出「未命中」，提交时的门岗按文件逐个算才报出，这是开工那一步的漏报，已在交付里单独说明。
> 本刀不是「第 3 次补同一个洞」：近两个 fix 补的是「过期预演也挡花钱闸」「超长按当前工程判」，本刀碰到的是同一个文件里的**另一条**判据（无指纹的旧预演放行）。但同目录反复出现的共同形状是「靠一个旧凭据判新鲜 / 判已挂」，所以按规矩写这一页，结构性结论交拍板。
> 复盘前先钉特征测试：`directorPreviewStale.spendGate.test.ts`（原有的「旧预演无指纹放行」那一条被改为「按过期挡」，是协调 10-21 明确的产品决定）、`directorProduce.test.ts`、`directorPreviewCapture.test.ts`、`attachCameraMoveToTarget.test.ts` 全部保留并通过。

### 0. 一句话根因

「预演在这个镜头上是否有效 / 是否已挂好」被两个旧凭据代答（预演上的指纹、镜头上的网址标记），而不是拿「付费请求此刻实际会带什么」去对账；上层还能绕开共享核自己再答一遍。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| D1 换模型 / 删参考后出成片不重挂 | 核与 `directorProduce` 都看「网址标记相同就跳过」，先于槽检测 | 旧凭据代答「已挂好」 |
| D2 提示词写死 `@Video1`，预演排在用户片之后 | 提示词编号是文本，不是由实际发送顺序推出 | 旧凭据代答「编号」 |
| R1 无指纹旧预演被过期闸放行 | `directorPreviewIsStale` 没有指纹时返回 false（#1221 为兼容旧数据留下） | 旧凭据代答「新鲜」 |
| `aafea7949` 过期预演不挡花钱闸（近 14 天） | 闸只认 rendering / failed | 同类：闸漏一种状态 |
| `e65ffa7d4` 超长预演按旧状态判（近 14 天） | 超长按渲染当时判，不按当前工程 | 同类：拿渲染时的记忆判当前 |

### 2. 为什么这一类会一直出现

预演是「渲染当时」的产物，付费请求是「点击当时」的构造。中间隔着改工程、换模型、删参考，任何拿渲染 / 挂接当时留下的记忆（指纹、标记、写死的编号）去答「现在对不对」的写法，都会在某一条中间路径上过期。三个 fix 都是在补一条中间路径，而判据本身还是记忆。落到铁律 ⑫「点了=以为的」：用户点「出成片」以为的是「预演会进这次付费请求」。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新的调用方（如以后的批量出片）自己拿标记早退，换模型后又漏挂 | `attachDoors.guard.test.ts`（本刀已加，扫生产代码） |
| 用户在节点上直接点 ↑（不经「出成片」）时，换模型后预演未挂也放行 | 见交付「没做」：闸只核新鲜度，不核「此刻挂着没有」 |
| 槽数不同的模型 + 用户自己的参考视频，编号又错 | `attachCameraMoveToTarget.reference.test.ts` 的槽满、连线在前两条 |

### 4. 靶子独立性检查

测试的真值来自 `orderedSentMediaReferenceUrls` 与 `projectPromptForSend`（和请求构建器同一个函数），不是核自己的输出；另有走真请求构建（`buildCatalogTaskRequest`）的用例，以及隔离 Electron + 本机假上游抓真实请求体的取证。没有评测分数涉及。

### 5. P0：这些是我们独有的吗？现成方案有哪些

编号规则与有序合并在仓库里已有唯一 owner（`electron/shared/storyboard/promptMentions.ts`、`archetypeMeta.orderedSentMediaReferenceUrls`），本刀接入它们，不写第三套。没有第三方库涉及；未命中自写登记。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 编号走 `promptMentions`、顺序走 `orderedSentMediaReferenceUrls`（仓库内现成） | 提示词里的参考句变成引用标记（编辑器里显示成小标） | `@video2` 小写写法真模型是否照它找片，只有真付费样本能证 | **推荐（已做）** |
| 补 | 在 `directorProduce` 与核里各加一个槽检测 | 小 | 上层仍能绕过核再答一遍，第三个调用方会重蹈 | 不推荐 |
| 重写（限一个模块） | 核整体重写 | 本刀已按「换」收：判据换成对账，不是新增并行版 | | 已做（同提交删旧） |
| 删 | 删上层早退、核内同网址早退、写死的 `@Video1`、「无指纹不判过期」 | 旧预演要多一次本机免费重渲 | 用户觉得「为什么要重渲」→ 沿用现有过期提示 | **已做** |

### 7. 用户要权衡的核心

旧预演（没有指纹）要不要为了一次本机免费重渲，换「拿可能过期的参考去花钱」的零风险；协调 10-21 已选前者，这里只请拍板确认。

## 特征测试清单（动结构前先锁住）

- `src/workbench/capability/directorPreviewStale.spendGate.test.ts`：新鲜 / 过期 / 重渲放行；旧预演那条按决定改为「按过期挡，一次重渲放行」。
- `src/workbench/generationCanvas/nodes/director/agent/directorProduce.test.ts`：出成片只准备、不花钱，静态守卫摸不到花钱入口（新入口 `attachCameraMoveForNode` 在守卫扫描范围内，通过）。
- `.../attachCameraMoveToTarget.test.ts`、`.../directorPreviewCapture.test.ts`、`.../applyDirectorWrite.test.ts`：既有行为（首次挂、换片替换、降级、撤销补偿事务身份）保留；只把写死的 `@Video1` 断言改成引用标记，并给手工造的就绪预演补指纹。
