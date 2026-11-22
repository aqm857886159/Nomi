// 元测试用的子 vitest 配置：和默认车道同一套插件、setup、别名，只把 include 换成固定夹具。
// 夹具是「写测试的人会写出来的坏写法」，期望一份份红、好写法一份份绿；锁一失效（含升 vitest 后门换了），元测试就红。
import { fileURLToPath } from "node:url";
import base from "../../../vitest.config";

export default {
  ...base,
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: { ...base.test, include: ["tests/world/fixtures/*.node-test.ts"], exclude: [], retry: 0 },
};
