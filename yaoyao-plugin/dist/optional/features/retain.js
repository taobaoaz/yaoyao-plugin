export const retainFeature = {
    id: 'retain',
    name: 'Retain Check',
    dependencies: [],
    configKey: 'retain.enabled',
    defaultEnabled: true,
    init(api, config) {
        const retainCfg = config.retain;
        if (retainCfg?.enabled === false) {
            return { active: false, service: null, message: 'Retain check disabled' };
        }
        return { active: true, service: true, message: 'Retain check available' };
    },
};
