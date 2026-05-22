// One-process bootstrap. Runs both sides side-by-side so a single
// `npm start` gives you live telemetry AND a command listener.
//
// If you'd rather run them separately, use `npm run sensors` and
// `npm run controllers` in two terminals.

import './sensors.js';
import './controllers.js';
import './gps.js';
