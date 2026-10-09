// 「没放到画布上」那一句话（架构③：先落节点、再发请求）。回给 Agent 的工具结果里用——用户在 Codex / Claude 那边
// 读到的就是它，Nomi 不另加界面。只说真实状态：没放到画布上、这次没有发出生成请求、要做什么才能继续。
// 不对「花没花钱」下断言（界面不替账本说话）。

export type LandingFailureCopyInput = Readonly<{ code: string; projectName?: string }>;

export function landingFailureNotice(locale: "zh-CN" | "en", failure: LandingFailureCopyInput): string {
  const name = failure.projectName?.trim();
  if (failure.code === "landing_project_not_open") {
    return locale === "en"
      ? `Not placed on the canvas, so no generation request was sent. Open the project ${name ? `"${name}"` : "for this run"} in Nomi, then continue.`
      : `没放到画布上，这次没有发出生成请求。需要在 Nomi 里打开项目${name ? `「${name}」` : ""}后再继续。`;
  }
  return locale === "en"
    ? "Not placed on the canvas, so no generation request was sent. Try again once Nomi shows this project."
    : "没放到画布上，这次没有发出生成请求。等 Nomi 打开这个项目后再试一次。";
}
