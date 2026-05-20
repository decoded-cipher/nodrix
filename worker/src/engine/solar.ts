// Sunrise/sunset via the standard "sunrise equation" — a self-contained
// approximation good to ~1 minute. Pure (no external API); all instants are UTC.
//
// Reference: https://en.wikipedia.org/wiki/Sunrise_equation

const J2000 = 2451545.0;
const RAD = Math.PI / 180;

function toJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function fromJulian(j: number): Date {
  return new Date((j - 2440587.5) * 86400000);
}

// Returns sunrise/sunset for the calendar day containing `date`, at the given
// coordinates. Components are null during polar day / polar night.
export function sunTimes(
  date: Date,
  lat: number,
  lng: number
): { sunrise: Date | null; sunset: Date | null } {
  const lw = -lng;                 // algorithm uses west-positive longitude
  const phi = lat * RAD;

  const n = Math.ceil(toJulian(date) - J2000 + 0.0008);
  const Jstar = n + 0.0009 - lw / 360;                       // mean solar noon (days)
  const M = (357.5291 + 0.98560028 * Jstar) % 360;          // solar mean anomaly
  const Mrad = M * RAD;
  const C =
    1.9148 * Math.sin(Mrad) + 0.02 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
  const lambda = ((M + C + 180 + 102.9372) % 360) * RAD;     // ecliptic longitude
  const Jtransit = J2000 + Jstar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambda);

  const sinDec = Math.sin(lambda) * Math.sin(23.44 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosOmega = (Math.sin(-0.833 * RAD) - Math.sin(phi) * sinDec) / (Math.cos(phi) * cosDec);
  if (cosOmega > 1 || cosOmega < -1) return { sunrise: null, sunset: null };

  const omega = Math.acos(cosOmega) / RAD;                   // hour angle (degrees)
  return {
    sunrise: fromJulian(Jtransit - omega / 360),
    sunset: fromJulian(Jtransit + omega / 360),
  };
}
