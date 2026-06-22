// 提示词库数据形态(单一真相源)。主进程解析公开仓库 → 这个形状 → IPC 给渲染层。
export type PromptMediaType = "image" | "video";

/** parser 产出的原子(还没补 id/source 元信息)。 */
export type ParsedPrompt = {
  title: string;
  prompt: string;
  /** 封面媒体 URL;视频源可能缺(token 失效)→ 空串,UI 显占位。 */
  mediaUrl: string;
  mediaType: PromptMediaType;
};

/** 对外的完整提示词条目。 */
export type LibraryPrompt = ParsedPrompt & {
  id: string;
  /** 这条提示词产出的是图还是视频(决定送上画布建哪种节点)。 */
  promptType: PromptMediaType;
  /** 来源域:public=外部公开仓库(只读);user=用户自己存的「我的库」(可改可删,用户级跨项目)。 */
  origin: "public" | "user";
  /** 人话来源标签(显示在卡片上)。 */
  source: string;
  sourceId: string;
  /** 仓库地址(详情可跳转);用户条目为空。 */
  sourceUrl: string;
  /** 用户条目最近更新时间(ISO);public 条目无。 */
  updatedAt?: string;
};
