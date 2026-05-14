export const verifyFeature = {
    id: "verify",
    name: "Anti-Hallucination (Verify)",
    dependencies: [],
    configKey: "verify.enabled",
    defaultEnabled: true,
    init(api, config) {
        const verifyCfg = config.verify;
        if (verifyCfg?.enabled === false) {
            return {
                active: false,
                service: null,
                message: "Anti-hallucination marking disabled",
            };
        }
        return {
            active: true,
            service: true,
            message: "Anti-hallucination marking enabled (speculative + correction detection)",
        };
    },
};
