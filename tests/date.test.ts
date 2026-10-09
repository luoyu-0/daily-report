import {describe, expect, it} from 'vitest';
import {currentChinaDate} from '../src/shared/date.js';

describe('默认日报日期', () => {
  it('不传 --date 时按北京时间取当天', () => {
    expect(currentChinaDate(new Date('2026-10-09T15:59:59Z'))).toBe('2026-10-09');
    expect(currentChinaDate(new Date('2026-10-09T16:00:00Z'))).toBe('2026-10-10');
  });
});

