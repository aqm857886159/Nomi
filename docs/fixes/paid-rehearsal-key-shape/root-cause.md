# 付费演练假钥匙过不了接入页

- 症状：`NOMI_PAID_REHEARSAL=no-key` 的演练全部停在 before-click，接入页报「这不像 APIMart 的 Key」。
- 直接原因：0d3f0067a（11-24）起接入页先用 `isApimartKeyCandidate`（要求 `sk-` 开头）判钥匙；演练的 `REHEARSAL_FAKE_KEY` 不带 `sk-`。
- 类根因：假钥匙是演练自己手写的一份，和产品的钥匙格式检查是两个家，产品收紧它不知道。
- 修法：假钥匙改成 `sk-` 开头；`tests/ux/_paidRun.test.mjs` 直接拿产品的 `isApimartKeyCandidate` 判它，产品再收紧格式这条单测先红。
- 夜跑为什么没报：夜跑跑了（11-24、11-25 第 0 批「付费演练」那步都红）；`KNOWN_RED` 是空的、没吞；但整个夜跑自 11-20 起天天红（非付费批也红），这一步淹没其中。
- 反例：把假钥匙改回不带 `sk-` 的旧值，新单测红；还原后绿（见 red.txt / green.txt）。
