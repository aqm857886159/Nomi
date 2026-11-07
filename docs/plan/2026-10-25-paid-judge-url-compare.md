# 设计卡：付费走查 URL 对号与记账脱敏

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：paid-judge-url-compare　线/负责人：fix/paid-judge-url-compare　类别：[其他]

## ★1 用户怎么用

当付费走查记录托管上传和视频创建请求时，我想让量具把同一张图在响应和请求体里的地址对回原文件名，以便带空格、中文、`#`、`%20` 或 `+` 的文件名不会被误判成未知图片。流程是：读取 multipart 上传文件名；解析 JSON 响应取 URL 字段；用 WHATWG URL 规范化并清掉查询串；解析创建请求 JSON；去重后对回文件名；任一边无法解析或对回则 fail closed。量具不改变产品出站，不运行真付费走查，不读用户资料。真实任务锚点是 `docs/evidence/2026-10-25-outbound-ref-url/paid/README.md` 的带空格首尾帧，以及 `docs/evidence/2026-10-24-composer-b3-reference/paid/report.json` 的无空格首尾帧。目标：类级矩阵对号通过比例 100%，量具为 `tests/ux/_referenceLeakWire.test.mjs`；护栏：不匹配仍判红。

## ★2 谁说了算

`test-harness.walkthrough-url-shape`（走查账本 URL 形状）由 `scripts/walkthrough-url-shape.cjs` 负责；`generation.reference-sent-in-use` 的真实请求判定由 `tests/ux/_referenceLeakWire.mjs` 的 `judgeReferenceWire` 负责。允许消费者是网络闸、对号判定及其测试；不新增产品状态或持久化事实；同一地址事实只保留账本中的字符串，判定只读它们，不猜用户意图。

## ★3 一致与复用

复用 WHATWG `URL` 的标准解析、规范化和 `search` 清空语义；对号继续走同一个共享 helper，不保留旧的“遇空格即截断”正则或备用对号路径。打码再收成同一个 `scrubString`：JSON 先整体解析、递归打码、序列化，非 JSON 也走同一字符串函数；调用方再截断并记录 `truncated`。任何字符串中出现 `http(s)://`，从第一个 `?` 到空白 / 引号都换成 `?<redacted>`。其它只需取 catalog origin 的文本扫描不比较上传地址，保持不变。

## ★4 全状态

- 空：没有创建请求或请求体为空，输出问题清单，不能宣称对号成功。
- 加载：不适用；纯函数一次读取账本。
- 成功：`problems=[]`，摘要给出规范化地址哈希和已对回文件名。
- 失败：JSON 无法解析、地址无效、响应无 URL 或无法对回时明确列出问题并保持红灯。
- 部分成功：任一图片无法对回即整体判红。
- 取消中：不适用；没有异步或可取消操作。
- 过期：查询串已被记账为 `?<redacted>`，仍按无查询串的规范 URL 对号。
- 能力不可用：账本缺失 / 被截断时提示无法证明请求内容，下一步是补齐账本后重跑零花费测试。

## ★9 验收与回滚

验收线编号：`I-paid-judge-url-compare-acceptance`。先运行 `pnpm exec vitest run tests/ux/_referenceLeakWire.test.mjs scripts/walkthrough-network-guard.test.mjs`，再核合同和静态门岗。矩阵覆盖文件名 × {空格、中文、`#`、已编码 `%20`、`+`}；响应形状 × {JSON、JSON 中 `\\/`}；查询串 × {无、签名已打码}；每格使用 `new URL(x).href` 作为请求体地址并要求对号成功。打码类级清单：① 超过 64KB 的 JSON 请求体，签名 URL 路径含空格，先打码后截断且 `truncated=true`；② FormData 字符串签名 URL，路径有空格 / 无空格；③ 纯文本正文中的签名 URL；④ JSON 句子中间的签名 URL；⑤ Bearer / `sk-` 继续打码；⑥ 4096 字节响应上限前也先打码。对号反例是响应截断后 JSON 无法解析时保持 fail-closed 判红。其它反例：响应无效 JSON、缺 URL、请求体被截断、上传没记到、残留参考混入，均保持判红；在 git archive 副本恢复第一轮旧 `scrubText` 后，新打码测试必须重新变红并记录红格数。快检命令还包括改动文件 eslint、`node scripts/typecheck.mjs --incremental`、`pnpm run check:root-cause-contracts`、`node scripts/check-concept-owners.mjs`、`node scripts/check-test-copy-literals.mjs`；不跑真付费、不起 App。回滚为 revert 本提交，产品 `electron/` 与 `src/` 不受影响。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

