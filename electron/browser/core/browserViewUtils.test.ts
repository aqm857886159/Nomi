import { beforeEach, describe, expect, it, vi } from "vitest";

const browserWindow = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({ BrowserWindow: browserWindow }));

import { browserViews } from "./browserViewState";
import { BrowserViewUnavailableError, getBrowserViewForSender } from "./browserViewUtils";

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
