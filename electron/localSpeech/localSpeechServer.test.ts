import { describe, expect, it } from "vitest";
import { buildServerArgs } from "./localSpeechServer";

/**
 * 这两条不变量都是**静默错误**的来路：错了不会抛、不会红，只会悄悄出一份不对的稿子。
 * 所以它们必须由测试盯着，不能只写在注释里（R17）。
 */
describe("本地转写 sidecar 启动参数", () => {
  const args = buildServerArgs({ modelPath: "/m/ggml.bin", vadModelPath: "/m/ggml-silero.bin", port: 51234 });

  it("VAD 必须常开且带上模型路径——关掉它，片头静音会让引擎幻听并复读，把后面的真人讲话一起吞掉", () => {
    expect(args).toContain("--vad");
    const at = args.indexOf("--vad-model");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(args[at + 1]).toBe("/m/ggml-silero.bin");
  });

  it("语言必须 auto——CLI 默认值是 en，兜底当英文处理就是对中文输入的静默错误（硬约束①②）", () => {
    const at = args.indexOf("-l");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(args[at + 1]).toBe("auto");
  });

  it("只听回环，端口按传入值——不听 0.0.0.0，那等于在用户机器上开一个谁都能喂音频的转写服务", () => {
    expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
    expect(args[args.indexOf("--port") + 1]).toBe("51234");
  });
});
