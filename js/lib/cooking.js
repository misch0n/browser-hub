// Kitchen reference for `cook`: safe and best internal temperatures, oven
// times and temperatures, and measures to grams. Pure data and arithmetic.
//
// Safe temperatures follow the USDA Food Safety and Inspection Service (the
// UK Food Standards Agency agrees: 70°C held for 2 minutes, or 75°C). "Best"
// is what cooks aim for to keep meat juicy; where that is below the safe
// temperature the entry says so. Oven times are rules of thumb: a thermometer
// in the thickest part decides.

// ---- temperatures ----------------------------------------------------------------

export const toF = (c) => Math.round((c * 9) / 5 + 32);
export const toC = (f) => Math.round(((f - 32) * 5) / 9);
const GAS = [[1, 140], [2, 150], [3, 170], [4, 180], [5, 190], [6, 200], [7, 220], [8, 230], [9, 240]];
// Nearest gas mark to a temperature in °C (¼ and ½ below 140).
export function gasMark(c) {
  if (c < 115) return '¼';
  if (c < 135) return '½';
  return String(GAS.reduce((best, g) => (Math.abs(g[1] - c) <= Math.abs(best[1] - c) ? g : best))[0]); // a tie goes up: 160°C is gas 3
}
export const FAN = 20; // a fan oven runs this much hotter: set it this much lower

// ---- safe and best internal temperatures ------------------------------------------
// safe: { c, hold? } (hold: minutes to keep it there, or rest before eating)
// best: [{ label, c, to? }] (to: upper end of a range)
// below: true when the best is below the safe temperature (a risk you choose)

