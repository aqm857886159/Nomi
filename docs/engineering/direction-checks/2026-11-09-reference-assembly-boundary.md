# 参考防回潮：用对象来源和模块边界替掉写法扫描

> 出处：复盘由没参与过 S3 三轮实现与验收的独立线写成（协调会话报告 `R-s3-guard-direction`，在私有仓 Nomi-service 的 `coord-handoff/reports/` 下）。本页是它的摘要和对照，实现线照它的 §6 第 1–5 条落地，没有改它的结论。
> 不重议已批准的「一份绑定声明 + 一个解析写入过程」（`2026-11-09-reference-placement-owner.md`）；只回答「以后新入口还能不能自己挑键、绕过主人发出去」。

## 0. 一句话根因

防线想靠源码里的键名、目录和赋值语法推断「谁拥有请求体」，但生产接口里到处传可写的 `Record<string, unknown>` / `unknown`。语法检查不知道一个对象从哪来、有没有资格发出去，所以换一种等价写法就漏，普通 metadata 又会被误杀。

## 1. 归类表：bug → 直接原因 → 类

| 验收 | 直接原因 | 类 |
|---|---|---|
| V-gen-chain-s3-lowering | Run 两处在解析器外按 body 选键；扫描给整个目录豁免；改解析器的目标，对应的 Run 消费者不红 | 可写参数袋跨模块流通，用「文件 / 名字集中」冒充语义上的主人 |
| V-gen-chain-s3-recheck | 目录内 `out[key]` 拦得住，`Object.assign` 拦不住；局部 metadata 同形赋值误报 | 尺子不知道对象来源 |
| V-gen-chain-s3-binding | 同目录索引红，assign / 展开绿，metadata 红 | 同一种防线表示错误延续，再补语法不是结构修复 |

## 2. 为什么这一类会一直出现

`LoweredGeneration` 只有外壳是 Readonly，`bodyParams` 仍是可写 Record。四个来源（画布、headless、Run 授权、Run 显式）把结果展开进别的普通对象，中间再经过默认参数、URL 本地化、模板渲染和供应商变换。对象一旦变成普通字典，类型检查分不出它是解析产物、用户输入还是 metadata，扫描器也分不出。旧扫描（静态键正则 + 同目录变量键 AST）明写了管不到目录外变量键，也跟不住 `return { ...body, [key]: value }` 这类新对象的流向。名单越拉越长，也补不上这个缺口。

铁律对照：⑩ 说的 = 摆的（同一份参考意图经三条路发出同样的请求体）。证据是官方字段矩阵 249 格 × 双引擎的 498 份请求体逐字节对比；⑪、⑫ 不适用。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新入口用 helper 返回新对象或 `Object.assign` 写参考键，旧扫描全绿 | 在 `electron/capabilityCore/` 新建文件，`return { ...p, image_urls: urls }` 后交给请求构造：旧守卫不红 |
| 同名 metadata（界面状态、上限表）继续触发误报，例外登记表只增不减 | 旧登记表 12 个文件；任何新界面状态叫 `images` 就要再登记一行 |
| 新入口直接 import `requestJson` 发自己拼的 body，没有任何检查红 | 旧仓库里 `requestJson` 没有导入限制 |

## 4. 靶子独立性检查

- 复盘线没读实现线报告，独立读代码、查官方规则，并跑了一个临时 tsc 草稿：readonly / 品牌字段只能挡住三种绕法里的一种，不透明句柄能挡两种，`Object.assign` 还得靠运行时封存。
- 498 份零差异是兼容收据，不是防回潮证据，两者不互相顶替。
- 靶子本身没错。错的是防线的表示：拿语法冒充对象身份。

## 5. P0：这些是我们独有的吗？现成方案有哪些

「参考放进哪个键」是领域规则，自写。「谁能拿到写接口」是通用的模块边界问题，用现成的：ECMAScript `#private` 字段和 `#x in obj` 品牌检查（展开、`structuredClone`、JSON、Proxy 都带不走私有字段），TypeScript 私有构造，ESLint 内置 `no-restricted-imports` / `no-restricted-syntax`（仓库已有 `asset-command-owner`、`browser-fixture` 的先例）。不自写流分析器。

## 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | 从发送点反向追对象来源，沿 alias、参数 / 返回、展开传递身份 | 分析器 300–600 行 + 夹具 | 跨模块 helper、回调、IPC、any 必漏；严格起来大面积误报 | 不推荐 |
| **换一种做法** | 不透明解析产物（`LoweredGeneration` 私有 `#params`，只经 `withLoweredReferences` 并入）+ 封存请求体（`ProfileRequestBody` 私有 `#payload`，只在 `buildProfileHttpRequest` 渲染时封存、只经 `sendProfileJson` 发）+ ESLint 模块边界名单管底层写接口 | 约 20 个文件；不改绑定 / 解析算法、不改 498 份 expected | 不导出 `seal(rawRecord)`；不留原始出网旁路；不给整目录豁免 | **推荐**（本 PR） |
| 删掉 | 最小删除单位：静态写键扫描 + 例外登记表 | 1 个测试文件 | 单独删掉，新入口不调解析器也全绿 | 只作为推荐方案的一部分，同提交删 |

明写的缺口（不在本次范围，复盘 §6 第 2、4、5 条）：画布经 IPC 递来的 `archetypeInput` 在主进程不重新解析成意图；`TaskRequest.extras` 仍是普通 Record；调用方手写的 operation 字面量也能经 `buildProfileHttpRequest` 拿到封存体，只靠模块边界和生成入口账本挡它出网；multipart / CLI / 音频 codec 和用户自写调用脚本不在 JSON 封存范围；直接 `fetch` / `appFetch`、`scripts/` 不在 ESLint 边界里。这些挡的是协作中的误用，挡不住一个肯改主人或门岗的人。

## 7. 用户要权衡的核心

把「新入口不经主人就发不出去」做成结构，代价是多改约 20 个文件、PR 晚合一些。换来的是：以后不用再给扫描器补语法、给 metadata 登记例外。

## 特征测试清单（动结构前先锁住）

- `electron/shared/generationLowering/referenceAssemblyBoundary.test.ts`：两个入口的运行时负例和类型负例、正例、导出面性质（测试先行单独提交，旧代码上 43 红 11 绿）。
- `electron/shared/generationLowering/referenceAssemblyBoundary.lint.test.ts`：用仓库 ESLint 配置对虚拟新入口 lintText，覆盖 17 种绕法和 9 种不该误报的情况。
- 既有：`referencePlacement.characterization.test.ts`、`referenceBinding.contract.test.ts`、官方字段矩阵 498 份请求体、旧用户升级三组（7 份旧目录）。
