export function applyPerformanceVerdict(results, processState = process) {
  const passed = results?.pass === true
  if (!passed) processState.exitCode = 1
  return passed
}
