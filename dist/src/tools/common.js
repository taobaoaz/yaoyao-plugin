/** Wrap a tool execute handler with try/catch for consistent error handling.
 *  Adds optional execution timeout protection.
 */
export function withErrorHandling(handler, timeoutMs = 10000) {
    return async (id, params) => {
        try {
            const result = await Promise.race([
                handler(id, params),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool execution timeout (${timeoutMs}ms)`)), timeoutMs)
                ),
            ]);
            return result;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `❌ 记忆操作出错: ${msg}` }] };
        }
    };
}
