/**
 * core/recommend/recommend.ts — Pure recommendation algorithm, zero platform awareness.
 *
 * Diversified selection: given a candidate pool and optional scene mapping,
 * return a diverse top-N selection.
 */

export interface Candidate {
  id: string;
  date: string;
  user_text: string;
  asst_text: string;
  score: number;
}

export interface SelectedResult {
  date: string;
  user_text: string;
  asst_text: string;
  score: number;
}

export function diversifiedSelect(
  pool: Candidate[],
  limit: number,
  scenes: Map<string, Set<string>>,
  diversity: number,
  sceneDiversity: boolean
): SelectedResult[] {
  if (!Array.isArray(pool)) throw new TypeError("diversifiedSelect: pool must be an array");
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  if (!(scenes instanceof Map)) throw new TypeError("diversifiedSelect: scenes must be a Map");
  if (!Number.isFinite(diversity) || diversity < 0 || diversity > 1) diversity = 0.5;
  const selected: SelectedResult[] = [];
  const selectedScenes = new Set<string>();
  const workPool = [...pool].sort((a, b) => b.score - a.score);

  while (selected.length < limit && workPool.length > 0) {
    let pickIdx = 0;
    if (sceneDiversity && diversity > 0) {
      let foundDiverse = false;
      for (let i = 0; i < workPool.length; i++) {
        const memId = workPool[i].id;
        const memScenes = scenes.get(memId) || scenes.get(memId.replace(".md", ""));
        if (!memScenes || memScenes.size === 0) {
          pickIdx = i;
          foundDiverse = true;
          break;
        }
        const fresh = [...memScenes].some(s => !selectedScenes.has(s));
        if (fresh) {
          pickIdx = i;
          foundDiverse = true;
          for (const s of memScenes) selectedScenes.add(s);
          break;
        }
      }
      if (!foundDiverse) {
        pickIdx = Math.floor(Math.random() * workPool.length);
      }
    }

    const picked = workPool.splice(pickIdx, 1)[0];
    selected.push({
      date: picked.date,
      user_text: picked.user_text,
      asst_text: picked.asst_text,
      score: picked.score,
    });
  }

  return selected;
}

export function formatRecommendations(
  selected: SelectedResult[],
  context: string,
  diversity: number
): string {
  if (!Array.isArray(selected)) throw new TypeError("formatRecommendations: selected must be an array");
  if (typeof context !== "string") context = "";
  const lines = selected.map((r, i) => {
    const scoreBar = "█".repeat(Math.round(r.score * 10));
    return `${i + 1}. [${r.date}] ${r.user_text}  ${scoreBar}`;
  });

  return [
    `## 记忆推荐`,
    `基于: "${context}"`,
    `多样化: ${(diversity * 100).toFixed(0)}%`,
    ``,
    ...lines,
  ].join("\n");
}
