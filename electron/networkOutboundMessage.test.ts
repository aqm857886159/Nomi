import { afterEach, describe, expect, it } from "vitest";
import { setDesktopLocale } from "./i18n";
import { describeOutboundRefusal } from "./networkOutboundMessage";

describe("describeOutboundRefusal：Agent 读网页被拒时的文字", () => {
  afterEach(() => setDesktopLocale("zh-CN"));

  it("代理合成地址（198.18.x.x）没确认：说「本机代理给的临时地址」，不叫它内网地址", () => {
    setDesktopLocale("zh-CN");
    const zh = describeOutboundRefusal({ reason: "private-address", hostname: "docs.example.com", observedAddress: "198.18.0.140" });
    expect(zh).toContain("本机代理给的临时地址");
    expect(zh).toContain("198.18.x.x");
    expect(zh).not.toContain("内网");
    expect(zh).toContain("检查代理");
    expect(zh).toContain("直接粘贴进来");
    setDesktopLocale("en");
    const en = describeOutboundRefusal({ reason: "private-address", hostname: "docs.example.com", observedAddress: "198.18.0.140" });
    expect(en).toContain("temporary address handed out by your local proxy");
    expect(en).not.toMatch(/private/i);
    expect(en).toContain("paste the document text");
  });

  it("真的内网地址：文字照旧", () => {
    setDesktopLocale("zh-CN");
    expect(describeOutboundRefusal({ reason: "private-address", hostname: "x.example.com", observedAddress: "192.168.1.9" })).toContain("解析到内网地址 192.168.x.x");
  });
});
