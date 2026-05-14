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
        // Cleaner needs store.baseDir and db — but we pass them at registration time
        // The feature just declares availability here.
        return {
            active: true,
            service: null, // will be created in entry/index.ts with store/db
            message: "Memory cleaner available",
        };
    },
};
