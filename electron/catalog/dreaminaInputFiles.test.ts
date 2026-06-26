import { describe, it, expect } from "vitest";
import { toUrlList, shapeFileParam } from "./dreaminaInputFiles";

describe("toUrlList", () => {
  it("string → 单元素", () => {
    expect(toUrlList("nomi-local://x")).toEqual(["nomi-local://x"]);
  });
  it("string[] → 展平去空", () => {
    expect(toUrlList(["a", "", "b"])).toEqual(["a", "b"]);
  });
  it("缺省/非串 → 空", () => {
    expect(toUrlList(undefined)).toEqual([]);
    expect(toUrlList(123)).toEqual([]);
  });
});

describe("shapeFileParam", () => {
  it("single 取首个路径", () => {
    expect(shapeFileParam({ param: "p", expose: "e", mode: "single" }, ["/a.png", "/b.png"])).toBe("/a.png");
    expect(shapeFileParam({ param: "p", expose: "e", mode: "single" }, [])).toBe("");
  });
  it("csv 逗号连接（image2image --images）", () => {
    expect(shapeFileParam({ param: "p", expose: "e", mode: "csv" }, ["/a.png", "/b.png"])).toBe("/a.png,/b.png");
  });
  it("repeat 映射成 flag=path 数组（multimodal --image 重复）", () => {
    expect(shapeFileParam({ param: "p", expose: "e", mode: "repeat", flag: "--image" }, ["/a.png", "/b.png"])).toEqual([
      "--image=/a.png",
      "--image=/b.png",
    ]);
  });
});
