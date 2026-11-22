# 0.24.1 正式包退出时的真实待删项目

未经编辑的正式包落盘载荷；原始文件 SHA256 `ec8a51d2886a8151332648aaaea7924de6ce50ad0f6fb88e132d0601726b8c5c`。由隔离测试项目创建，不含用户真实资料。原文件名 `project.after-0.24.1-quit.json`，内含无来源标记的 `assets/generated/liveness-v2.jpg` pending。图片字节来自 `resources/onboarding-demo/shot-3.jpg` / `shot-4.jpg`，不复制二进制。

新版本打开必须忽略所有无标记回收意图；`assetLivenessScan.test.ts` 验证不执行、不请求写回。真实窗口的文件留存、素材库及旧版兼容重开另由 `asset-liveness-storyboard-ref.walk.mjs` 的 `NOMI_WALK_OLD_SOURCE` 模式验证。
