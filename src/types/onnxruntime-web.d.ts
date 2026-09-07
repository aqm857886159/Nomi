/**
 * onnxruntime-web 1.21.0 的 `exports` 映射里**没有 `types` 条件**（上游已知缺陷），
 * 于是 `moduleResolution: bundler` 下 `import ... from "onnxruntime-web"` 拿不到类型，
 * 整个 ort 表面会退化成 `any` —— 张量维度、EP 名字、session 输入输出全部失去检查。
 *
 * 包里其实自带 `types.d.ts`（内容就是 `declare module 'onnxruntime-web' { export * from
 * 'onnxruntime-common' }`），只是 exports 没暴露它。这里把它按引用挂回来：
 * 声明仍然来自上游的 `onnxruntime-common`，不是我们手写的近似值，
 * 也不是 `declare module 'onnxruntime-web';`（那才是把它变成 any）。
 * 上游哪天补了 types 条件，删掉这个文件即可，行为不变。
 */
declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common'
}
