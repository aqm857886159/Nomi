# 门岗的 scope 指到不存在的目录，会安静地报绿

> 📎 教训 · 首次记录 2026-09-18 · 状态：现行
> **触发场景**：你要依赖某个「登记表 + scope + 禁令正则」式的门岗（`check:framework-boundary` 是典型）来保证某条不变量；或者你刚改过目录名／搬过模块，而某处登记表里还写着旧路径；或者你在为一条新禁令做阳性对照。

**结论**：这类门岗对「scope 指不到任何目录」是**静默跳过**，不是报红。登记表里写着守卫、门岗每次都报绿、而那条守卫一次都没执行过——这比没写更糟，因为它让所有人以为有防线。**判断一条禁令有没有在工作，唯一可信的办法是给它做一次阳性对照**：构造一个真的会命中的探针，确认门岗会红。

**实证（2026-09-18）**：`docs/engineering/framework-boundaries.json` 里 whisper-cpp 那条能力的 scope 写的是
`electron/localTranscription/` 与 `electron/shared/localTranscription/`，而真实目录叫 `localSpeech/`。
`scripts/check-framework-boundary.mjs` 的 `collectSources()` 里：

```js
const walk = (dir) => {
  if (!fs.existsSync(dir)) return   // ← 指不到就当没事发生
```

于是这条能力下面两条禁令一次都没扫过：`no-english-only-weights`（守的是用户 2026-09-17 的硬约束
「一条英语专用权重都不许有」）和 `no-second-engine`。同一份登记表 24 条 scope 里**有 7 条**指向不存在的目录（另 5 条属 pi），
占 29%。

阳性／阴性对照（两边都要做，只做一边说明不了问题）：

| scope | 探针 | 门岗 |
|---|---|---|
| `electron/localTranscription/`（旧，不存在） | `export const X = "ggml-large-v3.en-q5_0.bin"` | ✅ 报绿 |
| `electron/localSpeech/`（真实路径） | 同上 | ✖ 当场红，指名文件、行号、规则 id |

**做阳性对照时的第二个坑**：`scanSources()` 会先 `stripComments(raw)` 再跑正则。
第一次我把探针写成 `// probe: ggml-large-v3.en-q5_0`，门岗照常报绿——我差点据此判定「修了路径也没用」。
**探针必须是真代码**（`export const X = "..."`），注释形态的探针测不出任何东西。

**下次怎么避**：
- 新增或修改一条禁令时，R17 要求「加规则必须先验它会红」——这里的「先验」必须包含**路径真的扫得到**这一层，不只是正则对不对。
- 搬目录／改模块名后，grep 一遍各登记表里的旧路径（`docs/engineering/*.json` 的 `scope` / `sourceFile` / `scope_paths`）。
- 看到「门岗报绿」时先问一句：它这次到底扫了几个文件？扫了 0 个也是绿。

**相关**：根因（门岗应当 fail-closed 而不是放绿）与另 5 条 pi 的失效 scope 已另派一单，不在当时那次修复的范围里。
