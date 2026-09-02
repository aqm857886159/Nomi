# 对外公开发言带 Nomi 品牌

> 📎 对外表达纪律 · 首次记录 2026-08-24 · 状态：现行
> **触发场景**：要给上游项目提 issue / PR、在社区或讨论区发帖回帖时；起草时正打算把 Nomi 匿名化成「某个 Electron 应用」时。

**结论**：对外公开产出**默认具名**——带 Nomi 名字、仓库链接，以及我们自己那条修复 PR 的链接。写法当**事实陈述**而不是广告。

**为什么会踩**：

2026-08-24 给 undici 报 `ReadableStream.from` 竞态（[nodejs/undici#5715](https://github.com/nodejs/undici/issues/5715)）时，起草时**主动把 Nomi 匿名化**成「an Electron app serving local video files over a custom protocol」，并把「要不要带产品信息」当成一个隐私取舍抛给用户决定。用户回：带品牌，发。

**为什么方向反了**（这是本条的重点，不是「用户喜好」）：

1. **它不是隐私取舍。** Nomi 是**公开仓库**（github.com/aqm857886159/Nomi）——代码本来就是公开的，issue 里提一句应用名不泄露任何未公开的东西。把一个不存在的取舍抛给用户，等于制造了一次无谓的决策。
2. **具名对上游更有证据力。** 对上游维护者而言，**一个具名的真实项目 + 可点开的仓库和修复 PR，比「某个匿名应用」强得多**——它证明这不是实验室里编出来的时序游戏，而是真实产品在真实场景撞上的。匿名反而削弱了 bug 报告本身的说服力。
3. **对后来的读者也更有用。** 别人搜到这个 issue 时能直接点进我们的修复 PR 抄 workaround。

三条加起来：带品牌是**双赢，不是取舍**。

**怎么用**：
- 上游 issue / PR / 讨论区 / 社区回帖默认具名，一句话交代「这是什么应用 + 在什么场景撞上的」即可，**不写卖点、不堆形容词**。
- 落地原文可作模板：「Nomi, a local-first Electron video workbench, serves local video files … We worked around it downstream by [owning the stream ourselves](PR 链接)…」
- **例外仍要停下来问**：涉及未发布功能、真实用户数据、密钥 / 本机路径等敏感信息时不具名。

**出处**：[nodejs/undici#5715](https://github.com/nodejs/undici/issues/5715)（2026-08-24）。相关 [`d6-proposal-jargon-must-be-explained.md`](d6-proposal-jargon-must-be-explained.md)、[`err-invalid-state-is-readablestreamfrom.md`](err-invalid-state-is-readablestreamfrom.md)。
