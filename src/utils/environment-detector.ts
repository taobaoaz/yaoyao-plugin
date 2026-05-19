/**
 * utils/environment-detector.ts — Detect runtime environment (OpenClaw vs XiaoYi Claw).
 */

export type ClawEnvironment = "openclaw" | "xiaoyi-claw" | "unknown";

interface EnvironmentFeatures {
  hasPluginSdk: boolean;
  hasXiaoYiApi: boolean;
  hasOpenClawConfig: boolean;
  hasXiaoYiConfig: boolean;
}

function detectFeatures(): EnvironmentFeatures {
  return {
    // OpenClaw 有 plugin-sdk
    hasPluginSdk: typeof require !== "undefined" && 
      (() => {
        try {
          require.resolve("openclaw/plugin-sdk");
          return true;
        } catch {
          return false;
        }
      })(),
    
    // 小艺 Claw 有特定 API
    hasXiaoYiApi: typeof globalThis !== "undefined" && 
      "__XIAOYI_CLAW__" in globalThis,
    
    // OpenClaw 配置文件
    hasOpenClawConfig: typeof process !== "undefined" && 
      !!process.env.OPENCLAW_CONFIG_PATH,
    
    // 小艺 Claw 配置文件
    hasXiaoYiConfig: typeof process !== "undefined" && 
      !!process.env.XIAOYI_CLAW_HOME,
  };
}

export function detectEnvironment(): ClawEnvironment {
  const features = detectFeatures();
  
  // 小艺 Claw 优先检测
  if (features.hasXiaoYiApi || features.hasXiaoYiConfig) {
    return "xiaoyi-claw";
  }
  
  // OpenClaw 检测
  if (features.hasPluginSdk || features.hasOpenClawConfig) {
    return "openclaw";
  }
  
  return "unknown";
}

export function isXiaoYiClaw(): boolean {
  return detectEnvironment() === "xiaoyi-claw";
}

export function isOpenClaw(): boolean {
  return detectEnvironment() === "openclaw";
}
