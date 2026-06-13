/**
 * storage/bridge-adapter.ts — DBBridge ⇄ Storage 类型适配层
 *
 * v1.7.5 引入：消除 `db as unknown as Storage` 这种散落且不安全的强转。
 *
 * 设计：
 *   - toStorage(db) —— 把 DBBridge 显式收窄为 Storage，消除 unknown
 *   - pickStorage(storage, db) —— 优先级 (storage || db) 收敛到一处
 *
 * 历史：
 *   DBBridge 与 Storage 实际为同一类型别名（见 utils/db-bridge.ts），
 *   但调用点长期写 `db as unknown as Storage` 是因为参数类型不一致。
 *   现在所有这些点统一调用 pickStorage()，新代码禁止再用 as unknown as。
 */
/**
 * DBBridge → Storage 显式适配。
 *
 * 注意：DBStructurally，DBBridge 本身就是 `Storage` 的别名（来自
 * utils/db-bridge.ts：`export type DBBridge = import('../storage/bridge.ts').Storage`）。
 * 但调用方为求简洁，历史上以 `as unknown as Storage` 跳过类型检查。
 * 本函数提供类型安全的"等价转换"，未来如果二者真出现差异，只需在此处实现。
 */
export function toStorage(db) {
    return db;
}
/**
 * 工具注册场景的存储选择器：优先用显式传入的 storage，回落到 db。
 *
 * 替换前：
 *   const pipeline = createSearchPipeline(storage ?? (db as unknown as Storage), embedding);
 * 替换后：
 *   const pipeline = createSearchPipeline(pickStorage(storage, db), embedding);
 *
 * 优势：① 减少重复模式 ② 集中维护 fallback 策略 ③ 静态分析能跟踪类型
 */
export function pickStorage(storage, db) {
    return storage ?? toStorage(db);
}
