/**
 * Tests for reflection-retry.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isTransientUpstreamError,
  isNonRetryError,
  classifyRetry,
  computeRetryDelayMs,
  runWithTransientRetryOnce,
  type RetryState,
} from '../utils/reflection-retry.ts';

describe('isTransientUpstreamError', () => {
  it('detects timeout', () => {
    assert.strictEqual(isTransientUpstreamError(new Error('Request timed out')), true);
  });
  it('detects connection reset', () => {
    assert.strictEqual(isTransientUpstreamError(new Error('Connection reset')), true);
  });
  it('detects 503', () => {
    assert.strictEqual(isTransientUpstreamError('HTTP status 503'), true);
  });
  it('rejects non-transient', () => {
    assert.strictEqual(isTransientUpstreamError(new Error('Invalid API key')), false);
  });
});

describe('isNonRetryError', () => {
  it('detects auth errors', () => {
    assert.strictEqual(isNonRetryError(new Error('401 Unauthorized')), true);
  });
  it('detects quota errors', () => {
    assert.strictEqual(isNonRetryError('Quota exceeded'), true);
  });
  it('rejects transient', () => {
    assert.strictEqual(isNonRetryError(new Error('timeout')), false);
  });
});

describe('classifyRetry', () => {
  it('retries transient upstream failure', () => {
    const result = classifyRetry({
      inReflectionScope: true,
      retryCount: 0,
      usefulOutputChars: 0,
      error: new Error('503 Service Unavailable'),
    });
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(result.reason, 'transient_upstream_failure');
  });
  it('blocks retry already used', () => {
    const result = classifyRetry({
      inReflectionScope: true,
      retryCount: 1,
      usefulOutputChars: 0,
      error: new Error('timeout'),
    });
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(result.reason, 'retry_already_used');
  });
  it('blocks non-retry error', () => {
    const result = classifyRetry({
      inReflectionScope: true,
      retryCount: 0,
      usefulOutputChars: 0,
      error: new Error('401 Unauthorized'),
    });
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(result.reason, 'non_retry_error');
  });
});

describe('computeRetryDelayMs', () => {
  it('returns value in 1000-3000 range', () => {
    const delay = computeRetryDelayMs();
    assert.ok(delay >= 1000 && delay < 3000);
  });
});

describe('runWithTransientRetryOnce', () => {
  it('returns result on success', async () => {
    const result = await runWithTransientRetryOnce({
      scope: 'embedding',
      runner: 'api',
      retryState: { count: 0 },
      execute: async () => 'ok',
    });
    assert.strictEqual(result, 'ok');
  });
  it('retries on transient error then succeeds', async () => {
    let calls = 0;
    const result = await runWithTransientRetryOnce({
      scope: 'embedding',
      runner: 'api',
      retryState: { count: 0 },
      execute: async () => {
        calls++;
        if (calls === 1) throw new Error('HTTP status 503');
        return 'ok';
      },
      sleep: async () => {
        /* no delay */
      },
    });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 2);
  });
  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await assert.rejects(async () => {
      await runWithTransientRetryOnce({
        scope: 'embedding',
        runner: 'api',
        retryState: { count: 0 },
        execute: async () => {
          calls++;
          throw new Error('401 Unauthorized');
        },
      });
    });
    assert.strictEqual(calls, 1);
  });
});
