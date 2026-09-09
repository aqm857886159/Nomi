# Round 2 · 目标身份复扫与阶段退出

loopback 在 Round 1 修复构建；真实 DeepSeek 在整合 origin/main c6fe8c608（#691/#692）后的相同修复上跑。每种模式各10句、创作/生成各半；同一模式单窗口。原稿通过编辑器输入；模型通过 UI 下拉选择。真实模式仅复用第一轮隔离设置加密凭证，未访问用户库。

| 模式 | 工具写对率 | 分镜保存成功率 | 回合成功率 |
|---|---:|---:|---:|
| loopback | 8/10 = 80% | 8/10 = 80% | 8/10 = 80% |
| DeepSeek 官方 V4 Flash | 6/6 = 100% | 6/10 = 60% | 8/10 = 80% |

保存判据保持严格：#8/#10 没有新写入，不计保存成功；但磁盘已满足文字人物锚及全镜9:16，模型诚实说明无须重复写，计回合成功。#4/#9 GPT Image 2 缺前提，计失败。loopback 同两句 params.size 是非 canonical resolution，保持原夹具并判失败，没有改断言换绿。两种模式所有 toolResult 均 isError=false，工具错误0；未调度媒体。

| 簇 | 第二轮证据 | 结论 |
|---|---|---|
| 目标身份丢失/同名重复 | 全部10句后仍只有1方案、同一个 storyboard ID；真实加锚后后续修改仍保留锚引用 | 本修复复扫通过 |
| surface_port_unavailable | 两面均0次 | 未复现，不新增端口/重试 |
| GPT Image 2 不可用 | 真实#4/#9读取目录确认无目标模型；与第一轮相同 | 连续两轮受缺少可用媒体配置阻塞，停止付费循环 |
| 夹具错误参数 | loopback #4/#9 使用 size，GPT档案要求 resolution | 保留失败证据，非生产模型成功证据 |
| 澄清/无操作 | #6此次实际重拆成功；#8/#10正确幂等回复 | 不靠改提示词强制多余写入 |

费用：10句原生 usage 以官方峰值单价、USD/CNY=8计上界 ¥0.621804；累计含第一轮认证保守预留 ¥0.03 为 **¥1.082421**。各轮低于¥1.5，总低于¥8。无媒体生成。

## 退出判定

命中④：同一“目标媒体模型不可用”簇连续两轮未能消除。仅有 DeepSeek 凭证；GPT Image 2 需额外供应商配置/认证，不能读取用户真实设置或用媒体生成补认证。没有达到连续两轮保存≥95%且回合≥90%，不得宣称整条链已稳定。恢复条件：提供已授权隔离媒体模型目录和凭证/无生成认证路径，再原样跑这10句；不靠第三次重复请求同一空目录。

## 修复与验证定位

本轮不追加未经证实的生产修法；封存完整轨迹、复核上一轮计费上界。实现：canvasWriteEvidence.ts:101（身份/内容进入证据）；canvasWriteTarget.ts:80、:283（捕获及异步后复核）；proposalTxn.ts:254（传入已绑定目标）。回归：canvasWriteTarget.integration.test.ts:289、:303、:316。原生 gzip 无损，trace.jsonl 含解压后 SHA256；前后持久化快照也无损封存。

完整 gates 正在指定锁队列中等待，最终结果在 LOOP-LAST.md；PR 不得在 gates 失败时推送。

最终 UI 复核：打开左侧实际方案条目并收起 Agent，`final-storyboard-full.png` 显示同一方案4镜、小禾文字锚“不生成图”、各镜9:16和已生成0/4。目录仅有即梦媒体声明，无GPT Image 2；截图与磁盘结果一致。UI 中图片仍显示3秒是现有显示语义，未当成本轮媒体执行。

独立只读复核通过：批准前证据与 receipt.prepare 后再校验形成连续目标保护，显式新建路径未改变。两个模式每句均有原生转录，SHA256与40句汇总数已校验；压缩证据解压扫描无环境凭证。

## 完整 gates 发现的交付修正

全量门岗发现 shared hash 的 domain union 漏声明 storyboard/storyboard-target（3处TS2345），以及冻结案例模块的 Node structuredClone 全局未被 lint 识别（2处no-undef）。补齐共享 hash 类型契约，案例仅改为 globalThis.structuredClone，输入、工具参数和断言不变。完整失败日志保留于 .tmp/storyboard-gates-final.log；重新执行同一完整 gates。

全量11967项测试另暴露旧canvasWriteTarget单测只mock事务成功，却没有建立待patch的方案。仅补齐真实store中的两镜目标；所有原断言保持不变。全量失败日志保留于.tmp/storyboard-gates-pass.log。整合主线新增ajv后按锁文件重新安装依赖；不改主线代码或类型基线。
