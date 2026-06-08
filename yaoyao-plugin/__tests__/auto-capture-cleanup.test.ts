import {
  stripInboundMetadata,
  stripSessionResetPrefix,
  stripAddressingPrefix,
  stripRuntimeBoilerplate,
  cleanCaptureText,
  isRuntimeWrapperLine,
} from '../utils/auto-capture-cleanup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('stripInboundMetadata', () => {
  it('removes conversation info blocks', () => {
    const text = `Hello there\nConversation info (untrusted metadata):\n\`\`\`json\n{}\n\`\`\`\nHow are you?`;
    assert.strictEqual(stripInboundMetadata(text), 'Hello there\nHow are you?');
  });

  it('removes system event lines', () => {
    const text = 'Hello\nSystem: [exec] Exec completed\nWorld';
    assert.strictEqual(stripInboundMetadata(text), 'Hello\n\nWorld');
  });

  it('passes through clean text', () => {
    assert.strictEqual(stripInboundMetadata('just normal text'), 'just normal text');
  });
});

describe('stripSessionResetPrefix', () => {
  it('strips /new prefix', () => {
    const text =
      'A new session was started via /new or /reset. Execute your Session Startup sequence now\n\nHello';
    assert.strictEqual(stripSessionResetPrefix(text), 'Hello');
  });

  it('passes through normal text', () => {
    assert.strictEqual(stripSessionResetPrefix('Hello world'), 'Hello world');
  });
});

describe('stripAddressingPrefix', () => {
  it('strips @mention', () => {
    assert.strictEqual(stripAddressingPrefix('@yaoyao hello'), 'hello');
    assert.strictEqual(stripAddressingPrefix('<@123456> hello'), 'hello');
  });

  it('passes through plain text', () => {
    assert.strictEqual(stripAddressingPrefix('hello world'), 'hello world');
  });
});

describe('stripRuntimeBoilerplate', () => {
  it('strips subagent boilerplate', () => {
    const text = 'You are running as a subagent. Results auto-announce to your requester. Hello';
    assert.strictEqual(stripRuntimeBoilerplate(text), 'Hello');
  });
});

describe('isRuntimeWrapperLine', () => {
  it('detects runtime wrapper', () => {
    assert.strictEqual(isRuntimeWrapperLine('[Subagent Context] something'), true);
    assert.strictEqual(isRuntimeWrapperLine('normal text'), false);
  });
});

describe('cleanCaptureText', () => {
  it('runs full pipeline', () => {
    const text = '<@123> @yaoyao You are running as a subagent. Hello world';
    assert.strictEqual(cleanCaptureText(text), 'Hello world');
  });
});