const W_BELOW = 'below the official safe temperature: a choice with some risk. Not for pregnancy, young children, the elderly or anyone with weak immunity';
export const TARGETS = [
  { id: 'chicken-breast', group: 'Poultry', name: 'Chicken or turkey breast', keys: 'chicken turkey breast poultry fillet',
    safe: { c: 74 }, best: [{ label: 'juicy', c: 65 }], below: true,
    note: '65°C held for 3 minutes kills bacteria as well as 74°C does instantly: pull at 63°C and rest it covered', warn: 'Undercooked poultry carries salmonella and campylobacter. ' + 'If you can\'t check the hold, go to 74°C' },
  { id: 'chicken-thigh', group: 'Poultry', name: 'Chicken or turkey thighs, legs, wings', keys: 'chicken turkey thigh thighs leg legs drumstick drumsticks wing wings poultry',
    safe: { c: 74 }, best: [{ label: 'tender', c: 80, to: 88 }], note: 'Dark meat has connective tissue that only softens well above the safe temperature' },
  { id: 'chicken-whole', group: 'Poultry', name: 'Whole chicken or turkey', keys: 'chicken turkey whole bird roast poultry',
    safe: { c: 74 }, best: [{ label: 'breast', c: 65, to: 68 }, { label: 'thigh', c: 80 }], below: true,
    note: 'Measure in the thickest part of the thigh, not touching bone; the breast is done before the legs', warn: 'Every part must reach 74°C (or the breast 65°C held 3 minutes)' },
  { id: 'poultry-ground', group: 'Poultry', name: 'Minced chicken or turkey, poultry sausages', keys: 'chicken turkey ground minced mince sausage sausages burger burgers poultry',
    safe: { c: 74 }, best: [{ label: 'done', c: 74 }], warn: 'Mince carries bacteria all the way through: never less than 74°C' },
  { id: 'duck-breast', group: 'Poultry', name: 'Duck or goose breast', keys: 'duck goose breast magret',
    safe: { c: 74 }, best: [{ label: 'pink', c: 54, to: 57 }], below: true,
    note: 'Usually served pink like steak; legs are confit or roasted to 80°C+', warn: 'Pink duck is common practice but below official guidance' },

  { id: 'beef-steak', group: 'Beef, lamb and veal', name: 'Steaks, chops and roasts (whole cuts)', keys: 'beef steak steaks roast lamb veal chop chops rack leg fillet tenderloin sirloin ribeye venison',
    safe: { c: 63, hold: 3 },
    best: [{ label: 'rare', c: 50, to: 52 }, { label: 'medium-rare', c: 55, to: 57 }, { label: 'medium', c: 60, to: 63 }, { label: 'medium-well', c: 65, to: 68 }, { label: 'well done', c: 71 }],
    below: true, note: 'Bacteria sit on the surface of an intact cut, so a seared outside makes rare and medium-rare a widely accepted choice. Pull 3–5°C early: it keeps rising while resting',
    warn: 'Rare and medium-rare are ' + W_BELOW.replace('below', 'under') },
  { id: 'beef-braise', group: 'Beef, lamb and veal', name: 'Brisket, short ribs, cheeks, lamb shoulder (slow)', keys: 'beef brisket short ribs rib cheek cheeks chuck shoulder lamb braise braised slow stew pulled',
    safe: { c: 63 }, best: [{ label: 'fork-tender', c: 90, to: 96 }], note: 'Collagen melts slowly above 85°C: cook until a probe slides in with no resistance' },
  { id: 'ground-meat', group: 'Mince and sausages', name: 'Burgers, mince, meatballs, meatloaf (beef, pork, lamb)', keys: 'beef pork lamb veal ground minced mince burger burgers hamburger meatball meatballs meatloaf kebab',
    safe: { c: 71 }, best: [{ label: 'done', c: 71 }], warn: 'Mincing spreads surface bacteria (E. coli) all through the meat: no pink burgers. Use a thermometer, not the colour' },
  { id: 'sausages', group: 'Mince and sausages', name: 'Fresh sausages (pork, beef, lamb)', keys: 'sausage sausages pork beef lamb bratwurst',
    safe: { c: 71 }, best: [{ label: 'done', c: 71 }], warn: 'Like mince: cooked all the way through, no pink' },

  { id: 'pork-loin', group: 'Pork', name: 'Pork chops, loin, tenderloin', keys: 'pork chop chops loin tenderloin fillet roast',
    safe: { c: 63, hold: 3 }, best: [{ label: 'juicy, faintly pink', c: 63 }], note: 'Pull at 60°C and rest 3 minutes. Pork no longer has to be cooked grey' },
  { id: 'pork-shoulder', group: 'Pork', name: 'Pork shoulder, belly, ribs (slow)', keys: 'pork shoulder butt belly ribs rib spare pulled slow',
    safe: { c: 63, hold: 3 }, best: [{ label: 'sliceable', c: 75, to: 80 }, { label: 'pulled', c: 90, to: 95 }] },
  { id: 'ham', group: 'Pork', name: 'Ham or gammon, raw', keys: 'ham gammon pork raw fresh',
    safe: { c: 63, hold: 3 }, best: [{ label: 'juicy', c: 63, to: 66 }] },
  { id: 'ham-cooked', group: 'Pork', name: 'Ham, ready-cooked (reheating)', keys: 'ham cooked reheat reheated glazed pork',
    safe: { c: 60 }, best: [{ label: 'hot through', c: 60 }], note: 'From a sealed factory pack; anything else (leftover or repacked ham) to 74°C' },

  { id: 'salmon', group: 'Fish and seafood', name: 'Salmon and trout', keys: 'salmon trout fish',
    safe: { c: 63 }, best: [{ label: 'silky', c: 50, to: 52 }, { label: 'firm', c: 55 }], below: true,
    warn: 'Below 63°C use very fresh fish; fish for eating raw or barely cooked should have been frozen (−20°C for 7 days) against parasites' },
  { id: 'white-fish', group: 'Fish and seafood', name: 'White fish (cod, haddock, halibut, sea bass)', keys: 'fish white cod haddock halibut hake pollock sea bass bream seabass',
    safe: { c: 63 }, best: [{ label: 'just flakes', c: 55, to: 60 }], below: true, note: 'Done when it turns opaque and flakes with a fork', warn: 'Below 63°C: fresh fish only' },
  { id: 'tuna', group: 'Fish and seafood', name: 'Tuna steak', keys: 'tuna fish steak',
    safe: { c: 63 }, best: [{ label: 'seared, rare centre', c: 40, to: 45 }], below: true, warn: 'A rare centre is raw fish: sashimi-grade (frozen) tuna only' },
  { id: 'shellfish', group: 'Fish and seafood', name: 'Prawns, shrimp, lobster, crab', keys: 'prawn prawns shrimp shrimps lobster crab shellfish seafood',
    safe: { c: 63 }, best: [{ label: 'opaque, just firm', c: 63 }], note: 'Done the moment the flesh turns opaque and pearly; a minute more turns it rubbery' },
  { id: 'scallops', group: 'Fish and seafood', name: 'Scallops', keys: 'scallop scallops shellfish seafood',
    safe: { c: 63 }, best: [{ label: 'translucent centre', c: 50, to: 52 }], below: true, warn: 'A translucent centre is undercooked: fresh scallops only' },
  { id: 'molluscs', group: 'Fish and seafood', name: 'Mussels, clams, oysters', keys: 'mussel mussels clam clams oyster oysters shellfish seafood',
    safe: { c: 63 }, best: [{ label: 'shells open', c: 63 }], note: 'Cook until the shells open; throw away any that stay shut', warn: 'Raw oysters carry a real risk (vibrio, norovirus)' },

  { id: 'eggs', group: 'Eggs and leftovers', name: 'Eggs and egg dishes (quiche, custard, frittata)', keys: 'egg eggs quiche custard frittata omelette',
    safe: { c: 71 }, best: [{ label: 'set', c: 71 }], note: 'Fried and boiled eggs: until white and yolk are firm for the safe version', warn: 'Runny yolks are undercooked egg: use pasteurised eggs for anyone at risk' },
  { id: 'leftovers', group: 'Eggs and leftovers', name: 'Leftovers, casseroles, stuffing', keys: 'leftover leftovers reheat reheated casserole casseroles stuffing dressing',
    safe: { c: 74 }, best: [{ label: 'piping hot', c: 74 }], warn: 'Reheat once, to 74°C all the way through; stuffing cooked inside a bird must reach 74°C too' },
];

