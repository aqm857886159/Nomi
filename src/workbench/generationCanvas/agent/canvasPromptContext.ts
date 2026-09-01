// Compatibility import path; the compact Pi projection now lives beside the
// canonical canvas.read contract so renderer and main cannot drift.
export {
  MAX_CANVAS_PROMPT_CHARACTERS,
  formatCanvasForAgent,
} from '../../../../electron/shared/agentCapabilities/canvasReadCompact'
