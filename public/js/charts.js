// Minimal hand-rolled SVG chart renderers - no external charting library
// needed for a couple of simple line/bar views.

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function axisLabelStep(count) {
  return Math.max(1, Math.floor(count / 6));
}

export function renderLineChart(svg, points, { padding = 32, color = "#2e7d32", axisColor = "#b9c4b3", textColor = "#6b7563" } = {}) {
  svg.innerHTML = "";
  if (!points.length) return;

  const vb = svg.viewBox.baseVal;
  const w = vb.width || 600;
  const h = vb.height || 220;
  const maxY = Math.max(...points.map((p) => p.value), 1);
  const xScale = (i) => padding + (i / Math.max(points.length - 1, 1)) * (w - 2 * padding);
  const yScale = (v) => h - padding - (v / maxY) * (h - 2 * padding);

  svg.appendChild(el("line", { x1: padding, y1: h - padding, x2: w - padding, y2: h - padding, stroke: axisColor, "stroke-width": 1 }));
  svg.appendChild(el("line", { x1: padding, y1: padding, x2: padding, y2: h - padding, stroke: axisColor, "stroke-width": 1 }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(p.value)}`).join(" ");
  svg.appendChild(el("path", { d: path, fill: "none", stroke: color, "stroke-width": 2 }));

  const step = axisLabelStep(points.length);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) {
      const t = el("text", { x: xScale(i), y: h - padding + 14, "font-size": 9, "text-anchor": "middle", fill: textColor });
      t.textContent = p.label;
      svg.appendChild(t);
    }
  });

  const maxLabel = el("text", { x: padding - 6, y: padding, "font-size": 9, "text-anchor": "end", fill: textColor });
  maxLabel.textContent = maxY.toFixed(0);
  svg.appendChild(maxLabel);
}

export function renderBarChart(svg, bars, { padding = 32, color = "#3b82c4", axisColor = "#b9c4b3", textColor = "#6b7563" } = {}) {
  svg.innerHTML = "";
  if (!bars.length) return;

  const vb = svg.viewBox.baseVal;
  const w = vb.width || 600;
  const h = vb.height || 220;
  const maxY = Math.max(...bars.map((b) => b.value), 1);
  const bw = (w - 2 * padding) / bars.length;

  svg.appendChild(el("line", { x1: padding, y1: h - padding, x2: w - padding, y2: h - padding, stroke: axisColor, "stroke-width": 1 }));

  bars.forEach((b, i) => {
    const barH = (b.value / maxY) * (h - 2 * padding);
    const x = padding + i * bw + bw * 0.15;
    const y = h - padding - barH;
    svg.appendChild(el("rect", { x, y, width: bw * 0.7, height: Math.max(barH, 0), fill: color, rx: 2 }));
    if (bars.length <= 14) {
      const t = el("text", { x: x + bw * 0.35, y: h - padding + 14, "font-size": 9, "text-anchor": "middle", fill: textColor });
      t.textContent = b.label;
      svg.appendChild(t);
    }
  });

  const maxLabel = el("text", { x: padding - 6, y: padding, "font-size": 9, "text-anchor": "end", fill: textColor });
  maxLabel.textContent = maxY.toFixed(2);
  svg.appendChild(maxLabel);
}
