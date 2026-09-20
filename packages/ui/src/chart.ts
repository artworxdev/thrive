import type { StatsSample } from '@thrive/core';

/** Population over time. Redrawn from the series on every update. */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  series: StatsSample[],
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = '#2c3644';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  if (series.length < 2) return;

  const peak = Math.max(1, ...series.map((s) => s.population));
  const lastYear = Math.max(1, series[series.length - 1]!.year);

  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((sample, index) => {
    const x = (sample.year / lastYear) * (width - 2) + 1;
    const y = height - 1 - (sample.population / peak) * (height - 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#8a97a8';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('peak ' + String(peak), 6, 14);
  ctx.fillText('year ' + lastYear.toFixed(0), width - 60, height - 6);
}
