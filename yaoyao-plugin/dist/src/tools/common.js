/** Wrap a tool execute handler with try/catch for consistent error handling */
export function withErrorHandling(handler) {
    return async (id, params) => {
        try {
            return await handler(id, params);
        }
        catch (err) {
            return { content: [{ type: "text", text: `❌ 记忆操作出错: ${err.message || "未知错误"}` }] };
        }
    };
}
