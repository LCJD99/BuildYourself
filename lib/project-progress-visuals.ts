import type { ProjectProgressObservation } from './project-progress';

export type LatencyChartGeometry = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  plotWidth: number;
  plotHeight: number;
  minMs: number;
  maxMs: number;
  timeScale: 'timestamp' | 'ordinal';
  xAxisLabel: string;
  yTicks: Array<{ value: number; y: number }>;
  points: Array<ProjectProgressObservation & { x: number; y: number }>;
};

export function latencyChartGeometry(observations: ProjectProgressObservation[]): LatencyChartGeometry | null {
  if (observations.length < 2) return null;

  const values = observations.map(item => item.value);
  const times = observations.map(item => Date.parse(item.observedAt));
  const minMs = Math.min(...values);
  const maxMs = Math.max(...values);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeScale = maxTime > minTime ? 'timestamp' : 'ordinal';
  const width = 680;
  const height = 245;
  const plot = { left: 72, right: 24, top: 26, bottom: 54 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const points = observations.map((item, index) => {
    const x = timeScale === 'timestamp'
      ? plot.left + ((Date.parse(item.observedAt) - minTime) / (maxTime - minTime)) * plotWidth
      : plot.left + (index / (observations.length - 1)) * plotWidth;
    const y = maxMs === minMs
      ? plot.top + plotHeight / 2
      : plot.top + ((maxMs - item.value) / (maxMs - minMs)) * plotHeight;
    return { ...item, x, y };
  });
  const yTicks = minMs === maxMs
    ? [{ value: minMs, y: plot.top + plotHeight / 2 }]
    : [{ value: maxMs, y: plot.top }, { value: minMs, y: plot.top + plotHeight }];

  return {
    width, height, plot, plotWidth, plotHeight, minMs, maxMs, timeScale,
    xAxisLabel: timeScale === 'timestamp' ? '观测时间' : '观测记录顺序（时间相同）',
    yTicks, points,
  };
}
