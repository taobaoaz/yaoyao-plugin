/**
 * core/atomic/store.ts — Atomic fact storage and retrieval.
 */

import type { AtomicFact } from "./types.ts";

interface FactStore {
  add(fact: AtomicFact): void;
  getBySubject(subject: string): AtomicFact[];
  getByEntity(entity: string): AtomicFact[];
  getAll(): AtomicFact[];
  remove(id: string): void;
}

class InMemoryFactStore implements FactStore {
  private facts = new Map<string, AtomicFact>();
  private subjectIndex = new Map<string, Set<string>>();
  private entityIndex = new Map<string, Set<string>>();

  add(fact: AtomicFact): void {
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

  getBySubject(subject: string): AtomicFact[] {
    const ids = this.subjectIndex.get(subject) ?? new Set();
    return [...ids].map((id) => this.facts.get(id)!).filter(Boolean);
  }

  getByEntity(entity: string): AtomicFact[] {
    const ids = this.entityIndex.get(entity) ?? new Set();
    return [...ids].map((id) => this.facts.get(id)!).filter(Boolean);
  }

  getAll(): AtomicFact[] {
    return [...this.facts.values()];
  }

  remove(id: string): void {
    const fact = this.facts.get(id);
    if (!fact) return;

    this.facts.delete(id);

    // Clean up indices
    const subjectSet = this.subjectIndex.get(fact.subject);
    if (subjectSet) {
      subjectSet.delete(id);
      if (subjectSet.size === 0) this.subjectIndex.delete(fact.subject);
    }

    const entities = [fact.subject, fact.object, ...fact.tags];
    for (const entity of entities) {
      const entitySet = this.entityIndex.get(entity);
      if (entitySet) {
        entitySet.delete(id);
        if (entitySet.size === 0) this.entityIndex.delete(entity);
      }
    }
  }
}

let store: FactStore | null = null;

export function initFactStore(): FactStore {
  if (!store) store = new InMemoryFactStore();
  return store;
}

export function saveFact(fact: AtomicFact): void {
  initFactStore().add(fact);
}

export function findFactsBySubject(subject: string): AtomicFact[] {
  return initFactStore().getBySubject(subject);
}

export function findFactsByEntity(entity: string): AtomicFact[] {
  return initFactStore().getByEntity(entity);
}

export function getAllFacts(): AtomicFact[] {
  return initFactStore().getAll();
}
