// Arithmetic by recursive descent. Never eval / Function.
//   expr   = term (('+' | '-') term)*
//   term   = unary (('*' | '/' | '%') unary)*
//   unary  = ('-' | '+') unary | power
//   power  = atom ('^' unary)?          (right-associative, so -2^2 = -4)
//   atom   = number | const | fn '(' expr (',' expr)* ')' | '(' expr ')'

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };
const MAX_LENGTH = 500;

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z][a-z0-9]*)|(.))/gyi;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]), pos: m.index });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2].toLowerCase(), pos: m.index });
    else tokens.push({ t: 'op', v: m[3], pos: m.index });
  }
  return tokens;
}

function evaluate(src) {
  if (src.length > MAX_LENGTH) throw new Error('expression is too long');
  const tokens = tokenize(src.trim());
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => tokens[i] && tokens[i].t === 'op' && tokens[i].v === v;
  const fail = (msg) => { throw new Error(msg); };

  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function term() {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[i++].v;
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) fail('division by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }

  function unary() {
    if (isOp('-')) { i++; return -unary(); }
    if (isOp('+')) { i++; return unary(); }
    return power();
  }

  function power() {
    const base = atom();
    if (isOp('^')) { i++; return Math.pow(base, unary()); }
    return base;
  }

  function atom() {
    const tok = peek();
    if (!tok) return fail('unexpected end of expression');
    if (tok.t === 'num') { i++; return tok.v; }
    if (tok.t === 'op' && tok.v === '(') {
      i++;
      const v = expr();
      if (!isOp(')')) fail("expected ')'");
      i++;
      return v;
    }
    if (tok.t === 'id') {
      i++;
      if (isOp('(')) {
        if (!Object.prototype.hasOwnProperty.call(FUNCS, tok.v)) fail("unknown function '" + tok.v + "'");
        i++;
        const args = [expr()];
        while (isOp(',')) { i++; args.push(expr()); }
        if (!isOp(')')) fail("expected ')'");
        i++;
        return FUNCS[tok.v].apply(null, args);
      }
      if (Object.prototype.hasOwnProperty.call(CONSTS, tok.v)) return CONSTS[tok.v];
      return fail("unknown name '" + tok.v + "'");
    }
    return fail("unexpected '" + tok.v + "'");
  }

  if (!tokens.length) fail('empty expression');
  const result = expr();
  if (i < tokens.length) fail("unexpected '" + tokens[i].v + "'");
  if (!Number.isFinite(result)) fail('result is not a finite number');
  return result;
}

function formatNumber(n, digits) {
  const v = Number(n.toPrecision(digits || 15));
  return Object.is(v, -0) ? '0' : String(v);
}

export { evaluate, formatNumber };