// ---- oven times ----------------------------------------------------------------------
// temp: conventional °C (fan is FAN lower), range: what still works.
// time: { perKg, base } scales with weight (base can depend on weight), or
//       { min, max } for pieces, which cook by thickness, not total weight.
// doneness: per-kg minutes by doneness (beef, lamb), the first is the default.
// sear: minutes at a hotter start before the main temperature.

export const OVEN = [
  { id: 'chicken-whole', group: 'Poultry', name: 'Whole chicken', keys: 'chicken whole roast bird', temp: 190, range: [180, 220],
    time: { perKg: 40, base: 20 }, weight: 1.6, target: 'chicken-whole', rest: '10–15 min', note: 'Thickest part of the thigh 74°C; juices run clear' },
  { id: 'chicken-breast', group: 'Poultry', name: 'Chicken breasts (boneless)', keys: 'chicken breast breasts fillet fillets', temp: 200, range: [180, 220],
    time: { min: 20, max: 25 }, target: 'chicken-breast', rest: '5 min', note: 'For breasts of about 200 g; thicker ones take longer' },
  { id: 'chicken-thighs', group: 'Poultry', name: 'Chicken thighs (bone in)', keys: 'chicken thigh thighs bone', temp: 200, range: [180, 220],
    time: { min: 35, max: 45 }, target: 'chicken-thigh', note: 'Skin side up for crisp skin; boneless thighs take 20–25 min' },
  { id: 'chicken-drumsticks', group: 'Poultry', name: 'Chicken drumsticks or legs', keys: 'chicken drumstick drumsticks leg legs', temp: 200, range: [180, 220],
    time: { min: 35, max: 45 }, target: 'chicken-thigh', note: 'Turn once halfway' },
  { id: 'chicken-wings', group: 'Poultry', name: 'Chicken wings', keys: 'chicken wing wings', temp: 220, range: [200, 230],
    time: { min: 40, max: 45 }, target: 'chicken-thigh', note: 'On a rack, turned halfway, for crisp skin' },
  { id: 'turkey-whole', group: 'Poultry', name: 'Whole turkey', keys: 'turkey whole roast bird christmas thanksgiving', temp: 180, range: [160, 190],
    time: { perKg: 20, base: (kg) => (kg < 4.5 ? 70 : 90) }, weight: 5, target: 'chicken-whole', rest: '30–60 min under foil', note: 'Cover with foil for most of the time; uncover for the last 30–40 min to brown' },
  { id: 'duck-whole', group: 'Poultry', name: 'Whole duck', keys: 'duck whole roast', temp: 180, range: [170, 200],
    time: { perKg: 45, base: 15 }, weight: 2.2, target: 'duck-breast', rest: '15 min', note: 'Prick the skin and pour off the fat as it renders' },

  { id: 'beef-roast', group: 'Beef and lamb', name: 'Roast beef (topside, sirloin, rib)', keys: 'beef roast joint topside sirloin rib ribeye silverside', temp: 180, range: [160, 200],
    sear: { temp: 220, min: 20 }, doneness: { rare: 24, 'medium-rare': 28, medium: 32, 'well done': 44 }, defaultDone: 'medium-rare', weight: 1.5,
    target: 'beef-steak', rest: '20–30 min', note: 'Brown at 220°C first, then turn down' },
  { id: 'beef-fillet', group: 'Beef and lamb', name: 'Beef fillet (tenderloin), whole', keys: 'beef fillet tenderloin chateaubriand wellington', temp: 220, range: [200, 230],
    doneness: { rare: 18, 'medium-rare': 22, medium: 27 }, defaultDone: 'medium-rare', weight: 1, target: 'beef-steak', rest: '10 min', note: 'Sear all over in a pan first' },
  { id: 'beef-brisket', group: 'Beef and lamb', name: 'Beef brisket (slow, covered)', keys: 'beef brisket slow pot roast chuck', temp: 150, range: [120, 160],
    time: { perKg: 100, base: 60 }, weight: 2, target: 'beef-braise', rest: '30 min', note: 'Covered with a little liquid; done when a probe slides in like butter (93°C)' },
  { id: 'lamb-leg', group: 'Beef and lamb', name: 'Leg of lamb', keys: 'lamb leg roast joint', temp: 180, range: [160, 200],
    sear: { temp: 220, min: 20 }, doneness: { pink: 30, medium: 40, 'well done': 50 }, defaultDone: 'pink', weight: 2,
    target: 'beef-steak', rest: '20 min', note: 'Pink is about 57–60°C in the middle' },
  { id: 'lamb-rack', group: 'Beef and lamb', name: 'Rack of lamb', keys: 'lamb rack cutlets', temp: 210, range: [200, 220],
    time: { min: 15, max: 20 }, target: 'beef-steak', rest: '10 min', note: 'Sear the fat side first; 15 min is pink' },
  { id: 'lamb-shoulder', group: 'Beef and lamb', name: 'Lamb shoulder (slow, covered)', keys: 'lamb shoulder slow pulled', temp: 160, range: [140, 170],
    time: { min: 210, max: 270 }, target: 'beef-braise', rest: '20 min', note: 'For about 2 kg; covered, until it falls off the bone' },

  { id: 'pork-loin', group: 'Pork', name: 'Pork loin roast', keys: 'pork loin roast joint crackling', temp: 180, range: [160, 200],
    sear: { temp: 220, min: 20 }, time: { perKg: 50, base: 0 }, weight: 1.5, target: 'pork-loin', rest: '15 min', note: 'Dry, scored skin and the hot start make crackling' },
  { id: 'pork-tenderloin', group: 'Pork', name: 'Pork tenderloin (fillet)', keys: 'pork tenderloin fillet', temp: 200, range: [190, 220],
    time: { min: 20, max: 25 }, target: 'pork-loin', rest: '5 min', note: 'For a 400–500 g fillet, seared first' },
  { id: 'pork-chops', group: 'Pork', name: 'Pork chops (2–3 cm)', keys: 'pork chop chops', temp: 200, range: [180, 220],
    time: { min: 15, max: 20 }, target: 'pork-loin', rest: '5 min' },
  { id: 'pork-shoulder', group: 'Pork', name: 'Pork shoulder (pulled, slow)', keys: 'pork shoulder butt pulled slow', temp: 150, range: [120, 160],
    time: { perKg: 120, base: 30 }, weight: 2, target: 'pork-shoulder', rest: '30 min', note: 'Done at 90–95°C, when it pulls apart' },
  { id: 'pork-belly', group: 'Pork', name: 'Pork belly', keys: 'pork belly crackling', temp: 160, range: [150, 180],
    sear: { temp: 220, min: 30 }, time: { min: 120, max: 150 }, target: 'pork-shoulder', rest: '15 min', note: 'For 1–1.5 kg: 30 min at 220°C for the crackling, then low and slow' },
  { id: 'pork-ribs', group: 'Pork', name: 'Pork ribs (covered, then glazed)', keys: 'pork ribs rib spare baby back', temp: 150, range: [140, 170],
    time: { min: 150, max: 180 }, target: 'pork-shoulder', note: 'Covered; then uncover, glaze and give 10–15 min at 220°C' },
  { id: 'sausages', group: 'Pork', name: 'Sausages', keys: 'sausage sausages bangers', temp: 200, range: [180, 220],
    time: { min: 25, max: 30 }, target: 'sausages', note: 'Turn once or twice' },
  { id: 'meatloaf', group: 'Pork', name: 'Meatloaf', keys: 'meatloaf mince ground loaf', temp: 180, range: [170, 200],
    time: { perKg: 60, base: 10 }, weight: 1, target: 'ground-meat', rest: '10 min' },
  { id: 'meatballs', group: 'Pork', name: 'Meatballs', keys: 'meatball meatballs mince ground', temp: 200, range: [180, 220],
    time: { min: 18, max: 22 }, target: 'ground-meat', note: 'For balls about 4 cm across' },

  { id: 'salmon', group: 'Fish', name: 'Salmon fillets', keys: 'salmon fillet fillets fish trout', temp: 200, range: [180, 220],
    time: { min: 12, max: 15 }, target: 'salmon', note: 'For fillets 2–3 cm thick' },
  { id: 'white-fish', group: 'Fish', name: 'White fish fillets', keys: 'fish white cod haddock hake pollock fillet fillets', temp: 200, range: [180, 220],
    time: { min: 10, max: 15 }, target: 'white-fish', note: 'Done when opaque and flaking' },
  { id: 'whole-fish', group: 'Fish', name: 'Whole fish (sea bass, bream, trout)', keys: 'fish whole sea bass seabass bream trout', temp: 200, range: [180, 220],
    time: { min: 18, max: 25 }, target: 'white-fish', note: 'For a 400–600 g fish; the flesh lifts off the bone when done' },

  { id: 'baked-potatoes', group: 'Vegetables', name: 'Baked (jacket) potatoes', keys: 'potato potatoes baked jacket', temp: 200, range: [180, 220],
    time: { min: 60, max: 75 }, note: 'Done when a knife slides in easily' },
  { id: 'roast-potatoes', group: 'Vegetables', name: 'Roast potatoes (parboiled)', keys: 'potato potatoes roast roasted', temp: 210, range: [190, 220],
    time: { min: 40, max: 50 }, note: 'Parboil 8–10 min, rough them up, hot fat, turn halfway' },
  { id: 'roast-veg', group: 'Vegetables', name: 'Roast vegetables (roots, squash)', keys: 'vegetables veg veggies carrot carrots parsnip parsnips squash pumpkin roast roasted root', temp: 200, range: [180, 220],
    time: { min: 35, max: 45 }, note: 'In one layer, not crowded, turned halfway' },
];

