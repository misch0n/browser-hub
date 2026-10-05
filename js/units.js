(function (CC) {
  'use strict';

  // Each category maps a unit to its size in the category's base unit.
  const CATEGORIES = {
    length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
    mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 },
    volume: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365,
      floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375 }, // US customary
    speed: { mps: 1, kph: 1 / 3.6, mph: 0.44704, kn: 1852 / 3600 },
    time: { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400, wk: 604800 },
    data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 },
    temperature: { c: 1, f: 1, k: 1 }, // handled specially
  };

  const SYNONYMS = {
    meter: 'm', meters: 'm', metre: 'm', metres: 'm', kilometer: 'km', kilometers: 'km', kilometre: 'km',
    kilometres: 'km', centimeter: 'cm', centimeters: 'cm', millimeter: 'mm', millimeters: 'mm',
    mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd', foot: 'ft', feet: 'ft', inch: 'in', inches: 'in',
    kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb',
    lbs: 'lb', ounce: 'oz', ounces: 'oz', stone: 'st', tonne: 't', tonnes: 't',
    liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml', gallon: 'gal',
    gallons: 'gal', quart: 'qt', quarts: 'qt', pint: 'pt', pints: 'pt', cups: 'cup',
    tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
    'fl oz': 'floz',
    'm/s': 'mps', 'km/h': 'kph', kmh: 'kph', knot: 'kn', knots: 'kn',
    sec: 's', secs: 's', second: 's', seconds: 's', minute: 'min', minutes: 'min', mins: 'min',
    hour: 'h', hours: 'h', hr: 'h', hrs: 'h', day: 'd', days: 'd', week: 'wk', weeks: 'wk', wks: 'wk',
    byte: 'b', bytes: 'b', kilobyte: 'kb', megabyte: 'mb', gigabyte: 'gb', terabyte: 'tb',
    celsius: 'c', fahrenheit: 'f', kelvin: 'k',
  };

  function normalize(name) {
    let u = name.toLowerCase().replace(/°/g, '');
    return SYNONYMS[u] || u;
  }

  function categoryOf(unit) {
    for (const cat of Object.keys(CATEGORIES)) {
      if (Object.prototype.hasOwnProperty.call(CATEGORIES[cat], unit)) return cat;
    }
    return null;
  }

  function toKelvin(v, u) { return u === 'c' ? v + 273.15 : u === 'f' ? (v - 32) * 5 / 9 + 273.15 : v; }
  function fromKelvin(v, u) { return u === 'c' ? v - 273.15 : u === 'f' ? (v - 273.15) * 9 / 5 + 32 : v; }

  // convert(5, 'km', 'mi') -> number. Throws on unknown or incompatible units.
  function convert(value, fromName, toName) {
    const from = normalize(fromName), to = normalize(toName);
    const cf = categoryOf(from), ct = categoryOf(to);
    if (!cf) throw new Error("unknown unit '" + fromName + "'");
    if (!ct) throw new Error("unknown unit '" + toName + "'");
    if (cf !== ct) throw new Error("can't convert " + cf + ' (' + from + ') to ' + ct + ' (' + to + ')');
    if (cf === 'temperature') return fromKelvin(toKelvin(value, from), to);
    return (value * CATEGORIES[cf][from]) / CATEGORIES[cf][to];
  }

  function listUnits() {
    return Object.keys(CATEGORIES).map((c) => c + ': ' + Object.keys(CATEGORIES[c]).join(' '));
  }

  CC.units = { convert, listUnits, normalize };
})((globalThis.CC = globalThis.CC || {}));
