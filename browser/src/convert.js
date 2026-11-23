// Command bar converters: units ("10 km in miles", "72 f to c", "3 cups in ml"),
// currencies ("100 usd in eur", "€50 to $"), and time zones ("time in tokyo",
// "3pm london in new york"). Exchange rates are the European Central Bank's daily
// reference rates, downloaded once a day (nothing you type is sent anywhere).

const fs = require('fs');
const path = require('path');

// unit -> [dimension, factor to the base unit]
const U = {};
const add = (dim, factor, ...names) => { for (const n of names) U[n] = [dim, factor]; };
// length (metres)
add('len', 1e-3, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'); add('len', 1e-2, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres');
add('len', 1, 'm', 'meter', 'meters', 'metre', 'metres'); add('len', 1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
add('len', 0.0254, 'in', 'inch', 'inches', '"'); add('len', 0.3048, 'ft', 'foot', 'feet', "'"); add('len', 0.9144, 'yd', 'yard', 'yards');
add('len', 1609.344, 'mi', 'mile', 'miles'); add('len', 1852, 'nmi', 'nautical mile', 'nautical miles');
// mass (grams)
add('mass', 1e-3, 'mg', 'milligram', 'milligrams'); add('mass', 1, 'g', 'gram', 'grams'); add('mass', 1000, 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms');
add('mass', 1e6, 't', 'tonne', 'tonnes'); add('mass', 28.349523125, 'oz', 'ounce', 'ounces'); add('mass', 453.59237, 'lb', 'lbs', 'pound', 'pounds');
add('mass', 6350.29318, 'st', 'stone', 'stones');
// volume (litres)
add('vol', 1e-3, 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'); add('vol', 1e-2, 'cl', 'centiliter', 'centilitre');
add('vol', 1, 'l', 'liter', 'liters', 'litre', 'litres'); add('vol', 3.785411784, 'gal', 'gallon', 'gallons', 'us gallon', 'us gallons');
add('vol', 4.54609, 'uk gallon', 'uk gallons', 'imperial gallon'); add('vol', 0.946352946, 'qt', 'quart', 'quarts'); add('vol', 0.473176473, 'pt', 'pint', 'pints');
add('vol', 0.56826125, 'uk pint', 'uk pints'); add('vol', 0.2365882365, 'cup', 'cups'); add('vol', 0.0295735295625, 'fl oz', 'floz', 'fluid ounce', 'fluid ounces');
add('vol', 0.01478676478125, 'tbsp', 'tablespoon', 'tablespoons'); add('vol', 0.00492892159375, 'tsp', 'teaspoon', 'teaspoons');
// speed (m/s)
add('speed', 1, 'm/s', 'mps'); add('speed', 1000 / 3600, 'km/h', 'kmh', 'kph'); add('speed', 1609.344 / 3600, 'mph'); add('speed', 1852 / 3600, 'knot', 'knots', 'kn');
// data (bytes)
add('data', 1, 'b', 'byte', 'bytes'); add('data', 1e3, 'kb', 'kilobyte', 'kilobytes'); add('data', 1e6, 'mb', 'megabyte', 'megabytes');
add('data', 1e9, 'gb', 'gigabyte', 'gigabytes'); add('data', 1e12, 'tb', 'terabyte', 'terabytes'); add('data', 1024, 'kib'); add('data', 1048576, 'mib'); add('data', 1073741824, 'gib'); add('data', 1099511627776, 'tib');
// area (m²)
add('area', 1, 'm2', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres'); add('area', 1e6, 'km2', 'sq km', 'square kilometer', 'square kilometers');
add('area', 0.09290304, 'sq ft', 'ft2', 'square foot', 'square feet'); add('area', 4046.8564224, 'acre', 'acres'); add('area', 1e4, 'ha', 'hectare', 'hectares');
add('area', 2589988.110336, 'sq mi', 'square mile', 'square miles');
// time (seconds)
add('time', 1, 's', 'sec', 'second', 'seconds'); add('time', 60, 'min', 'mins', 'minute', 'minutes'); add('time', 3600, 'h', 'hr', 'hrs', 'hour', 'hours');
add('time', 86400, 'day', 'days'); add('time', 604800, 'week', 'weeks');
// energy (joules) and power (watts)
add('energy', 1, 'j', 'joule', 'joules'); add('energy', 4184, 'kcal', 'calorie', 'calories'); add('energy', 3.6e6, 'kwh');
add('power', 1, 'w', 'watt', 'watts'); add('power', 1000, 'kw', 'kilowatt', 'kilowatts'); add('power', 745.69987158227, 'hp', 'horsepower');
// temperature (handled separately)
for (const [n, k] of [['c', 'C'], ['°c', 'C'], ['celsius', 'C'], ['f', 'F'], ['°f', 'F'], ['fahrenheit', 'F'], ['k', 'K'], ['kelvin', 'K']]) U[n] = ['temp', k];

const SHOW = { 'len|m': 'm', 'len|mi': 'miles', 'len|ft': 'ft', 'len|in': 'in' };
const tempConv = (v, a, b) => { const c = a === 'C' ? v : a === 'F' ? (v - 32) * 5 / 9 : v - 273.15; return b === 'C' ? c : b === 'F' ? c * 9 / 5 + 32 : c + 273.15; };
const fmt = v => { const a = Math.abs(v); return (a !== 0 && (a < 1e-4 || a >= 1e12) ? v.toExponential(4) : Number(v.toPrecision(7)).toLocaleString('en-US', { maximumFractionDigits: 6 })); };

// ---- currencies
const SYM = { '$': 'USD', 'us$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', 'r$': 'BRL', 'c$': 'CAD', 'a$': 'AUD', 'chf': 'CHF', 'zł': 'PLN', '₺': 'TRY',
  dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR', pound: 'GBP', pounds: 'GBP', yen: 'JPY', rupee: 'INR', rupees: 'INR', franc: 'CHF', francs: 'CHF', yuan: 'CNY', bucks: 'USD' };
let rates = null;   // { EUR: 1, USD: 1.08, … , date }

function loadRates(file) {
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); if (r?.EUR === 1) rates = r; } catch { /* none yet */ }
  return rates;
}

async function updateRates(file, fetchFn) {
  try {
    if (rates && Date.now() - (rates.fetched || 0) < 20 * 3600e3) return rates;
    const res = await fetchFn('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
    if (!res.ok) return rates;
    const xml = await res.text();
    const r = { EUR: 1, fetched: Date.now(), date: (xml.match(/time=['"]([\d-]+)['"]/) || [])[1] || '' };
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) r[m[1]] = Number(m[2]);
    if (Object.keys(r).length > 10) { rates = r; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(r)); }
  } catch { /* offline: keep the old ones */ }
  return rates;
}

const curOf = s => { const t = String(s || '').trim().toLowerCase(); if (SYM[t]) return SYM[t]; const u = t.toUpperCase(); return /^[A-Z]{3}$/.test(u) && (rates?.[u] || ['USD', 'EUR', 'GBP'].includes(u)) ? u : null; };

// ---- time zones
const TZ = {
  utc: 'UTC', gmt: 'UTC', london: 'Europe/London', uk: 'Europe/London', bst: 'Europe/London', dublin: 'Europe/Dublin', lisbon: 'Europe/Lisbon',
  paris: 'Europe/Paris', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid', rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels',
  zurich: 'Europe/Zurich', vienna: 'Europe/Vienna', stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', warsaw: 'Europe/Warsaw',
  prague: 'Europe/Prague', athens: 'Europe/Athens', helsinki: 'Europe/Helsinki', kyiv: 'Europe/Kyiv', istanbul: 'Europe/Istanbul', moscow: 'Europe/Moscow',
  cet: 'Europe/Paris', cest: 'Europe/Paris', eet: 'Europe/Athens',
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York', washington: 'America/New_York', toronto: 'America/Toronto', miami: 'America/New_York',
  est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', chicago: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago', dallas: 'America/Chicago',
  denver: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', phoenix: 'America/Phoenix', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', seattle: 'America/Los_Angeles', vancouver: 'America/Vancouver', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
  anchorage: 'America/Anchorage', honolulu: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu', 'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires', bogota: 'America/Bogota', lima: 'America/Lima', santiago: 'America/Santiago',
  dubai: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', riyadh: 'Asia/Riyadh', tehran: 'Asia/Tehran', karachi: 'Asia/Karachi', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', ist: 'Asia/Kolkata', india: 'Asia/Kolkata',
  dhaka: 'Asia/Dhaka', bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', singapore: 'Asia/Singapore', 'kuala lumpur': 'Asia/Kuala_Lumpur', 'hong kong': 'Asia/Hong_Kong',
  beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', china: 'Asia/Shanghai', taipei: 'Asia/Taipei', manila: 'Asia/Manila', seoul: 'Asia/Seoul', tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo', jst: 'Asia/Tokyo',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane', perth: 'Australia/Perth', adelaide: 'Australia/Adelaide', aest: 'Australia/Sydney',
  auckland: 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland', nz: 'Pacific/Auckland', cairo: 'Africa/Cairo', johannesburg: 'Africa/Johannesburg', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi',
  reykjavik: 'Atlantic/Reykjavik', here: null, local: null,
};
const zoneName = z => z ? z.split('/').pop().replace(/_/g, ' ') : 'here';
const timeIn = (zone, d = new Date()) => d.toLocaleTimeString('en-GB', { timeZone: zone || undefined, hour: '2-digit', minute: '2-digit' }) + ' ' +
  d.toLocaleDateString('en-GB', { timeZone: zone || undefined, weekday: 'short', day: 'numeric', month: 'short' });

// Offset (minutes) of a zone at a moment.
function offsetOf(zone, d) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone || undefined, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d);
  const g = t => Number(p.find(x => x.type === t).value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - d.getTime()) / 60000;
}

// -> { value, title, sub } | null
function convert(input) {
  const s = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s.length > 80) return null;
  // time in <place>
  let m = s.match(/^(?:what(?:'s| is) the )?time (?:in|at) (.+?)\??$/);
  if (m && m[1] in TZ) { const z = TZ[m[1]]; const v = timeIn(z); return { value: v, title: `${v}`, sub: `Time in ${zoneName(z)}` }; }
  // 3pm london in tokyo / 15:30 pst to cet
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+?)\s+(?:in|to)\s+(.+)$/);
  if (m && m[4] in TZ && m[5] in TZ) {
    let h = Number(m[1]); const min = Number(m[2] || 0);
    if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const from = TZ[m[4]], to = TZ[m[5]];
    const now = new Date();
    // That wall-clock time today in the source zone.
    let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, min);
    t -= offsetOf(from, new Date(t)) * 60000;
    const v = timeIn(to, new Date(t));
    return { value: v, title: v, sub: `${m[1]}${m[2] ? ':' + m[2] : ''}${m[3] || ''} in ${zoneName(from)} → ${zoneName(to)}` };
  }
  // amount + unit/currency "in"/"to" unit/currency
  m = s.match(/^([$€£¥₹₩₺]|[a-z]\$|us\$)?\s*(-?[\d,]*\.?\d+(?:e-?\d+)?)\s*(.*?)\s+(?:in|to|into|as|=)\s+(.+)$/);
  if (!m) return null;
  const v = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  let fromU = (m[1] || m[3] || '').trim(), toU = m[4].trim().replace(/\?$/, '');
  // currency
  const fc = curOf(fromU), tc = curOf(toU);
  if (fc && tc) {
    if (!rates) return { value: '', title: 'Getting exchange rates…', sub: 'Try again in a moment', pending: true };
    if (!rates[fc] || !rates[tc]) return null;
    const out = v / rates[fc] * rates[tc];
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: tc, maximumFractionDigits: 2 });
    return { value: out.toFixed(2), title: nf.format(out), sub: `${new Intl.NumberFormat('en-US', { style: 'currency', currency: fc }).format(v)} · ECB rate of ${rates.date || 'today'}` };
  }
  const a = U[fromU], b = U[toU];
  if (!a || !b || a[0] !== b[0]) return null;
  const out = a[0] === 'temp' ? tempConv(v, a[1], b[1]) : v * a[1] / b[1];
  const label = x => (a[0] === 'temp' ? (U[x][1] === 'K' ? 'K' : '°' + U[x][1]) : a[0] === 'data' && x.length <= 3 ? x.toUpperCase().replace('IB', 'iB') : SHOW[`${U[x][0]}|${x}`] || x);
  return { value: fmt(out), title: `${fmt(out)} ${label(toU)}`, sub: `${fmt(v)} ${label(fromU)}` };
}

module.exports = { convert, loadRates, updateRates, TZ };
