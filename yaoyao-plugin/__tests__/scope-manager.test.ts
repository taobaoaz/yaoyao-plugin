/**
 * Tests for scope-manager.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SimpleScopeManager,
  DEFAULT_SCOPE_CONFIG,
  resolveMemoryScope,
  isSystemBypassId,
} from '../utils/scope-manager.ts';

describe('SimpleScopeManager', () => {
  it('returns global as default', () => {
    const mgr = new SimpleScopeManager();
    assert.strictEqual(mgr.getDefaultScope(), 'global');
  });
  it('returns agent scope for agentId', () => {
    const mgr = new SimpleScopeManager();
    assert.ok(mgr.getAccessibleScopes('test-agent').includes('agent:test-agent'));
  });
  it('allows global access to all', () => {
    const mgr = new SimpleScopeManager();
    assert.strictEqual(mgr.isAccessible('global', 'any-agent'), true);
  });
  it('validates known scope patterns', () => {
    const mgr = new SimpleScopeManager();
    assert.strictEqual(mgr.validateScope('global'), true);
    assert.strictEqual(mgr.validateScope('agent:test'), true);
    assert.strictEqual(mgr.validateScope('custom:foo'), true);
    assert.strictEqual(mgr.validateScope('invalid'), false);
    assert.strictEqual(mgr.validateScope(''), false);
  });
  it('supports custom scope registration', () => {
    const mgr = new SimpleScopeManager();
    mgr.addScope('custom:project1', { description: 'Project 1' });
    assert.strictEqual(mgr.getScopeDefinition('custom:project1')?.description, 'Project 1');
  });
  it('supports agent access grants', () => {
    const mgr = new SimpleScopeManager();
    mgr.grantAccess('agent-a', ['custom:project1', 'custom:project2']);
    assert.ok(mgr.isAccessible('custom:project1', 'agent-a'));
    assert.ok(!mgr.isAccessible('custom:project1', 'agent-b'));
  });
});

describe('resolveMemoryScope', () => {
  it('uses explicit scope when valid', () => {
    const mgr = new SimpleScopeManager();
    assert.strictEqual(resolveMemoryScope('agent-1', 'custom:foo', mgr), 'custom:foo');
  });
  it('falls back to agent scope', () => {
    const mgr = new SimpleScopeManager();
    assert.strictEqual(resolveMemoryScope('agent-1', undefined, mgr), 'agent:agent-1');
  });
  it('falls back to global without agentId', () => {
    assert.strictEqual(resolveMemoryScope(undefined), 'global');
  });
});

describe('isSystemBypassId', () => {
  it('detects system bypass', () => {
    assert.strictEqual(isSystemBypassId('system'), true);
    assert.strictEqual(isSystemBypassId('undefined'), true);
    assert.strictEqual(isSystemBypassId('normal-agent'), false);
  });
});
