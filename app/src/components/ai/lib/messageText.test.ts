import { describe, expect, it } from 'vitest';
import { answerActionText } from './messageText';
import { encodeToolPatch } from './toolEvent';

describe('answerActionText', () => {
  it('keeps only assistant answer prose for copy and translation actions', () => {
    const text = [
      '⚙ 路由：Claude Code · 模型：sonnet',
      '⏱ 10:00:00 → 10:00:01 · 耗时 1s',
      '<think>private reasoning</think>',
      '第一段。',
      '🔧 command_execution: npm run typecheck',
      '第二段。' +
        encodeToolPatch({
          id: 'tool-1',
          name: 'Read',
          subject: 'app/src/App.tsx',
          status: 'done',
          result: 'secret tool output',
        }),
      '第三段。',
    ].join('\n');

    expect(answerActionText(text)).toBe('第一段。\n\n第二段。\n\n第三段。');
  });
});
