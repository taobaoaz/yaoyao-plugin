export const qualityFeature = {
    id: "quality",
    name: "Quality Analysis",
    dependencies: [],
    configKey: "quality.enabled",
    defaultEnabled: true,
    init(api, config) {
        const qualityCfg = config.quality;
        if (qualityCfg?.enabled === false) {
            return { active: false, service: null, message: "Quality analysis disabled" };
        }
        return { active: true, service: true, message: "Quality analysis available" };
    },
};
