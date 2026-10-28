import { beforeEach, describe, expect, it, vi } from "vitest";

const browserWindow = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({ BrowserWindow: browserWindow }));

import { browserViews } from "./browserViewState";
import { BrowserViewUnavailableError, getBrowserViewForSender, promptCaptureEventFromConsole } from "./browserViewUtils";
import { BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX } from "./browserViewBridges";
import type { BrowserViewRecord } from "./browserViewTypes";

describe("browser view fire-and-forget race classification", () => {
  beforeEach(() => {
    browserViews.clear();
    browserWindow.fromWebContents.mockReset();
  });

  it("classifies a late message for a destroyed view as a normal unavailable race", () => {
    const sender = { id: 11 };
    browserWindow.fromWebContents.mockReturnValue({ isDestroyed: () => false, getParentWindow: () => null });

    expect(() => getBrowserViewForSender(sender as never, { viewId: 42 })).toThrow(BrowserViewUnavailableError);
    expect(() => getBrowserViewForSender(sender as never, { viewId: 42 })).toThrow("Browser view not found");
  });
});

// 页内「提取」的 console 转发（2026-10-27）：这一行网页自己就能写，所以来源页一律换成视图的真实地址。
describe("prompt capture forward from the page console", () => {
  const record = {
    viewId: 7,
    tabId: "tab-1",
    view: { webContents: { getURL: () => "https://evil.example/x" } },
    lastBounds: { x: 0, y: 0, width: 800, height: 600 },
  } as unknown as BrowserViewRecord;
  const line = (payload: unknown) => BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX + JSON.stringify(payload);

  it("ignores console lines that are not the image prompt prefix", () => {
    expect(promptCaptureEventFromConsole(record, "hello")).toBeNull();
  });

  it("uses the view's real URL as the page, never the page-reported one", () => {
    expect(promptCaptureEventFromConsole(record, line({ url: " https://evil.example/a.png ", pageUrl: "https://nomi.app", extractionMode: "style" }))).toMatchObject({
      ok: true, viewId: 7, tabId: "tab-1", url: "https://evil.example/a.png", pageUrl: "https://evil.example/x", extractionMode: "style",
    });
  });

  it("reports an empty image and a broken payload instead of starting an extraction", () => {
    expect(promptCaptureEventFromConsole(record, line({ url: "" }))).toEqual({ ok: false, viewId: 7, tabId: "tab-1", reason: "empty" });
    expect(promptCaptureEventFromConsole(record, BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX + "{oops")).toMatchObject({ ok: false, reason: "error" });
  });
});
