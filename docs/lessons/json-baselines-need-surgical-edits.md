# 改 baseline JSON 用文本级编辑，别整体重写

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：要给某个棘轮 baseline JSON 加/减几个条目，手已经伸向 `json.load` + `json.dump`；或改完一看 `git diff --stat` 是几百上千行。

**结论**：改 `scripts/vocabularies-baseline.json` 以及同类棘轮 baseline JSON 时，**只能用文本级 Edit 做精确替换**，不要用 `python json.load` + `json.dump` 回写。

**为什么会踩**：2026-09-01 给两个 union 加成员，用 `json.dump(indent=2)` 回写，`git diff --stat` 报**1211 行变更**——因为原文把短数组写成单行 `"members": ["a", "b", "c"],`，而 `json.dump` 一律展开成每元素一行。实际语义改动只有 4 行。

上千行的假 diff 有三重伤害：① 淹掉真正的改动；② 让 R25 的 ponytail 评审按全量 diff 计算而逼近 / 超出限额；③ 让 reviewer 无法判断棘轮是不是被偷偷抬高了——**而棘轮 baseline 的全部价值就在于「变化必须一眼可见」**。

**怎么用**：

- 先 `grep -n "<site 名>" -A 3 <file>` 拿到**原样**的那两三行，再用 Edit 精确替换。
- 改完立刻 `git diff --stat <file>` 确认行数与意图相符（应是个位数）；不符就 `git checkout -- <file>` 重来。
- 同理适用于任何「格式是人手维护的」JSON：`scripts/boundaries-baseline.json`、`scripts/i18n-electron-baseline.json`、`skills-lock.json`。
- 生成物反过来——`docs/DELIVERY-LEDGER.md` 这类**只能**跑 `gen:*` 重生成，不许手改。

**出处**：2026-09-01 词表 baseline 的 1211 行假 diff。相关：[管道跑测试会吞掉退出码](piped-test-runs-mask-exit-codes.md)（同一轮里 gates 的后台通知报 exit 0，实际是 1，必须自己读输出文件）。
