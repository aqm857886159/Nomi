# electron/promptLibrary 三份媒体与加载合同的结构复核

状态：已评审。由2026-09-08至09日三份合同触发，保留合同和阈值，不增加门岗豁免。

## 共同摩擦与边界

用户要在发现层看见可用内容并直接应用。媒体路径安全、DTO完整性、本地内容可用性是该链路的三个独立不变量；不能让UI自己拼媒体路径或等待外部仓库完成后才获得内置内容。

| 合同 | 缺失不变量 | 权威边界与实际接线 | 复核结论 |
|---|---|---|---|
| 2026-09-08-curated-media-boundary | 只服务声明且未越界的媒体 | electron/skills/skillPreview.ts:13 resolveSkillPreview；curatedPrompts.ts:20调用skillPreviewUrl | 媒体读取仍只有一个协议边界，未复制文件服务 |
| 2026-09-09-skill-library-media-projection | 完整保留分类、正文、媒体 | electron/skills/skillIpc.ts:78；src/workbench/api/promptLibraryApi.ts的toPrompt | DTO不另造封面清单，元数据真源仍是SKILL.md |
| 2026-09-09-builtin-library-cold-start | 本地可用性不依赖远端新鲜度 | electron/promptLibrary/promptLibraryStore.ts:117 getPromptLibrary | 先返回现有floor，原单inflight刷新同一个缓存，不添加并行缓存 |

## 裁决与验收

electron/promptLibrary负责聚合，electron/skills负责包元数据与受限媒体。curatedPrompts.ts:6投影现有SkillRecord，builtinPacks.ts:22去重并前置内置内容；没有第三份媒体所有权，也没有从渲染层访问本地文件。

冷启动修复仅删掉公共读边界的网络等待：本地快照立即返回、后台外部刷新下一次读取生效。两项signal-based测试覆盖永不完成网络及旧磁盘缓存/刷新后读取；25项内置表情两次都存在。真实冷启动Electron已验证折叠、展开和应用；88张真实媒体逐一加载通过。保留原TTL与失败保留快照行为，无新依赖。

结论：当前三个边界已分别收敛，继续把本地媒体、安全读取或刷新策略复制进UI才需要结构性重构。本次不新增聚合层、事件协议或框架。外部新内容需要后续重载，这是明示的缓存新鲜度取舍；不影响内置素材即时使用。
