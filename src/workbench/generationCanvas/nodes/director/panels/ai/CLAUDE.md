# director/panels/ai/
> L2 | 父级: ../CLAUDE.md
> AI 搭场景的 DOM 面板：只组合设计原语与 token 类名，编排（模型调用 / 解析 / 物化 / 存库）在 director 根的 useAiSceneBuilder，参考图数据源在 panels/CanvasImagesContext。
> 成员清单
> AiSceneBar.tsx: 浮条：描述框（Enter 提交 / Shift+Enter 换行 / 粘贴图片进参考图）、参考图 ≤3（本地上传 / 从画布选，缩略图可移除）、目标分段（当前图层 / 新图层）、运行 / 取消、状态行（消息 + 秒表 + 流式字数）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
