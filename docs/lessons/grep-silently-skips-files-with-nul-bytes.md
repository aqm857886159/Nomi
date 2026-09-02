# grep 静默跳过含 NUL 字节的文件

> 📎 教训 · 首次记录 2026-09-02 · 状态：现行
> **触发场景**：搜一个「我确信存在」的符号却零命中，且 grep **没有报任何错**；或 `git diff` 对某个源文件显示 `Bin 3372 -> 3703 bytes` 而不是行 diff。

**结论**：源文件里若嵌了**字面 NUL 字节**（裸 U+0000，而不是 `\0` 转义），git 和 grep 会把它当二进制——`grep -rn "符号" 那个文件` **返回空且不报任何错**。零命中不等于不存在。先 `file <path>`（报 `data` 就是它），或直接用 `grep -a` 重搜。

**为什么会踩**：这个失败模式**没有任何提示**。它不是「搜出了错的结果」，而是「安静地少搜了几个文件」——比报错危险得多。全仓搜索是审计 / 重构 / 安全扫查的基础动作，一旦这一步静默失真，后面所有结论都建立在残缺的样本上。

2026-09-02 实测踩到两次：

- `grep -an "expectNoCjkInEnglishDom" tests/ux/_assert.mjs` 一条不出，一度以为该函数不存在于该文件。
- `grep -c "^export"` 在一个 570 行的模块上返回 `0`。

已知位置（NUL 被当作复合键分隔符使用）：

- `src/workbench/settings/defaultGenerationModelOptions.ts:52,76`
- `tests/ux/_assert.mjs:281`

**怎么用**：

- 零命中时别先怀疑自己的记忆——先 `file <path>` 或 `grep -a` 复搜一遍。
- 派 subagent 做全仓搜索时，在 prompt 里写死「always use `grep -a`」。
- 根因修法：把裸 NUL 换成 `\0` 转义，运行期行为不变。修掉之前这条一直有效。

**出处**：2026-09-02 实测。同一类「假阴性」见 [一个死选择器同时造假红和假绿](dead-selector-lies-both-ways.md)、[查重别按报错串 grep](dedupe-grep-misses-silent-copy.md)。
