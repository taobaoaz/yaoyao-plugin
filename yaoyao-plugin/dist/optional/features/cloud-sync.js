export const cloudSyncFeature = {
    id: 'cloud-sync',
    name: 'Cloud Sync',
    dependencies: [],
    configKey: 'cloud.enabled',
    defaultEnabled: true,
    init(api, config) {
        const cloudCfg = config.cloud;
        if (!cloudCfg || cloudCfg.enabled === false) {
            return {
                active: false,
                service: null,
                message: 'Cloud sync disabled',
            };
        }
        // Best-effort: tool registration itself checks credentials at runtime.
        // We just declare the feature as "available" here.
        return {
            active: true,
            service: true,
            message: 'Cloud sync available (credentials checked at runtime)',
            warning: 'Ensure ~/.openclaw/credentials/secrets.env is configured',
        };
    },
};
