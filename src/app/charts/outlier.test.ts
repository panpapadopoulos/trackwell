import { describe, expect, it } from 'vitest';
import { outlierScale, type SeriesDef } from './TimeBars';

const series: SeriesDef[] = [{ key: 'v', label: 'V', color: 'x', form: 'solid' }];
const rows = (vals: number[]) => vals.map((v, i) => ({ m: `M${i}`, v }));

describe('chart outlier scaling', () => {
  it('leaves ordinary data alone', () => {
    expect(outlierScale(rows([100, 120, 90, 150, 130, 110]), series, 'm')).toBeNull();
  });
  it('caps the axis above the typical bars and names the outlier', () => {
    const r = outlierScale(rows([100, 120, 90, 12_345_678, 130, 110, 95, 105, 98, 115, 101]), series, 'm');
    expect(r).not.toBeNull();
    expect(r!.outliers).toEqual([{ label: 'M3', value: 12_345_678 }]);
    expect(r!.domain[1]).toBeLessThan(200);
    expect(r!.domain[1]).toBeGreaterThanOrEqual(130);
  });
  it('treats stacked series as one bar', () => {
    const stacked: SeriesDef[] = [
      { key: 'a', label: 'A', color: 'x', form: 'solid', stackId: 's' },
      { key: 'b', label: 'B', color: 'x', form: 'dashed', stackId: 's' },
    ];
    const data = Array.from({ length: 10 }, (_, i) => ({ m: `M${i}`, a: 60, b: 50 }));
    expect(outlierScale(data, stacked, 'm')).toBeNull();
  });
});
