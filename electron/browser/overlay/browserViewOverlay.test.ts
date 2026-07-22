import { describe, expect, it, vi } from "vitest";
import type { BrowserAssetOverlayRecord } from "../core/browserViewTypes";
import {
  applyBrowserAssetOverlayMouseEvents,
  applyBrowserAssetOverlayShape,
  finishBrowserAssetOverlayDrag,
  setBrowserAssetOverlayDragInteractive,
} from "./browserViewOverlay";

vi.mock("electron", () => ({
  BrowserWindow: { fromId: () => null },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
}));

function makeRecord(setShape: ReturnType<typeof vi.fn>): BrowserAssetOverlayRecord {
  const setIgnoreMouseEvents = vi.fn();
  return {
    ownerWindowId: 1,
    window: {
      isDestroyed: () => false,
      setShape,
      setIgnoreMouseEvents,
    },
    hostBounds: { x: 0, y: 0, width: 1200, height: 800 },
    viewId: 1,
    captureEnabled: false,
    rendererReady: true,
    pendingShow: false,
    pendingCaptureRequest: null,
    dockMode: "right",
    popoverRect: { left: 800, top: 0, right: 1200, bottom: 800, width: 400, height: 800 },
    shapeInteractive: false,
    pointerInteractive: false,
    hoverInteractive: false,
    dragInteractive: false,
    hoverInteractiveTimer: null,
    dragInteractiveResetTimer: null,
  } as unknown as BrowserAssetOverlayRecord;
}

describe("browser asset overlay native hit testing", () => {
  it("keeps the full overlay click-through on macOS because BrowserWindow.setShape is unsupported", () => {
    const setShape = vi.fn();
    const record = makeRecord(setShape);

    applyBrowserAssetOverlayShape(record, "darwin");
    applyBrowserAssetOverlayMouseEvents(record);

    expect(setShape).not.toHaveBeenCalled();
    expect(record.shapeInteractive).toBe(false);
    expect(record.window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
  });

  it("uses the dock shape only after setShape succeeds on a supported platform", () => {
    const setShape = vi.fn();
    const record = makeRecord(setShape);

    applyBrowserAssetOverlayShape(record, "win32");
    applyBrowserAssetOverlayMouseEvents(record);

    expect(setShape).toHaveBeenCalledTimes(1);
    expect(record.shapeInteractive).toBe(true);
    expect(record.window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
  });

  it("falls back to click-through when setShape throws", () => {
    const record = makeRecord(vi.fn(() => { throw new Error("unsupported"); }));

    applyBrowserAssetOverlayShape(record, "linux");
    applyBrowserAssetOverlayMouseEvents(record);

    expect(record.shapeInteractive).toBe(false);
    expect(record.window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
  });

  it("restores click-through immediately when a cross-window drop completes", () => {
    const record = makeRecord(vi.fn());

    setBrowserAssetOverlayDragInteractive(record, true);
    record.pointerInteractive = true;
    expect(record.dragInteractive).toBe(true);
    finishBrowserAssetOverlayDrag(record);

    expect(record.dragInteractive).toBe(false);
    expect(record.pointerInteractive).toBe(false);
    expect(record.dragInteractiveResetTimer).toBeNull();
    expect(record.window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
  });
});
