import { IotValueElement } from './iot-value';
import { IotGaugeElement } from './iot-gauge';
import { IotChartElement } from './iot-chart';
import { IotToggleElement } from './iot-toggle';

let registered = false;

export function registerWidgets(): void {
  if (registered) return;
  registered = true;
  if (!customElements.get('iot-value')) customElements.define('iot-value', IotValueElement);
  if (!customElements.get('iot-gauge')) customElements.define('iot-gauge', IotGaugeElement);
  if (!customElements.get('iot-chart')) customElements.define('iot-chart', IotChartElement);
  if (!customElements.get('iot-toggle')) customElements.define('iot-toggle', IotToggleElement);
}
