/**
 * core/skills/analyzer.ts — Pattern analysis and suggestion generation.
 */
import { getPatterns, getToolStats } from "./tracker.js";
function generateShortcutSuggestion(patterns) {
    // Find frequent multi-step patterns that could be a single command
    const searchPatterns = patterns.filter((p) => p.toolId.includes("search"));
    if (searchPatterns.length >= 3) {
        return {
            type: "shortcut",
            description: "You frequently search memories. Consider creating a custom search shortcut.",
            confidence: 0.7,
            estimatedImpact: "Save 2-3 seconds per search",
            implementationHint: "Add a slash command /ms <query> that directly calls memory_search",
        };
    }
    return null;
}
function generateOptimizationSuggestion(patterns) {
    // Find slow patterns
    const slowPatterns = patterns.filter((p) => p.avgDurationMs > 1000);
    if (slowPatterns.length > 0) {
        const slowest = slowPatterns.sort((a, b) => b.avgDurationMs - a.avgDurationMs)[0];
        return {
            type: "optimization",
            description: `${slowest.toolId} is slow (avg ${slowest.avgDurationMs.toFixed(0)}ms). Consider adding caching or indexing.`,
            confidence: 0.6,
            estimatedImpact: `Reduce ${slowest.toolId} time by 50-70%`,
            implementationHint: "Add an in-memory LRU cache for frequent queries",
        };
    }
    return null;
}
function generateAutomationSuggestion(patterns) {
    // Find repetitive sequences
    const frequentPatterns = patterns.filter((p) => p.frequency >= 5);
    if (frequentPatterns.length >= 2) {
        return {
            type: "automation",
            description: `Detected ${frequentPatterns.length} frequent patterns. Consider batch operations.`,
            confidence: 0.5,
            estimatedImpact: "Reduce repetitive actions by 60%",
            implementationHint: "Add a batch mode that chains multiple operations",
        };
    }
    return null;
}
function generateNewFeatureSuggestion() {
    const stats = getToolStats("memory_search");
    if (stats && stats.count > 20) {
        return {
            type: "new_feature",
            description: "High search usage detected. Consider adding search history or saved searches.",
            confidence: 0.8,
            estimatedImpact: "Improve search efficiency by 40%",
            implementationHint: "Add a 'recent searches' panel and 'save search' feature",
        };
    }
    return null;
}
export function analyzeSkills() {
    const patterns = getPatterns(2);
    const suggestions = [];
    const shortcut = generateShortcutSuggestion(patterns);
    if (shortcut)
        suggestions.push(shortcut);
    const optimization = generateOptimizationSuggestion(patterns);
    if (optimization)
        suggestions.push(optimization);
    const automation = generateAutomationSuggestion(patterns);
    if (automation)
        suggestions.push(automation);
    const newFeature = generateNewFeatureSuggestion();
    if (newFeature)
        suggestions.push(newFeature);
    return suggestions.sort((a, b) => b.confidence - a.confidence);
}
export function formatSuggestions(suggestions) {
    if (suggestions.length === 0)
        return "No skill suggestions yet. Keep using the tools!";
    const lines = [`## 💡 Skill Suggestions (${suggestions.length})`, ""];
    for (const s of suggestions) {
        const typeEmoji = {
            shortcut: "⚡",
            optimization: "🚀",
            automation: "🤖",
            new_feature: "✨",
        };
        lines.push(`### ${typeEmoji[s.type] ?? "💡"} ${s.type.toUpperCase()}`);
        lines.push(`**${s.description}**`);
        lines.push(`- Confidence: ${(s.confidence * 100).toFixed(0)}%`);
        lines.push(`- Impact: ${s.estimatedImpact}`);
        lines.push(`- Hint: ${s.implementationHint}`);
        lines.push("");
    }
    return lines.join("\n");
}
