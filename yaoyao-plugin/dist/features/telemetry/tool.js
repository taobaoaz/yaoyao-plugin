/**
 * features/telemetry/tool.ts — Telemetry query tool (website backend).
 */
import { withErrorHandling } from "../../tools/common.js";
export function createTelemetryTool(config) {
    const baseUrl = config.url || process.env.YAOYAO_TELEMETRY_URL || 'https://yaoyao.dev';
    return {
        id: 'memory_telemetry',
        name: 'memory_telemetry',
        label: '安装统计',
        description: '查看 yaoyao-memory 遥测统计数据（匿名、可关闭）',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['stats', 'heartbeat_now'],
                    description: 'stats=查看统计, heartbeat_now=立即发送一次心跳',
                },
            },
            required: ['action'],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action || 'stats');
            if (action === 'heartbeat_now') {
                const { buildPayload, sendHeartbeat } = await import("../../utils/telemetry.js");
                const payload = buildPayload('1.7.2', 'full');
                await sendHeartbeat(payload, baseUrl + '/api/heartbeat');
                return { content: [{ type: 'text', text: '心跳已发送' }] };
            }
            // stats — tRPC endpoint
            const res = await fetch(`${baseUrl}/api/trpc/telemetry.stats`);
            if (!res.ok) {
                return { content: [{ type: 'text', text: `查询失败: HTTP ${res.status}` }] };
            }
            const json = (await res.json());
            const stats = json.result?.data?.json;
            if (!stats) {
                return { content: [{ type: 'text', text: '暂无统计数据' }] };
            }
            const lines = [
                '## 📊 Yaoyao 遥测统计',
                '',
                `**活跃 Agent**: ${stats.activeAgents}（最近 5 分钟）`,
                `**总心跳数**: ${stats.totalHeartbeats}`,
                `**今日心跳**: ${stats.todayHeartbeats}`,
                '',
                '**版本分布**:',
                ...Object.entries(stats.versionBreakdown).map(([v, c]) => `- ${v}: ${c}`),
                '',
                '**模式分布**:',
                `- lite: ${stats.modeBreakdown.lite}`,
                `- full: ${stats.modeBreakdown.full}`,
                '',
                '---',
                '数据来自匿名心跳上报，不含任何用户内容或个人信息。',
                '关闭方式: 设置环境变量 YAOYAO_TELEMETRY=0',
            ];
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }),
    };
}
