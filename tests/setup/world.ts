// 测试世界的两把锁：tests/setup/world/*.ts 每个文件一把，这里只负责把它们收进来。
// 之后各批只往 tests/setup/world/ 里加文件，不再改这一行接线。
import.meta.glob("./world/*.ts", { eager: true });
