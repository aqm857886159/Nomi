export function selectJourneys(journeys, { ids = null, ci = false, smoke = false } = {}) {
  let selected = [...journeys];
  if (ci) selected = selected.filter((journey) => !journey.needsAgent);
  if (smoke) selected = selected.filter((journey) => journey.smoke || !journey.needsAgent);
  if (ids?.size) selected = selected.filter((journey) => ids.has(journey.id));

  if (selected.length === 0) {
    const label = ids?.size ? `missing requested journeys: ${[...ids].join(",")}` : "zero selected journeys";
    throw new Error(label);
  }

  return { discovered: journeys.length, selected, selectedCount: selected.length };
}
