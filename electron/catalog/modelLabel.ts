// 模型显示名兜底（审计 A13）：自定义/批量接入若没给 displayName，labelZh 此前
// 直接落原始 model id（如 `moonshot-v1-128k-vision-preview`），助手下拉等所有
// 消费面跟着显示 id 串。兜底统一走本函数：保留 vendor 词根（真名原则），只做
// 分词排版，不翻译不造词。
export function humanizeModelKey(modelKey: string): string {
  const trimmed = String(modelKey || "").trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((token) => (/^\d|^v\d/i.test(token) ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(" ");
}
