export function buildMergedEntry(members) {
    const seen = new Set();
    const lines = [];
    for (const m of members) {
        for (const line of m.text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !seen.has(trimmed.toLowerCase())) {
                seen.add(trimmed.toLowerCase());
                lines.push(trimmed);
            }
        }
    }
    const text = lines.join('\n');
    const importance = Math.min(1.0, Math.max(...members.map((m) => m.importance)));
    const counts = new Map();
    for (const m of members) {
        counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    }
    let category = 'other';
    let best = 0;
    for (const [cat, count] of counts) {
        if (count > best) {
            best = count;
            category = cat;
        }
    }
    const scope = members[0]?.scope ?? 'default';
    const metadata = JSON.stringify({
        compacted: true,
        sourceCount: members.length,
        compactedAt: Date.now(),
    });
    return { text, importance, category, scope, metadata };
}
