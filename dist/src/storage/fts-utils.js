/**
 * storage/fts-utils.ts — FTS5 query utilities.
 */
/** Normalize FTS5 rank (negative = better) to a [0,1] score */
export function rankToScore(rank) {
    const r = Number(rank);
    if (!Number.isFinite(r))
        return 0.3;
    if (r < 0)
        return Math.min(1, Math.max(0.1, -r / 15));
    return 0.3;
}
/**
 * FTS5 query keywords that must never appear as bare tokens: the parser
 * treats them as operators and throws on missing operands.
 */
const FTS_OPERATOR_WORDS = new Set(["AND", "OR", "NOT", "NEAR"]);
/**
 * Split a raw query into safe FTS5 tokens.
 *
 * The old sanitizer only stripped a few characters, so natural questions
 * crashed FTS5 MATCH: `?` and `'` are syntax errors, `-` is parsed as a
 * column filter (`self-care` → `no such column: care`), `%` is a syntax
 * error. Rebuilding the query from word tokens (Unicode letters/digits,
 * with an optional trailing `*` kept for prefix search) makes it
 * impossible to emit FTS5 syntax. CJK runs stay whole, matching the
 * unicode61 tokenizer; partial CJK matches still go through the LIKE
 * bigram fallback in fts.ts. Bare operator words are dropped.
 */
export function tokenizeFTSQuery(query) {
    const raw = query.match(/[\p{L}\p{N}]+\*?/gu) ?? [];
    const tokens = [];
    let len = 0;
    for (const tok of raw) {
        const word = tok.replace(/\*$/, "");
        if (FTS_OPERATOR_WORDS.has(word.toUpperCase()))
            continue;
        const add = (tokens.length > 0 ? 1 : 0) + tok.length;
        if (len + add > 200 && tokens.length > 0)
            break;
        tokens.push(tok);
        len += add;
    }
    return tokens;
}
/** Sanitize query for FTS5 MATCH syntax (AND-joined tokens). */
export function sanitizeFTSQuery(query) {
    return tokenizeFTSQuery(query).join(" ");
}