// Every word of `query` starts a word of the entry's name or keys. -> entries
export function lookup(list, query) {
  const q = String(query).toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!q.length) return list.slice();
  const hits = list.filter((e) => {
    const words = (e.name + ' ' + e.keys).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    return q.every((w) => words.some((x) => x.startsWith(w) || (w.endsWith('s') && x.startsWith(w.slice(0, -1)))));
  });
  // An exact id wins.
  const exact = list.find((e) => e.id === q.join('-'));
  return exact ? [exact] : hits;
}

// ---- reading `cook oven …` -------------------------------------------------------------

const WEIGHT_UNITS = { g: 0.001, gr: 0.001, gram: 0.001, grams: 0.001, kg: 1, kgs: 1, kilo: 1, kilos: 1, lb: 0.4536, lbs: 0.4536, pound: 0.4536, pounds: 0.4536, oz: 0.02835, ounce: 0.02835, ounces: 0.02835 };
const DONENESS = { rare: 'rare', 'medium-rare': 'medium-rare', mr: 'medium-rare', medium: 'medium', 'medium-well': 'medium-well', well: 'well done', 'well-done': 'well done', pink: 'pink' };

// 'whole chicken 1.6kg at 200' -> { food, kg, tempC, fan, given: { temp, unit }, done } or { error }
export function readOven(text) {
  let s = ' ' + String(text).toLowerCase().replace(/,(\d)/g, '.$1').replace(/°/g, '') + ' ';
  const out = { kg: null, tempC: null, fan: false, done: null };
  s = s.replace(/\bmedium[\s-]rare\b/g, 'medium-rare').replace(/\bmedium[\s-]well\b/g, 'medium-well').replace(/\bwell[\s-]done\b/g, 'well-done');
  const w = /\s(\d+(?:\.\d+)?)\s?(kgs?|kilos?|grams?|gr|g|lbs?|pounds?|oz|ounces?)\b/.exec(s);
  if (w) {
    out.kg = +w[1] * WEIGHT_UNITS[w[2]];
    s = s.replace(w[0], ' ');
  }
  const gas = /\bgas(?: mark)?\s?(\d)\b/.exec(s);
  if (gas) {
    const g = GAS.find((x) => x[0] === +gas[1]);
    if (!g) return { error: 'gas marks go from 1 to 9' };
    out.tempC = g[1];
    s = s.replace(gas[0], ' ');
  } else {
    const t = /\s(?:at\s)?(\d{2,3})\s?(c|f|celsius|fahrenheit)?(?=\s)/.exec(s);
    if (t) {
      const n = +t[1];
      const f = t[2] ? t[2][0] === 'f' : n > 290; // 350 is Fahrenheit; 200 is Celsius
      out.tempC = f ? toC(n) : n;
      out.given = { n, unit: f ? 'F' : 'C' };
      s = s.replace(t[0], ' ');
    }
  }
  if (/\bfan\b/.test(s)) { out.fan = true; s = s.replace(/\bfan\b/, ' '); }
  for (const [k, v] of Object.entries(DONENESS)) {
    const re = new RegExp('(^|\\s)' + k + '(?=\\s)');
    if (re.test(s)) { out.done = v; s = s.replace(re, ' '); break; }
  }
  out.food = s.replace(/\b(at|in|the|of|a|an|for|oven|conventional)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

// Minutes for `entry` at `tempC` (conventional) for `kg`.
// -> { minutes, low, high, perPiece, sear, done, error? }
export function ovenTime(entry, kg, tempC, done) {
  const t = tempC || entry.temp;
  if (t < entry.range[0] || t > entry.range[1]) {
    return { error: t < entry.range[0] ? 'too cool: it dries out before the middle is done' : 'too hot: the outside burns before the middle is done' };
  }
  // Away from the usual temperature, roughly 8% longer for every 10°C cooler (and shorter for hotter).
  const factor = 1 + (0.8 * (entry.temp - t)) / 100;
  const w = kg || entry.weight || null;
  let minutes, low, high, perPiece = false;
  let doneness = null;
  if (entry.doneness) {
    doneness = done && entry.doneness[done] ? done : entry.defaultDone;
    minutes = entry.doneness[doneness] * w;
  } else if (entry.time.perKg) {
    const base = typeof entry.time.base === 'function' ? entry.time.base(w) : entry.time.base;
    minutes = entry.time.perKg * w + base;
  } else {
    perPiece = true;
    low = entry.time.min * factor;
    high = entry.time.max * factor;
    minutes = (low + high) / 2;
  }
  if (!perPiece) {
    minutes *= factor;
    low = minutes * 0.9;
    high = minutes * 1.1;
  }
  return { minutes, low, high, perPiece, kg: w, sear: entry.sear || null, done: doneness, unknownDone: done && entry.doneness && !entry.doneness[done] ? done : null };
}

// 80 -> '1 h 20 min'
export function fmtMinutes(m) {
  const r = m >= 30 ? Math.round(m / 5) * 5 : Math.round(m);
  const h = Math.floor(r / 60), mm = r % 60;
  return h ? h + ' h' + (mm ? ' ' + mm + ' min' : '') : mm + ' min';
}

// ---- measures to grams --------------------------------------------------------------

// Volumes in ml. A cup is the US cup (240 ml), so 1 cup = 16 tbsp = 48 tsp.
export const VOLUMES = {
  tsp: { ml: 5, name: 'teaspoon', words: ['tsp', 'teaspoon', 'teaspoons'] },
  dsp: { ml: 10, name: 'dessert spoon', words: ['dsp', 'dessertspoon', 'dessertspoons'] },
  tbsp: { ml: 15, name: 'tablespoon', words: ['tbsp', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'spoon', 'spoons', 'spoonful', 'spoonfuls'] },
  cup: { ml: 240, name: 'cup', words: ['cup', 'cups', 'c'] },
  floz: { ml: 29.57, name: 'fluid ounce', words: ['floz', 'fl.oz', 'fl-oz'] },
  pint: { ml: 473, name: 'US pint', words: ['pint', 'pints', 'pt'] },
  ukpint: { ml: 568, name: 'UK pint', words: ['ukpint'] },
  quart: { ml: 946, name: 'quart', words: ['quart', 'quarts', 'qt'] },
  ml: { ml: 1, name: 'ml', words: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  cl: { ml: 10, name: 'cl', words: ['cl'] },
  dl: { ml: 100, name: 'dl', words: ['dl'] },
  l: { ml: 1000, name: 'litre', words: ['l', 'liter', 'liters', 'litre', 'litres'] },
  pinch: { ml: 0.31, name: 'pinch', words: ['pinch', 'pinches'] },
  dash: { ml: 0.62, name: 'dash', words: ['dash', 'dashes'] },
};
export const WEIGHTS = {
  g: { g: 1, words: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'] },
  kg: { g: 1000, words: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
  oz: { g: 28.35, words: ['oz', 'ounce', 'ounces'] },
  lb: { g: 453.6, words: ['lb', 'lbs', 'pound', 'pounds'] },
};

// Grams per US cup (240 ml), spooned and levelled. Sources: King Arthur Baking's
// ingredient weight chart and USDA FoodData Central, rounded.
export const INGREDIENTS = [
  { id: 'flour', name: 'flour (plain, all-purpose)', cup: 125, keys: 'flour plain all purpose ap white self raising self-raising' },
  { id: 'bread-flour', name: 'bread flour (strong)', cup: 130, keys: 'bread strong flour' },
  { id: 'wholemeal-flour', name: 'wholemeal flour', cup: 120, keys: 'wholemeal whole wheat wholewheat flour' },
  { id: 'cake-flour', name: 'cake flour', cup: 115, keys: 'cake pastry flour' },
  { id: 'almond-flour', name: 'ground almonds (almond flour)', cup: 96, keys: 'almond almonds flour ground meal' },
  { id: 'cornstarch', name: 'cornflour (cornstarch)', cup: 128, keys: 'cornflour cornstarch corn starch' },
  { id: 'cocoa', name: 'cocoa powder', cup: 85, keys: 'cocoa powder cacao' },
  { id: 'sugar', name: 'sugar (white, granulated)', cup: 200, keys: 'sugar white granulated caster castor' },
  { id: 'brown-sugar', name: 'brown sugar (packed)', cup: 220, keys: 'brown sugar light dark muscovado demerara' },
  { id: 'icing-sugar', name: 'icing sugar (powdered)', cup: 120, keys: 'icing powdered confectioners sugar' },
  { id: 'honey', name: 'honey', cup: 340, keys: 'honey' },
  { id: 'maple', name: 'maple syrup', cup: 315, keys: 'maple syrup' },
  { id: 'syrup', name: 'golden syrup (corn syrup)', cup: 330, keys: 'golden corn syrup glucose' },
  { id: 'butter', name: 'butter', cup: 227, keys: 'butter margarine', stick: 113 },
  { id: 'oil', name: 'oil', cup: 216, keys: 'oil olive vegetable sunflower canola rapeseed' },
  { id: 'water', name: 'water', cup: 240, keys: 'water stock broth' },
  { id: 'milk', name: 'milk', cup: 245, keys: 'milk buttermilk' },
  { id: 'cream', name: 'cream', cup: 240, keys: 'cream double heavy single whipping' },
  { id: 'yogurt', name: 'yogurt', cup: 245, keys: 'yogurt yoghurt' },
  { id: 'sour-cream', name: 'sour cream', cup: 240, keys: 'sour cream creme fraiche' },
  { id: 'cream-cheese', name: 'cream cheese', cup: 232, keys: 'cream cheese philadelphia' },
  { id: 'peanut-butter', name: 'peanut butter', cup: 260, keys: 'peanut butter nut' },
  { id: 'oats', name: 'rolled oats', cup: 90, keys: 'oats rolled oat porridge oatmeal' },
  { id: 'rice', name: 'rice (uncooked)', cup: 190, keys: 'rice uncooked raw' },
  { id: 'chocolate-chips', name: 'chocolate chips', cup: 170, keys: 'chocolate chips chip' },
  { id: 'nuts', name: 'nuts (chopped)', cup: 120, keys: 'nuts nut chopped walnuts walnut pecans pecan almonds hazelnuts' },
  { id: 'raisins', name: 'raisins', cup: 145, keys: 'raisins sultanas currants dried fruit' },
  { id: 'coconut', name: 'desiccated coconut', cup: 85, keys: 'desiccated shredded coconut' },
  { id: 'parmesan', name: 'parmesan (grated)', cup: 100, keys: 'parmesan grated' },
  { id: 'cheese', name: 'cheese (grated, cheddar)', cup: 113, keys: 'cheese grated shredded cheddar mozzarella' },
  { id: 'breadcrumbs', name: 'breadcrumbs (dry)', cup: 110, keys: 'breadcrumbs crumbs panko' },
  { id: 'salt', name: 'salt (fine)', cup: 288, keys: 'salt table fine sea', note: 'Coarse kosher salt is lighter: a teaspoon is 3–5 g depending on the brand' },
  { id: 'baking-powder', name: 'baking powder', cup: 192, keys: 'baking powder' },
  { id: 'baking-soda', name: 'bicarbonate of soda (baking soda)', cup: 288, keys: 'baking soda bicarbonate bicarb' },
  { id: 'yeast', name: 'dried yeast', cup: 144, keys: 'yeast dried dry instant active' },
  { id: 'cinnamon', name: 'ground spices (cinnamon)', cup: 125, keys: 'cinnamon spice spices ground paprika cumin ginger' },
  { id: 'vanilla', name: 'vanilla extract', cup: 210, keys: 'vanilla extract essence' },
];
export const EGGS = { egg: { g: 50, name: 'egg (large, without shell)' }, yolk: { g: 18, name: 'egg yolk' }, white: { g: 30, name: 'egg white' } };

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, quarter: 0.25 };

// '1 1/2', '1½', '0.5', '1,5', '½', 'a', 'half' at the start of `s` -> { n, rest } or null
export function readAmount(s) {
  const t = s.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)(?=\s|$)/.exec(t);
  if (m) return { n: +m[1] + +m[2] / +m[3], rest: t.slice(m[0].length) };
  m = /^(\d+)?\s?([½¼¾⅓⅔⅛⅜⅝⅞])/.exec(t);
  if (m) return { n: (m[1] ? +m[1] : 0) + FRACTIONS[m[2]], rest: t.slice(m[0].length) };
  m = /^(\d+)\/(\d+)(?=\s|[a-z]|$)/i.exec(t);
  if (m) return +m[2] ? { n: +m[1] / +m[2], rest: t.slice(m[0].length) } : null;
  m = /^(\d+(?:[.,]\d+)?)/.exec(t);
  if (m) return { n: +m[1].replace(',', '.'), rest: t.slice(m[0].length) };
  m = /^([a-z]+)(?=\s|$)/i.exec(t);
  if (m && NUMBER_WORDS[m[1].toLowerCase()] !== undefined) {
    let rest = t.slice(m[0].length);
    let n = NUMBER_WORDS[m[1].toLowerCase()];
    if (/^\s+(half|quarter)\b/i.test(rest) && (n === 1)) { // 'a half', 'a quarter'
      const w = /^\s+(half|quarter)/i.exec(rest);
      n = NUMBER_WORDS[w[1].toLowerCase()];
      rest = rest.slice(w[0].length);
    }
    return { n, rest: rest.replace(/^\s+(a|an|of)\b/i, '') };
  }
  return null;
}

function unitOf(word) {
  const w = word.replace(/\.$/, '');
  if (w === 'T') return { kind: 'volume', key: 'tbsp' }; // recipe shorthand: T tablespoon, t teaspoon
  if (w === 't') return { kind: 'volume', key: 'tsp' };
  const l = w.toLowerCase();
  for (const [k, v] of Object.entries(VOLUMES)) if (v.words.includes(l)) return { kind: 'volume', key: k };
  for (const [k, v] of Object.entries(WEIGHTS)) if (v.words.includes(l)) return { kind: 'weight', key: k };
  if (/^sticks?$/.test(l)) return { kind: 'stick' };
  if (/^eggs?$/.test(l)) return { kind: 'egg', key: 'egg' };
  if (/^(egg)?yolks?$/.test(l)) return { kind: 'egg', key: 'yolk' };
  if (/^(egg)?whites?$/.test(l)) return { kind: 'egg', key: 'white' };
  return null;
}

// The ingredient `text` names: its own name first ('sugar' is white sugar,
// not brown or icing sugar), then any whose words all match. -> entry or null
export function findIngredient(text) {
  const q = String(text).toLowerCase().replace(/\b(of|the|some)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const hits = lookup(INGREDIENTS, q);
  const rank = (x) => (x.id === q.replace(/ /g, '-') ? 0 : x.name.startsWith(q) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b))[0] || null;
}

// 'cup' 'tablespoon' with Ts and ts: case matters for the single letters (T = tbsp, t = tsp).
// -> { amount, unit: { kind, key }, ingredient, ingredientText, grams?, ml?, error? }
export function readConvert(text) {
  const a = readAmount(text);
  if (!a) return { error: 'start with an amount: 1 cup flour, 2 tbsp sugar, ½ stick butter, 250 g flour' };
  let rest = a.rest.trim().replace(/^fl\.?\s?oz\b/i, 'floz').replace(/^uk\s?pints?\b/i, 'ukpint');
  const m = /^[a-zA-Z.]+/.exec(rest);
  const unit = m ? unitOf(m[0]) : null;
  if (unit) rest = rest.slice(m[0].length).trim();
  if (!unit) return { error: "say a measure after the amount: tsp, tbsp, cup, ml, g, oz, lb, stick, egg …", amount: a.n };
  rest = rest.replace(/^(of)\s+/i, '');
  const r = { amount: a.n, unit, ingredientText: rest };
  if (unit.kind === 'egg') { r.grams = a.n * EGGS[unit.key].g; r.ingredient = { name: EGGS[unit.key].name }; return r; }
  const ing = rest ? findIngredient(rest) : null;
  r.ingredient = ing;
  if (unit.kind === 'stick') {
    if (ing && !ing.stick) return { error: 'a stick is a measure of butter (113 g)' };
    r.ingredient = ing || INGREDIENTS.find((x) => x.id === 'butter');
    r.grams = a.n * r.ingredient.stick;
    return r;
  }
  if (unit.kind === 'weight') { r.grams = a.n * WEIGHTS[unit.key].g; return r; }
  r.ml = a.n * VOLUMES[unit.key].ml;
  if (ing) r.grams = (r.ml * ing.cup) / 240;
  return r;
}

// Grams of `ing` as kitchen measures: the nicest of cups, tablespoons, teaspoons.
export function asMeasures(grams, ing) {
  const tsp = (grams / ing.cup) * 48;
  const out = [];
  const nice = (x) => {
    const eighths = Math.round(x * 8);
    const whole = Math.floor(eighths / 8);
    const frac = { 0: '', 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' }[eighths % 8];
    return (whole ? String(whole) : '') + frac || '0';
  };
  if (Math.round((tsp / 48) * 8) >= 2) out.push(nice(tsp / 48) + ' cup' + (tsp / 48 > 1.0625 ? 's' : ''));
  if (tsp >= 3 && tsp < 24) out.push(nice(tsp / 3) + ' tbsp');
  if (tsp < 9) out.push(nice(tsp) + ' tsp');
  if (ing.stick && grams >= ing.stick / 4) out.push(nice(grams / ing.stick) + ' stick' + (grams / ing.stick > 1.0625 ? 's' : ''));
  return out;
}

// '1 tbsp' '0.5 cup' '½ stick' as typed, tidied for the answer.
export function fmtAmount(n) {
  const whole = Math.floor(n + 1e-9);
  const f = n - whole;
  const frac = Object.entries(FRACTIONS).find(([, v]) => Math.abs(v - f) < 0.01);
  if (frac && f > 0.01) return (whole ? whole : '') + frac[0];
  return String(Math.round(n * 100) / 100);
}

// 7.5 g · 12.5 g · 125 g · 1.13 kg (a scale reads to the gram; small amounts to a tenth)
export function fmtGrams(g) {
  if (g >= 1000) return Math.round(g / 10) / 100 + ' kg';
  return (g < 20 ? Math.round(g * 10) / 10 : Math.round(g)) + ' g';
}

// 20, 25 -> '20–25 min'; 150, 180 -> '2 h 30 min–3 h'
export function fmtRange(a, b) {
  const x = fmtMinutes(a), y = fmtMinutes(b);
  if (x === y) return x;
  return /^\d+ min$/.test(x) && /^\d+ min$/.test(y) ? x.replace(' min', '') + '–' + y : x + '–' + y;
}
