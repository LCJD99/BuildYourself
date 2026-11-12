import { describe, expect, it } from 'vitest';
import type { ProjectProgressObservation } from '../lib/project-progress';
import { latencyChartGeometry } from '../lib/project-progress-visuals';

function observation(id: string, observedAt: string, value: number): ProjectProgressObservation {
  return { id, text: `记录 ${id}`, observedAt, value, source: '测试', reference: id, level: 'E2' };
}

describe('项目趋势图坐标', () => {
  it('单次观测不生成趋势图坐标', () => {
    expect(latencyChartGeometry([observation('one', '2026-11-01T10:00:00.000Z', 350)])).toBeNull();
  });

  it('以真实时间和实际值生成轴与点位，不按记录间隔等距伪造时间', () => {
    const first = observation('first', '2026-11-01T10:00:00.000Z', 350);
    const middle = observation('middle', '2026-11-01T10:30:00.000Z', 300);
    const last = observation('last', '2026-11-01T12:00:00.000Z', 250);
    const geometry = latencyChartGeometry([first, middle, last])!;

    expect(geometry.timeScale).toBe('timestamp');
    expect(geometry.xAxisLabel).toBe('观测时间');
    expect(geometry.points.map(point => point.x)).toEqual([
      geometry.plot.left,
      geometry.plot.left + geometry.plotWidth / 4,
      geometry.width - geometry.plot.right,
    ]);
    expect(geometry.points.map(point => point.y)).toEqual([
      geometry.plot.top,
      geometry.plot.top + geometry.plotHeight / 2,
      geometry.plot.top + geometry.plotHeight,
    ]);
    expect(geometry.yTicks.map(tick => tick.value)).toEqual([350, 250]);
  });

  it('观测时间相同时只用明确标注的等距记录次序并显示实际单值刻度', () => {
    const geometry = latencyChartGeometry([
      observation('same-1', '2026-11-01T10:00:00.000Z', 350),
      observation('same-2', '2026-11-01T10:00:00.000Z', 350),
      observation('same-3', '2026-11-01T10:00:00.000Z', 350),
    ])!;

    expect(geometry.timeScale).toBe('ordinal');
    expect(geometry.xAxisLabel).toContain('时间相同');
    expect(geometry.points.map(point => point.x)).toEqual([
      geometry.plot.left,
      geometry.plot.left + geometry.plotWidth / 2,
      geometry.width - geometry.plot.right,
    ]);
    expect(geometry.yTicks).toEqual([{ value: 350, y: geometry.plot.top + geometry.plotHeight / 2 }]);
  });
});
