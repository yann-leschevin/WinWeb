// Moteur de formules du tableur : analyse lexicale, analyse syntaxique
// (descente récursive) et évaluation. Aucune utilisation de eval().
// Fonctions en français et en anglais (SOMME/SUM, SI/IF...), séparateur ; ou ,

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
const ERR = {
  div0: new FErr('#DIV/0!'), value: new FErr('#VALEUR!'), ref: new FErr('#REF!'), name: new FErr('#NOM?'),
  circ: new FErr('#CIRC!'), na: new FErr('#N/A'), num: new FErr('#NOMBRE!'), parse: new FErr('#ERREUR!'),
};
export { ERR };

// ------------------------------------------------------------------ références
export function colToIndex(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const cellKey = (r, c) => `${indexToCol(c)}${r + 1}`;
export function parseKey(key) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(key);
  return m ? { r: Number(m[2]) - 1, c: colToIndex(m[1]) } : null;
}

// ------------------------------------------------------------------ lexique
const TOKEN_RE = /\s*(?:(?<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|(?<str>"(?:[^"]|"")*")|(?<ref>(?:(?:'[^']+'|[A-Za-z_À-ÿ][\wÀ-ÿ.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?![\w(]))|(?<name>[A-Za-z_À-ÿ][\wÀ-ÿ.]*)|(?<op><>|<=|>=|[-+*/^&=<>%(),;:]))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw ERR.parse;
    pos = TOKEN_RE.lastIndex;
    const g = m.groups;
    if (g.num !== undefined) tokens.push({ t: 'num', v: Number(g.num) });
    else if (g.str !== undefined) tokens.push({ t: 'str', v: g.str.slice(1, -1).replace(/""/g, '"') });
    else if (g.ref !== undefined) tokens.push({ t: 'ref', v: g.ref });
    else if (g.name !== undefined) tokens.push({ t: 'name', v: g.name });
    else tokens.push({ t: 'op', v: g.op === ';' ? ',' : g.op });
  }
  return tokens;
}

function splitRef(text) {
  const bang = text.lastIndexOf('!');
  let sheet = null;
  let cell = text;
  if (bang >= 0) {
    sheet = text.slice(0, bang).replace(/^'|'$/g, '');
    cell = text.slice(bang + 1);
  }
  const p = parseKey(cell);
  return { sheet, ...p };
}

// ------------------------------------------------------------------ syntaxe
// Priorités : comparaison < concaténation & < + - < * / < ^ < unaire < %
export function parseFormula(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => tokens[i] && tokens[i].t === 'op' && tokens[i].v === v;
  const next = () => tokens[i++];
  const expect = (v) => {
    if (!isOp(v)) throw ERR.parse;
    i += 1;
  };

  function primary() {
    const tok = next();
    if (!tok) throw ERR.parse;
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'ref') {
      const a = splitRef(tok.v);
      if (isOp(':')) {
        i += 1;
        const t2 = next();
        if (!t2 || t2.t !== 'ref') throw ERR.parse;
        const b = splitRef(t2.v);
        return { k: 'range', sheet: a.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      }
      return { k: 'ref', sheet: a.sheet, r: a.r, c: a.c };
    }
    if (tok.t === 'name') {
      const name = tok.v.toUpperCase();
      if (isOp('(')) {
        i += 1;
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(isOp(',') || isOp(')') ? { k: 'lit', v: null } : comparison());
            if (isOp(',')) { i += 1; continue; }
            break;
          }
        }
        expect(')');
        return { k: 'call', name, args };
      }
      if (name === 'VRAI' || name === 'TRUE') return { k: 'lit', v: true };
      if (name === 'FAUX' || name === 'FALSE') return { k: 'lit', v: false };
      return { k: 'lit', v: ERR.name };
    }
    if (tok.v === '(') {
      const e = comparison();
      expect(')');
      return e;
    }
    if (tok.v === '-' || tok.v === '+') return { k: 'neg', sign: tok.v, e: unary() };
    throw ERR.parse;
  }
  function postfix() {
    let e = primary();
    while (isOp('%')) { i += 1; e = { k: 'bin', op: '/', a: e, b: { k: 'lit', v: 100 } }; }
    return e;
  }
  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = next().v;
      return { k: 'neg', sign: op, e: unary() };
    }
    return postfix();
  }
  function power() {
    let e = unary();
    while (isOp('^')) { i += 1; e = { k: 'bin', op: '^', a: e, b: unary() }; }
    return e;
  }
  function product() {
    let e = power();
    while (isOp('*') || isOp('/')) { const op = next().v; e = { k: 'bin', op, a: e, b: power() }; }
    return e;
  }
  function sum() {
    let e = product();
    while (isOp('+') || isOp('-')) { const op = next().v; e = { k: 'bin', op, a: e, b: product() }; }
    return e;
  }
  function concat() {
    let e = sum();
    while (isOp('&')) { i += 1; e = { k: 'bin', op: '&', a: e, b: sum() }; }
    return e;
  }
  function comparison() {
    let e = concat();
    while (['=', '<>', '<', '>', '<=', '>='].some(isOp)) { const op = next().v; e = { k: 'bin', op, a: e, b: concat() }; }
    return e;
  }
  const ast = comparison();
  if (peek()) throw ERR.parse;
  return ast;
}

