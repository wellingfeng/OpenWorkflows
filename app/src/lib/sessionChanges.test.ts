import { describe, expect, it } from 'vitest';
import { sessionChangesCacheKey } from './sessionChanges';

describe('sessionChangesCacheKey', () => {
  it('includes the cache algorithm version', () => {
    expect(sessionChangesCacheKey('ws1', 's1', 'E:\\MoonEngine')?.startsWith('v5:')).toBe(true);
  });

  it('scopes cache entries by root path', () => {
    expect(sessionChangesCacheKey('ws1', 's1', 'E:\\OpenWorkflows')).not.toBe(
      sessionChangesCacheKey('ws1', 's1', 'E:\\MoonEngine'),
    );
  });

  it('normalizes slashes and trailing separators', () => {
    expect(sessionChangesCacheKey('ws1', 's1', 'E:\\MoonEngine\\')).toBe(
      sessionChangesCacheKey('ws1', 's1', 'E:/MoonEngine'),
    );
  });
});
