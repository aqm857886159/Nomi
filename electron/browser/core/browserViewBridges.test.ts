import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { resourceCaptureBridgeScript } from "./browserViewBridges";

// 2026-07-22 审计 L0 根因测试：保存时绝不按坐标重新 pick——候选在高亮那一刻冻结。
// hover 换图站点（YouTube 缩略图 hover 切动图）在旧实现下会保存到与用户所见不同的 URL。
// 无 jsdom 依赖：node:vm + 最小 DOM 替身（脚本只用到 listeners/elementsFromPoint/instanceof/URL）。

class FakeElement {
  attrs: Record<string, string> = {};
  rect = { left: 0, top: 0, right: 200, bottom: 150, width: 200, height: 150 };
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  removeAttribute(name: string): void {
    delete this.attrs[name];
  }
  getBoundingClientRect(): typeof this.rect {
    return this.rect;
  }
  closest(): null {
    return null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
}

class FakeImage extends FakeElement {
  src = "";
  currentSrc = "";
  alt = "";
  title = "";
}

type BridgeWindow = {
  location: { href: string };
  innerWidth: number;
  innerHeight: number;
  getComputedStyle: () => { backgroundImage: string };
  __nomiReadBrowserResourceCapture?: () => { url: string } | null;
};

function installBridge(img: FakeImage, enabled = true): {
  bridgeWindow: BridgeWindow;
  listeners: Map<string, (event: unknown) => void>;
} {
  const listeners = new Map<string, (event: unknown) => void>();
  const documentStub = {
    title: "页面标题",
    documentElement: { clientWidth: 1280, clientHeight: 800 },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    elementsFromPoint: () => [img],
  };
  const bridgeWindow: BridgeWindow = {
    location: { href: "https://example.test/page" },
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: () => ({ backgroundImage: "" }),
  };
  const sandbox = {
    window: bridgeWindow,
    document: documentStub,
    getComputedStyle: bridgeWindow.getComputedStyle,
    Element: FakeElement,
    HTMLImageElement: FakeImage,
    HTMLVideoElement: class extends FakeElement {},
    HTMLSourceElement: class extends FakeElement {},
    HTMLAnchorElement: class extends FakeElement {},
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(resourceCaptureBridgeScript(enabled), sandbox);
  return { bridgeWindow, listeners };
}

describe("resourceCaptureBridgeScript 候选冻结", () => {
  it("保存读到的是高亮时冻结的候选；元素 src 事后变化不影响（hover 换图站点）", () => {
    const img = new FakeImage();
    img.src = "https://cdn.example.test/a.jpg";
    const { bridgeWindow, listeners } = installBridge(img);
    const pointerMove = listeners.get("pointermove");
    expect(pointerMove).toBeTypeOf("function");

    pointerMove!({ clientX: 40, clientY: 40, target: img });
    expect(bridgeWindow.__nomiReadBrowserResourceCapture!()?.url).toBe("https://cdn.example.test/a.jpg");

    // 站点 hover 换图：src 切成动图 URL。旧实现（保存时重新 pickAt）会读到新 URL —— 冻结后仍是用户看到的那张。
    img.src = "https://cdn.example.test/hover-animated.webp";
    expect(bridgeWindow.__nomiReadBrowserResourceCapture!()?.url).toBe("https://cdn.example.test/a.jpg");

    // 只有下一次真实 pointermove 才刷新候选（冻结 ≠ 永久 stale）。
    pointerMove!({ clientX: 41, clientY: 40, target: img });
    expect(bridgeWindow.__nomiReadBrowserResourceCapture!()?.url).toBe("https://cdn.example.test/hover-animated.webp");
  });

  it("未开启捕捞模式时不产生候选", () => {
    const img = new FakeImage();
    img.src = "https://cdn.example.test/a.jpg";
    const { bridgeWindow, listeners } = installBridge(img, false);
    listeners.get("pointermove")!({ clientX: 40, clientY: 40, target: img });
    expect(bridgeWindow.__nomiReadBrowserResourceCapture!()).toBeNull();
  });
});