// ------------------------------------------------------------------ valeurs
const isErr = (v) => v instanceof FErr;
function toNum(v) {
  if (isErr(v)) throw v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(',', '.').trim());
  if (Number.isNaN(n)) throw ERR.value;
  return n;
}
const toStr = (v) => {
  if (isErr(v)) throw v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10).replace('.', ',');
  return String(v);
};
const toBool = (v) => {
  if (isErr(v)) throw v;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'VRAI' || u === 'TRUE') return true;
    if (u === 'FAUX' || u === 'FALSE' || u === '') return false;
    throw ERR.value;
  }
  return Boolean(toNum(v));
};
function flat(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) for (const row of a) for (const v of row) out.push({ v, fromRange: true });
    else out.push({ v: a, fromRange: false });
  }
  return out;
}
function numbers(args) {
  const out = [];
  for (const { v, fromRange } of flat(args)) {
    if (isErr(v)) throw v;
    if (fromRange) { if (typeof v === 'number') out.push(v); }
    else out.push(toNum(v));
  }
  return out;
}
function compare(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'fr', { sensitivity: 'base' });
  if (typeof a === 'string') return 1;
  if (typeof b === 'string') return -1;
  return toNum(a) - toNum(b);
}
/** Critère de NB.SI / SOMME.SI : ">5", "<>a", "toto", 3, "a*" */
function matcher(crit) {
  if (typeof crit === 'number') return (v) => v === crit;
  const m = /^(<>|<=|>=|<|>|=)?(.*)$/.exec(String(crit ?? ''));
  const op = m[1] || '=';
  const raw = m[2];
  const num = raw.trim() !== '' && !Number.isNaN(Number(raw.replace(',', '.'))) ? Number(raw.replace(',', '.')) : null;
  const re = /[*?]/.test(raw) ? new RegExp(`^${raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null;
  return (v) => {
    if (isErr(v)) return false;
    let c;
    if (num !== null && typeof v === 'number') c = v - num;
    else if (num !== null && op !== '=' && op !== '<>') return false;
    else if (re && op === '=') return re.test(toStr(v));
    else if (re && op === '<>') return !re.test(toStr(v));
    else c = toStr(v).localeCompare(raw, 'fr', { sensitivity: 'base' });
    return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
  };
}
const roundTo = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

const FN = {
  SUM: (a) => numbers(a).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => { const n = numbers(a); if (!n.length) throw ERR.div0; return n.reduce((s, x) => s + x, 0) / n.length; },
  MIN: (a) => { const n = numbers(a); return n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = numbers(a); return n.length ? Math.max(...n) : 0; },
  COUNT: (a) => flat(a).filter(({ v }) => typeof v === 'number').length,
  COUNTA: (a) => flat(a).filter(({ v }) => v !== null && v !== undefined && v !== '').length,
  COUNTBLANK: (a) => flat(a).filter(({ v }) => v === null || v === undefined || v === '').length,
  PRODUCT: (a) => numbers(a).reduce((s, x) => s * x, 1),
  MEDIAN: (a) => {
    const n = numbers(a).sort((x, y) => x - y);
    if (!n.length) throw ERR.num;
    const m = Math.floor(n.length / 2);
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
  STDEV: (a) => {
    const n = numbers(a);
    if (n.length < 2) throw ERR.div0;
    const mean = n.reduce((s, x) => s + x, 0) / n.length;
    return Math.sqrt(n.reduce((s, x) => s + (x - mean) ** 2, 0) / (n.length - 1));
  },
  ROUND: ([x, d]) => roundTo(toNum(x), toNum(d ?? 0)),
  ROUNDUP: ([x, d]) => { const f = 10 ** toNum(d ?? 0); const v = toNum(x); return Math.sign(v) * Math.ceil(Math.abs(v) * f) / f; },
  ROUNDDOWN: ([x, d]) => { const f = 10 ** toNum(d ?? 0); const v = toNum(x); return Math.sign(v) * Math.floor(Math.abs(v) * f) / f; },
  INT: ([x]) => Math.floor(toNum(x)),
  ABS: ([x]) => Math.abs(toNum(x)),
  SQRT: ([x]) => { const v = toNum(x); if (v < 0) throw ERR.num; return Math.sqrt(v); },
  POWER: ([x, y]) => toNum(x) ** toNum(y),
  MOD: ([x, y]) => { const d = toNum(y); if (!d) throw ERR.div0; const v = toNum(x); return v - d * Math.floor(v / d); },
  PI: () => Math.PI,
  RAND: () => Math.random(),
  EXP: ([x]) => Math.exp(toNum(x)),
  LN: ([x]) => { const v = toNum(x); if (v <= 0) throw ERR.num; return Math.log(v); },
  LOG10: ([x]) => { const v = toNum(x); if (v <= 0) throw ERR.num; return Math.log10(v); },
  IF: ([c, a, b]) => (toBool(c) ? (a ?? true) : (b ?? false)),
  IFERROR: ([a, b]) => (isErr(a) ? b : a),
  AND: (a) => flat(a).every(({ v }) => toBool(v)),
  OR: (a) => flat(a).some(({ v }) => toBool(v)),
  NOT: ([x]) => !toBool(x),
  CONCAT: (a) => flat(a).map(({ v }) => toStr(v)).join(''),
  LEN: ([x]) => toStr(x).length,
  UPPER: ([x]) => toStr(x).toUpperCase(),
  LOWER: ([x]) => toStr(x).toLowerCase(),
  PROPER: ([x]) => toStr(x).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, l) => p + l.toUpperCase()),
  TRIM: ([x]) => toStr(x).trim().replace(/\s+/g, ' '),
  LEFT: ([x, n]) => toStr(x).slice(0, toNum(n ?? 1)),
  RIGHT: ([x, n]) => { const s = toStr(x); const k = toNum(n ?? 1); return k ? s.slice(-k) : ''; },
  MID: ([x, start, n]) => toStr(x).substr(toNum(start) - 1, toNum(n)),
  REPT: ([x, n]) => toStr(x).repeat(Math.max(0, Math.min(10000, toNum(n)))),
  TEXT: ([x, d]) => toNum(x).toLocaleString('fr-FR', { minimumFractionDigits: toNum(d ?? 0), maximumFractionDigits: toNum(d ?? 0) }),
  TODAY: () => new Date().toLocaleDateString('fr-FR'),
  NOW: () => new Date().toLocaleString('fr-FR'),
  YEAR: () => new Date().getFullYear(),
  SUMIF: ([range, crit, sumRange]) => {
    const test = matcher(crit);
    const src = Array.isArray(range) ? range : [[range]];
    const sums = Array.isArray(sumRange) ? sumRange : src;
    let total = 0;
    src.forEach((row, r) => row.forEach((v, c) => { if (test(v)) { const s = sums[r]?.[c]; if (typeof s === 'number') total += s; } }));
    return total;
  },
  COUNTIF: ([range, crit]) => {
    const test = matcher(crit);
    return (Array.isArray(range) ? range : [[range]]).flat().filter(test).length;
  },
  AVERAGEIF: ([range, crit, avgRange]) => {
    const test = matcher(crit);
    const src = Array.isArray(range) ? range : [[range]];
    const vals = Array.isArray(avgRange) ? avgRange : src;
    const n = [];
    src.forEach((row, r) => row.forEach((v, c) => { if (test(v) && typeof vals[r]?.[c] === 'number') n.push(vals[r][c]); }));
    if (!n.length) throw ERR.div0;
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  VLOOKUP: ([key, table, col, approx]) => {
    if (!Array.isArray(table)) throw ERR.value;
    const k = toNum(col) - 1;
    if (k < 0 || k >= (table[0]?.length || 0)) throw ERR.ref;
    const exact = approx === false || approx === 0;
    if (exact || approx === undefined || approx === null) {
      const row = table.find((r) => compare(r[0] ?? '', key) === 0);
      if (row) return row[k];
      if (exact) throw ERR.na;
    }
    let best = null;
    for (const r of table) if (r[0] !== null && compare(r[0], key) <= 0) best = r;
    if (!best) throw ERR.na;
    return best[k];
  },
  INDEX: ([table, r, c]) => {
    if (!Array.isArray(table)) return table;
    const row = table[toNum(r) - 1];
    if (!row) throw ERR.ref;
    const v = row[toNum(c ?? 1) - 1];
    if (v === undefined) throw ERR.ref;
    return v;
  },
  MATCH: ([key, range]) => {
    const list = (Array.isArray(range) ? range : [[range]]).flat();
    const idx = list.findIndex((v) => v !== null && compare(v, key) === 0);
    if (idx < 0) throw ERR.na;
    return idx + 1;
  },
  ISNUMBER: ([x]) => typeof x === 'number',
  ISBLANK: ([x]) => x === null || x === undefined || x === '',
  ISERROR: ([x]) => isErr(x),
};
const ALIASES = {
  SOMME: 'SUM', MOYENNE: 'AVERAGE', NB: 'COUNT', NBVAL: 'COUNTA', 'NB.VIDE': 'COUNTBLANK', PRODUIT: 'PRODUCT',
  MEDIANE: 'MEDIAN', ECARTYPE: 'STDEV', 'ECARTYPE.STANDARD': 'STDEV', ARRONDI: 'ROUND', 'ARRONDI.SUP': 'ROUNDUP',
  'ARRONDI.INF': 'ROUNDDOWN', ENT: 'INT', RACINE: 'SQRT', PUISSANCE: 'POWER', ALEA: 'RAND', SI: 'IF',
  SIERREUR: 'IFERROR', ET: 'AND', OU: 'OR', NON: 'NOT', CONCATENER: 'CONCAT', CONCATENATE: 'CONCAT', NBCAR: 'LEN',
  MAJUSCULE: 'UPPER', MINUSCULE: 'LOWER', NOMPROPRE: 'PROPER', SUPPRESPACE: 'TRIM', GAUCHE: 'LEFT', DROITE: 'RIGHT',
  STXT: 'MID', TEXTE: 'TEXT', AUJOURDHUI: 'TODAY', MAINTENANT: 'NOW', ANNEE: 'YEAR', 'SOMME.SI': 'SUMIF',
  'NB.SI': 'COUNTIF', 'MOYENNE.SI': 'AVERAGEIF', RECHERCHEV: 'VLOOKUP', EQUIV: 'MATCH', ESTNUM: 'ISNUMBER',
  ESTVIDE: 'ISBLANK', ESTERREUR: 'ISERROR', LOG: 'LOG10',
};
// Fonctions dont les arguments d'erreur ne doivent pas être propagés.
const LAZY_ERR = new Set(['IFERROR', 'ISERROR', 'IF']);

export const FUNCTION_NAMES = [...Object.keys(ALIASES), ...Object.keys(FN)].sort();

// ------------------------------------------------------------------ évaluation
/**
 * ctx : { getCell(sheetName|null, r, c) -> valeur, sheetExists(name) }
 */
export function evaluate(ast, ctx) {
  const ev = (n) => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref':
        if (n.sheet && !ctx.sheetExists(n.sheet)) return ERR.ref;
        return ctx.getCell(n.sheet, n.r, n.c);
      case 'range': {
        if (n.sheet && !ctx.sheetExists(n.sheet)) return ERR.ref;
        if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 200000) return ERR.ref;
        const rows = [];
        for (let r = n.r1; r <= n.r2; r += 1) {
          const row = [];
          for (let c = n.c1; c <= n.c2; c += 1) row.push(ctx.getCell(n.sheet, r, c));
          rows.push(row);
        }
        return rows;
      }
      case 'neg': {
        const v = ev(n.e);
        if (isErr(v)) return v;
        return n.sign === '-' ? -toNum(scalar(v)) : toNum(scalar(v));
      }
      case 'bin': {
        const a = scalar(ev(n.a));
        const b = scalar(ev(n.b));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        switch (n.op) {
          case '+': return toNum(a) + toNum(b);
          case '-': return toNum(a) - toNum(b);
          case '*': return toNum(a) * toNum(b);
          case '/': { const d = toNum(b); if (d === 0) return ERR.div0; return toNum(a) / d; }
          case '^': return toNum(a) ** toNum(b);
          case '&': return toStr(a) + toStr(b);
          case '=': return compare(a ?? '', b ?? '') === 0;
          case '<>': return compare(a ?? '', b ?? '') !== 0;
          case '<': return compare(a ?? 0, b ?? 0) < 0;
          case '>': return compare(a ?? 0, b ?? 0) > 0;
          case '<=': return compare(a ?? 0, b ?? 0) <= 0;
          case '>=': return compare(a ?? 0, b ?? 0) >= 0;
          default: return ERR.parse;
        }
      }
      case 'call': {
        const name = ALIASES[n.name] || n.name;
        const fn = FN[name];
        if (!fn) return ERR.name;
        if (name === 'IF') {
          // Évaluation paresseuse des branches.
          const c = scalar(ev(n.args[0] || { k: 'lit', v: false }));
          if (isErr(c)) return c;
          const branch = toBool(c) ? n.args[1] : n.args[2];
          if (!branch) return toBool(c);
          return scalar(ev(branch));
        }
        const args = n.args.map(ev);
        if (!LAZY_ERR.has(name)) {
          const bad = args.find(isErr);
          if (bad) return bad;
        }
        return fn(args);
      }
      default: return ERR.parse;
    }
  };
  const scalar = (v) => (Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : ERR.value) : v);
  try {
    const out = scalar(ev(ast));
    if (typeof out === 'number' && !Number.isFinite(out)) return ERR.num;
    return out ?? 0;
  } catch (err) {
    if (isErr(err)) return err;
    return ERR.value;
  }
}

// ------------------------------------------------------------------ réécriture des références
const REF_IN_TEXT = /(?<![\wÀ-ÿ.$])((?:'[^']+'|[A-Za-z_À-ÿ][\wÀ-ÿ.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g;

/**
 * Réécrit les références d'une formule (hors chaînes).
 * fn(info) avec info = { sheet, r, c, absR, absC } -> { r, c } | null (null => #REF!)
 */
export function rewriteRefs(formula, fn) {
  return formula.split(/("(?:[^"]|"")*")/).map((part, idx) => {
    if (idx % 2) return part; // chaîne littérale
    return part.replace(REF_IN_TEXT, (m, sheetPart, dc, col, dr, row) => {
      const sheet = sheetPart ? sheetPart.slice(0, -1).replace(/^'|'$/g, '') : null;
      const res = fn({ sheet, r: Number(row) - 1, c: colToIndex(col), absR: !!dr, absC: !!dc });
      if (res === undefined) return m;
      if (res === null || res.r < 0 || res.c < 0) return `${sheetPart || ''}#REF!`;
      return `${sheetPart || ''}${dc}${indexToCol(res.c)}${dr}${res.r + 1}`;
    });
  }).join('');
}

/** Décale les références relatives (copier/coller, recopie). */
export function translateFormula(formula, dr, dc) {
  return rewriteRefs(formula, ({ r, c, absR, absC }) => ({ r: absR ? r : r + dr, c: absC ? c : c + dc }));
}
