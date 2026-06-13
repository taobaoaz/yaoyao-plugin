/**
 * core/atomic/store.ts — Atomic fact storage and retrieval.
 */
class InMemoryFactStore {
    facts = new Map();
    subjectIndex = new Map();
    entityIndex = new Map();
    add(fact) {
        this.facts.set(fact.id, fact);
        // Index by subject
        const subjectSet = this.subjectIndex.get(fact.subject) ?? new Set();
        subjectSet.add(fact.id);
        this.subjectIndex.set(fact.subject, subjectSet);
        // Index by all entities (subject + object + tags)
        const entities = [fact.subject, fact.object, ...fact.tags];
        for (const entity of entities) {
            const entitySet = this.entityIndex.get(entity) ?? new Set();
            entitySet.add(fact.id);
            this.entityIndex.set(entity, entitySet);
        }
    }
    getBySubject(subject) {
        const ids = this.subjectIndex.get(subject) ?? new Set();
        return [...ids].map((id) => this.facts.get(id)).filter(Boolean);
    }
    getByEntity(entity) {
        const ids = this.entityIndex.get(entity) ?? new Set();
        return [...ids].map((id) => this.facts.get(id)).filter(Boolean);
    }
    getAll() {
        return [...this.facts.values()];
    }
    remove(id) {
        const fact = this.facts.get(id);
        if (!fact)
            return;
        this.facts.delete(id);
        // Clean up indices
        const subjectSet = this.subjectIndex.get(fact.subject);
        if (subjectSet) {
            subjectSet.delete(id);
            if (subjectSet.size === 0)
                this.subjectIndex.delete(fact.subject);
        }
        const entities = [fact.subject, fact.object, ...fact.tags];
        for (const entity of entities) {
            const entitySet = this.entityIndex.get(entity);
            if (entitySet) {
                entitySet.delete(id);
                if (entitySet.size === 0)
                    this.entityIndex.delete(entity);
            }
        }
    }
}
let store = null;
export function initFactStore() {
    if (!store)
        store = new InMemoryFactStore();
    return store;
}
export function saveFact(fact) {
    initFactStore().add(fact);
}
export function findFactsBySubject(subject) {
    return initFactStore().getBySubject(subject);
}
export function findFactsByEntity(entity) {
    return initFactStore().getByEntity(entity);
}
export function getAllFacts() {
    return initFactStore().getAll();
}
