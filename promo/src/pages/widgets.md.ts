import type { APIRoute } from 'astro';

// Markdown mirror of the widgets page.
export const GET: APIRoute = ({ site }) => {
  const u = (p = '') => new URL(p, site).href;
  const body = `# nodrix widgets

Six built-in, framework-agnostic Web Components that take data in and emit command intents out — embed them anywhere.

## Display
- **iot-value** — The latest reading of a single variable, large and legible. Attributes: \`data-title\`, \`data-unit\`.
- **iot-gauge** — An arc gauge for a numeric variable with configurable min/max bounds. Attributes: \`data-title\`, \`data-min\`, \`data-max\`, \`data-unit\`.
- **iot-chart** — A multi-series time-series chart (ApexCharts): line, area, bar, or stepline, with optional drag-to-zoom. Attributes: \`data-title\`, \`data-chart-type\`, \`data-zoom\`.

## Control
- **iot-toggle** — On/off switch that writes a value and reflects last reported state. Attributes: \`data-title\`, \`data-variable\`, \`data-on-value\`, \`data-off-value\`.
- **iot-slider** — Horizontal slider for a numeric write; commits on release. Attributes: \`data-title\`, \`data-variable\`, \`data-min\`, \`data-max\`, \`data-step\`.
- **iot-push** — Momentary push button for one-shot commands. Attributes: \`data-title\`, \`data-variable\`, \`data-value\`, \`data-label\`.

## Links
- Home: ${u()}
- Docs: ${u('docs')}
- Source: https://github.com/decoded-cipher/nodrix
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
