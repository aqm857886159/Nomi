// CI 只跑零额度、也不要私有真素材的旅程：真素材不进仓库，CI 上没有 NOMI_REAL_MEDIA_DIR。
// 要真素材的旅程（realMedia）在本机带 NOMI_REAL_MEDIA_DIR 跑，缺了照样起步就红。
function ciSkipReason(journey) {
  if (journey.needsAgent) return "needs-agent";
  if (journey.realMedia?.length) return "needs-real-media";
  return null;
}

export function selectJourneys(journeys, { ids = null, ci = false, smoke = false } = {}) {
  let selected = [...journeys];
  const excluded = [];
  if (ci) {
    for (const journey of selected) {
      const reason = ciSkipReason(journey);
      if (reason) excluded.push({ id: journey.id, reason });
    }
    selected = selected.filter((journey) => !ciSkipReason(journey));
  }
  if (smoke) selected = selected.filter((journey) => journey.smoke || !journey.needsAgent);
  if (ids?.size) selected = selected.filter((journey) => ids.has(journey.id));

  if (selected.length === 0) {
    const label = ids?.size ? `missing requested journeys: ${[...ids].join(",")}` : "zero selected journeys";
    throw new Error(label);
  }

  return { discovered: journeys.length, selected, selectedCount: selected.length, excluded };
}
