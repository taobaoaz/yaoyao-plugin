import { parseBrandItemPreference, inferAtomicBrandItemPreferenceSlot, normalizePreferenceToken } from "../utils/preference-slots.ts";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("parseBrandItemPreference", () => {
  it("extracts Chinese brand-item", () => {
    const r = parseBrandItemPreference("我喜欢吃麦当劳的巨无霸");
    assert.notStrictEqual(r, null);
    assert.strictEqual(r!.brand, "麦当劳");
    assert.ok(r!.items.includes("巨无霸"));
    assert.strictEqual(r!.aggregate, false);
  });
  it("extracts multiple items", () => {
    const r = parseBrandItemPreference("我喜欢吃肯德基的吮指原味鸡和蛋挞");
    assert.notStrictEqual(r, null);
    assert.strictEqual(r!.brand, "肯德基");
    assert.ok(r!.items.length >= 1);
    assert.strictEqual(r!.aggregate, true);
  });
  it("extracts English brand-item", () => {
    const r = parseBrandItemPreference("I love burgers from McDonald's");
    assert.notStrictEqual(r, null);
    assert.ok(r!.brand.includes("mcdonald"));
  });
  it("returns null for no match", () => {
    assert.strictEqual(parseBrandItemPreference("今天天气不错"), null);
  });
});

describe("inferAtomicBrandItemPreferenceSlot", () => {
  it("returns slot for single item", () => {
    const slot = inferAtomicBrandItemPreferenceSlot("我喜欢吃星巴克的拿铁");
    assert.notStrictEqual(slot, null);
    assert.strictEqual(slot!.type, "brand-item");
    assert.strictEqual(slot!.brand, "星巴克");
    assert.strictEqual(slot!.item, "拿铁");
  });
  it("returns null for aggregate", () => {
    assert.strictEqual(inferAtomicBrandItemPreferenceSlot("我喜欢吃肯德基的炸鸡和可乐"), null);
  });
});

describe("normalizePreferenceToken", () => {
  it("strips punctuation and lowercases", () => {
    assert.strictEqual(normalizePreferenceToken("McDonald's"), "mcdonalds");
    assert.strictEqual(normalizePreferenceToken("《王者荣耀》"), "王者荣耀");
  });
});
