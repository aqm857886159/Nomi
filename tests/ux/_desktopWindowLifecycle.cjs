// 隔离启动器已隔离 profile / 宿主配置；这条走查要走真实保存确认与单实例事件，不能用 E2E 跳过它们。
process.env.NOMI_E2E = ''
process.env.NOMI_E2E_ALLOW_MULTI_INSTANCE = ''
