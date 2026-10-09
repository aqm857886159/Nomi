// 「没放到画布上」那一句话（架构③：先落节点、再发请求）。回给 Agent 的工具结果里用——用户在 Codex / Claude 那边
// 读到的就是它，Nomi 不另加界面。只说真实状态：没放到画布上、这次没有发出生成请求、要做什么才能继续。
// 不对「花没花钱」下断言（界面不替账本说话）。

export type LandingFailureCopyInput = Readonly<{ code: string; projectName?: string }>;

export function landingFailureNotice(locale: "zh-CN" | "en", failure: LandingFailureCopyInput): string {
  const name = failure.projectName?.trim();
  if (failure.code === "landing_lease_revoked") {
    return locale === "en"
      ? `Not placed on the canvas, so no generation request was sent: Nomi's window was opened or switched while the project was being opened. Open the project ${name ? `"${name}"` : "for this run"} in Nomi, then continue.`
      : `没放到画布上，这次没有发出生成请求：打开项目的途中 Nomi 窗口被打开或切换了。需要在 Nomi 里打开项目${name ? `「${name}」` : ""}后再继续。`;
  }
  if (failure.code === "landing_project_not_open") {
    return locale === "en"
      ? `Not placed on the canvas, so no generation request was sent. Open the project ${name ? `"${name}"` : "for this run"} in Nomi, then continue.`
      : `没放到画布上，这次没有发出生成请求。需要在 Nomi 里打开项目${name ? `「${name}」` : ""}后再继续。`;
  }
  return locale === "en"
    ? "Not placed on the canvas, so no generation request was sent. Try again once Nomi shows this project."
    : "没放到画布上，这次没有发出生成请求。等 Nomi 打开这个项目后再试一次。";
}

export type LandingShotLabel = Readonly<{ index: number; title?: string }>;

function shotLabel(locale: "zh-CN" | "en", shot: LandingShotLabel): string {
  if (shot.title) return locale === "en" ? `"${shot.title}"` : `「${shot.title}」`;
  return locale === "en" ? `shot ${shot.index}` : `第 ${shot.index} 镜`;
}

/**
 * 一批镜头里有的落下了、有的没落下（#1139 B1：按镜头算）。**逐镜**说：哪几镜放到画布上发出了、哪几镜没放上（没发）。
 * 一镜都没发出时才说「这次没有发出生成请求」（交给 landingFailureNotice）。不谈钱。
 */
export function landingOutcomeNotice(
  locale: "zh-CN" | "en",
  outcome: Readonly<{ sent: readonly LandingShotLabel[]; notPlaced: readonly LandingShotLabel[]; failure: LandingFailureCopyInput }>,
): string {
  if (outcome.sent.length === 0) return landingFailureNotice(locale, outcome.failure);
  const name = outcome.failure.projectName?.trim();
  const sent = outcome.sent.map((shot) => shotLabel(locale, shot)).join(locale === "en" ? ", " : "、");
  const notPlaced = outcome.notPlaced.map((shot) => shotLabel(locale, shot)).join(locale === "en" ? ", " : "、");
  if (locale === "en") {
    return `${outcome.sent.length} shot(s) were placed on the canvas and sent: ${sent}. ${outcome.notPlaced.length} shot(s) were not placed on the canvas and were not sent: ${notPlaced}. `
      + `${name ? `Open the project "${name}" in Nomi, then click Continue` : "Click Continue in Nomi"} to retry only the shots that were not sent.`;
  }
  return `已放到画布并发出 ${outcome.sent.length} 镜：${sent}。有 ${outcome.notPlaced.length} 镜没放到画布上，没有发出：${notPlaced}。`
    + `${name ? `在 Nomi 里打开项目「${name}」后点「继续」` : "在 Nomi 里点「继续」"}，只会重试没发出的这几镜。`;
}
