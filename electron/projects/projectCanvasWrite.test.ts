import { expect, it } from "vitest";
import { serializeProjectCanvasWrite } from "./projectCanvasWrite";


it("serializes by project, preserves rejection, and continues in FIFO order", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const failed = serializeProjectCanvasWrite("one", async () => {
    calls.push("first");
    await held;
    throw new Error("first write failed");
  });
  const second = serializeProjectCanvasWrite("one", async () => calls.push("second"));
  const third = serializeProjectCanvasWrite("one", async () => calls.push("third"));
  try {
    await serializeProjectCanvasWrite("two", async () => calls.push("other project"));
    expect(calls).toEqual(["first", "other project"]);
  } finally {
    release();
    await expect(failed).rejects.toThrow("first write failed");
    await Promise.all([second, third]);
  }
  expect(calls).toEqual(["first", "other project", "second", "third"]);
});
