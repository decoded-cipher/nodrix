// Browser-only: registers each widget class as a custom element.
// Imports the actual class modules, so this file MUST NOT be imported from
// the Worker (HTMLElement is undefined there). Worker reads ./index.ts only.

import { IotValueElement } from './iot-value/widget';
import { IotGaugeElement } from './iot-gauge/widget';
import { IotChartElement } from './iot-chart/widget';
import { IotMapElement } from './iot-map/widget';
import { IotToggleElement } from './iot-toggle/widget';
import { IotPushElement } from './iot-push/widget';
import { IotSliderElement } from './iot-slider/widget';
import { IotColorElement } from './iot-color/widget';
import { IotPercentElement } from './iot-percent/widget';

let registered = false;

export function registerWidgets(): void {
  if (registered) return;
  registered = true;
  if (!customElements.get('iot-value')) customElements.define('iot-value', IotValueElement);
  if (!customElements.get('iot-gauge')) customElements.define('iot-gauge', IotGaugeElement);
  if (!customElements.get('iot-chart')) customElements.define('iot-chart', IotChartElement);
  if (!customElements.get('iot-map')) customElements.define('iot-map', IotMapElement);
  if (!customElements.get('iot-toggle')) customElements.define('iot-toggle', IotToggleElement);
  if (!customElements.get('iot-push')) customElements.define('iot-push', IotPushElement);
  if (!customElements.get('iot-slider')) customElements.define('iot-slider', IotSliderElement);
  if (!customElements.get('iot-color')) customElements.define('iot-color', IotColorElement);
  if (!customElements.get('iot-percent')) customElements.define('iot-percent', IotPercentElement);
}
