/**
 * Config helper tests — covers getProp, getObj, getBool
 *
 * Run: node --test src/__tests__/config.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getProp, getObj, getBool } from '../utils/config.ts';

describe('config helpers', () => {
  describe('getProp', () => {
    it('returns the value when present', () => {
      assert.strictEqual(getProp({ foo: 42 }, 'foo', 0), 42);
      assert.strictEqual(getProp({ foo: 'bar' }, 'foo', ''), 'bar');
    });

    it('returns default when key missing', () => {
      assert.strictEqual(getProp({}, 'foo', 99), 99);
      assert.strictEqual(getProp({}, 'foo', 'default'), 'default');
    });

    it('returns default when obj is null/undefined', () => {
      assert.strictEqual(getProp(null, 'foo', 1), 1);
      assert.strictEqual(getProp(undefined, 'foo', 2), 2);
    });

    it('returns default when obj is not an object', () => {
      assert.strictEqual(getProp('string', 'foo', 3), 3);
      assert.strictEqual(getProp(123, 'foo', 4), 4);
    });

    it("returns default when value is explicitly null (null means 'not set')", () => {
      assert.strictEqual(getProp({ foo: null }, 'foo', 'default'), 'default');
    });
  });

  describe('getObj', () => {
    it('returns nested object when present', () => {
      const nested = { a: 1 };
      assert.deepStrictEqual(getObj({ capture: nested }, 'capture'), nested);
    });

    it('returns undefined when key missing', () => {
      assert.strictEqual(getObj({}, 'capture'), undefined);
    });

    it('returns undefined when value is not an object', () => {
      assert.strictEqual(getObj({ capture: 123 }, 'capture'), undefined);
      assert.strictEqual(getObj({ capture: 'string' }, 'capture'), undefined);
      assert.strictEqual(getObj({ capture: [1, 2] }, 'capture'), undefined);
    });

    it('returns undefined when obj is null', () => {
      assert.strictEqual(getObj(null, 'capture'), undefined);
    });
  });

  describe('getBool', () => {
    it('returns true when value is true', () => {
      assert.strictEqual(getBool({ flag: true }, 'flag', false), true);
    });

    it('returns false when value is false', () => {
      assert.strictEqual(getBool({ flag: false }, 'flag', true), false);
    });

    it('coerces truthy values to true', () => {
      assert.strictEqual(getBool({ flag: 1 }, 'flag', false), true);
      assert.strictEqual(getBool({ flag: 'yes' }, 'flag', false), true);
    });

    it('coerces falsy values (except null/undefined) to false', () => {
      assert.strictEqual(getBool({ flag: 0 }, 'flag', true), false);
      assert.strictEqual(getBool({ flag: '' }, 'flag', true), false);
    });

    it('returns default when key missing', () => {
      assert.strictEqual(getBool({}, 'flag', true), true);
      assert.strictEqual(getBool({}, 'flag', false), false);
    });

    it('returns default when obj is null', () => {
      assert.strictEqual(getBool(null, 'flag', true), true);
    });
  });
});
