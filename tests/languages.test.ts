import {describe, expect, it} from 'vitest';
import {languageSummary} from '../src/shared/languages.js';

describe('仓库语言展示', () => {
  it('一种语言明显占优时只展示该语言', () => {
    expect(languageSummary({language: 'Jupyter Notebook', languages: [
      {name: 'Python', bytes: 800}, {name: 'TypeScript', bytes: 120}, {name: 'Shell', bytes: 80},
    ]})).toBe('Python');
  });

  it('占比相近时按字节量展示前三种语言', () => {
    expect(languageSummary({languages: [
      {name: 'Go', bytes: 20}, {name: 'Python', bytes: 30}, {name: 'TypeScript', bytes: 35}, {name: 'HTML', bytes: 15},
    ]})).toBe('TypeScript · Python · Go');
  });

  it('旧缓存没有语言比例时沿用主语言', () => {
    expect(languageSummary({language: 'Rust'})).toBe('Rust');
  });
});
