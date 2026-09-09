# 分镜可靠性轨迹

每轮 `trace.jsonl` 一句一行：面、原话来源、工具顺序、isError/错误码、usage、费用上界、三项判定。`*-pi-native.jsonl.gz` 是最后一句完成后的整份 pi 原生 JSONL 的无损压缩；内含当轮全部输入、完整工具参数/结果、推理和回复。按 `nomi.input` 消息序号对应 caseId，不把摘要代替原始结果。

本地同时保留 `round-N/native/*-pi-native.jsonl` 原文件（不进 Git）；远端用 `gzip -dc round-N/deepseek-pi-native.jsonl.gz` 还原。`nativeSha256` 对应解压后的字节。这样保持原生格式，并满足每轮一个 commit 与 Ponytail 单次150KB文本diff上限，不拆散原生记录。`*-before/after.json.gz` 是实际隔离项目磁盘快照，读取只用于核验，不向 App 灌状态。

案例在 `cases.mjs` 冻结；其中 `argsFor` 只供零费用供应商回放。真实 DeepSeek 不使用它，用户原话经 UI 输入。`params.size` 的两个档位回放不符合 canonical resolution，保留并判失败，不能计作真实模型档位成功。

三指标：工具写对率 = 写工具实际满足当前目标/写工具调用总数；保存率 = 本句成功保存期望变更/10；回合率 = 期望已完整实现/10。已经落盘且诚实回复无须重复修改的幂等请求可算回合成功，但没有新写入不算保存。没有可用模型而拒绝乱写是正确保护，但未完成用户目标，回合仍算失败。

全部资料来自合成故事与独立 profile。没有复制真实用户项目/设置。解压后的证据也按 DEEPSEEK_API_KEY 原值扫描，未发现凭证。
