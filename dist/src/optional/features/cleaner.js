export const cleanerFeature = {
    id: "cleaner",
    name: "Memory Cleaner",
    dependencies: [],
    configKey: "cleanup.enabled",
    defaultEnabled: true,
    init(api, config) {
        if (config.cleanup?.enabled === false) {
            return {
                active: false,
                service: null,
                message: "Memory cleaner disabled",
            };
        }
        return {
            active: true,
            service: {
                l0l1RetentionDays: config.cleanup?.l0l1RetentionDays,
                allowAggressiveCleanup: config.cleanup?.allowAggressiveCleanup,
            },
            message: "Memory cleaner available",
        };
    },
};
