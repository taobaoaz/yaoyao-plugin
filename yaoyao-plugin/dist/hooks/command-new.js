import { clearSessionKeywords } from "./recall-session.js";
import { resetSession } from "../utils/session-activity.js";
/** Create and register command:new / command:reset cleanup hooks. */
export function registerCommandNewHook(api) {
    const handler = async (_event, ctx) => {
        const sessionKey = ctx.sessionKey || 'default';
        clearSessionKeywords(sessionKey);
        resetSession(sessionKey);
        api.logger.debug?.(`[yaoyao-memory:command-new] Session ${sessionKey} context cleared`);
    };
    api.on('command:new', handler);
    api.on('command:reset', handler);
    return {
        unregister: () => {
            api.off?.('command:new', handler);
            api.off?.('command:reset', handler);
        },
    };
}
