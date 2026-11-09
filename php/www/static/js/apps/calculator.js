// Calculatrice standard (sans eval : machine à états).
import { h } from '../utils.js';
import { createWindow } from '../windowManager.js';

const OPS = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => a / b };

function format(n) {
  if (!Number.isFinite(n)) return 'Impossible de diviser par zéro';
  if (Math.abs(n) >= 1e16 || (n !== 0 && Math.abs(n) < 1e-10)) return n.toExponential(8).replace('.', ',');
  const s = String(parseFloat(n.toPrecision(15)));
  const [int, dec] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dec ? `${grouped},${dec}` : grouped;
}

function launch() {
  const st = { entry: '0', acc: null, op: null, fresh: true, error: false, expr: '' };
  const exprEl = h('div', { class: 'calc-expr' });
  const displayEl = h('div', { class: 'calc-display', text: '0' });
  const historyEl = h('div', { class: 'calc-history' }, h('div', { class: 'calc-hist-empty', text: 'Aucun historique pour l\'instant' }));

  const value = () => parseFloat(st.entry.replace(',', '.'));

  /** Affiche la saisie en cours telle quelle (pour conserver « 3, » ou « 2,50 »). */
  function displayText() {
    if (st.error) return st.entry;
    if (!st.fresh && st.entry.includes(',')) {
      const [int, dec] = st.entry.split(',');
      return `${format(parseFloat(int) || 0).replace(/^0$/, int.startsWith('-') ? '-0' : '0')},${dec}`;
    }
    return format(value());
  }
  function show() {
    exprEl.textContent = st.expr;
    displayEl.textContent = displayText();
    displayEl.classList.toggle('small', displayEl.textContent.length > 12);
  }
  function setResult(n) {
    if (!Number.isFinite(n)) {
      st.error = true;
      st.entry = format(n);
      st.acc = null;
      st.op = null;
    } else {
      st.entry = String(parseFloat(n.toPrecision(15))).replace('.', ',');
    }
  }
  function clearAll() {
    Object.assign(st, { entry: '0', acc: null, op: null, fresh: true, error: false, expr: '' });
  }
  function digit(d) {
    if (st.error) clearAll();
    if (st.fresh) {
      st.entry = d === ',' ? '0,' : d;
      st.fresh = false;
      return;
    }
    if (d === ',' && st.entry.includes(',')) return;
    if (st.entry.replace(/[-,]/g, '').length >= 16) return;
    st.entry = st.entry === '0' && d !== ',' ? d : st.entry + d;
  }
  function operator(op) {
    if (st.error) return;
    if (st.op && !st.fresh) {
      setResult(OPS[st.op](st.acc, value()));
      if (st.error) return;
    }
    st.acc = value();
    st.op = op;
    st.expr = `${format(st.acc)} ${op}`;
    st.fresh = true;
  }
  function equals() {
    if (st.error || !st.op) return;
    const a = st.acc;
    const b = value();
    const r = OPS[st.op](a, b);
    const line = `${format(a)} ${st.op} ${format(b)} =`;
    setResult(r);
    st.expr = line;
    if (!st.error) {
      historyEl.querySelector('.calc-hist-empty')?.remove();
      historyEl.prepend(h('div', { class: 'calc-hist-row' },
        h('div', { class: 'calc-hist-expr', text: line }), h('div', { class: 'calc-hist-val', text: format(r) })));
    }
    st.op = null;
    st.acc = null;
    st.fresh = true;
  }
  function unary(kind) {
    if (st.error) return;
    const v = value();
    const fns = {
      inv: [(x) => 1 / x, `1/(${format(v)})`],
      sq: [(x) => x * x, `sqr(${format(v)})`],
      sqrt: [(x) => (x < 0 ? NaN : Math.sqrt(x)), `√(${format(v)})`],
      pct: [(x) => (st.acc !== null ? (st.acc * x) / 100 : x / 100), ''],
      neg: [(x) => -x, ''],
    };
    const [fn, label] = fns[kind];
    const r = fn(v);
    if (Number.isNaN(r)) {
      st.error = true;
      st.entry = 'Entrée non valide';
      return;
    }
    setResult(r);
    if (label) st.expr = st.op ? `${format(st.acc)} ${st.op} ${label}` : label;
    if (kind !== 'neg') st.fresh = true;
  }
  function backspace() {
    if (st.error) {
      clearAll();
      return;
    }
    if (st.fresh) return;
    const short = st.entry.length <= 1 || (st.entry.length === 2 && st.entry.startsWith('-'));
    st.entry = short ? '0' : st.entry.slice(0, -1);
  }
  function clearEntry() {
    st.entry = '0';
    st.fresh = true;
    st.error = false;
  }

  const keys = [
    ['%', () => unary('pct'), 'fn'], ['CE', clearEntry, 'fn'], ['C', clearAll, 'fn'], ['⌫', backspace, 'fn'],
    ['¹/ₓ', () => unary('inv'), 'fn'], ['x²', () => unary('sq'), 'fn'], ['²√x', () => unary('sqrt'), 'fn'], ['÷', () => operator('÷'), 'op'],
    ['7', () => digit('7')], ['8', () => digit('8')], ['9', () => digit('9')], ['×', () => operator('×'), 'op'],
    ['4', () => digit('4')], ['5', () => digit('5')], ['6', () => digit('6')], ['−', () => operator('−'), 'op'],
    ['1', () => digit('1')], ['2', () => digit('2')], ['3', () => digit('3')], ['+', () => operator('+'), 'op'],
    ['+/−', () => unary('neg')], ['0', () => digit('0')], [',', () => digit(',')], ['=', equals, 'eq'],
  ];
  const pad = h('div', { class: 'calc-pad' }, keys.map(([label, fn, kind]) => h('button', {
    class: `calc-key ${kind || 'num'}`, type: 'button', text: label, dataset: { key: label },
    onclick: () => {
      fn();
      show();
    },
  })));
  const root = h('div', { class: 'calculator', tabindex: '0' },
    h('div', { class: 'calc-main' }, h('div', { class: 'calc-mode', text: '☰  Standard' }), exprEl, displayEl, pad),
    h('div', { class: 'calc-side' }, h('div', { class: 'calc-side-title', text: 'Historique' }), historyEl));

  root.addEventListener('keydown', (e) => {
    const map = {
      '/': '÷', '*': '×', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'CE', '.': ',', ',': ',', '%': '%',
    };
    const label = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (!label) return;
    e.preventDefault();
    const btn = [...pad.children].find((b) => b.dataset.key === label);
    if (!btn) return;
    btn.click();
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 120);
  });

  const win = createWindow({
    appId: 'calculator', title: 'Calculatrice', icon: '🧮', width: 560, height: 540, minWidth: 320, minHeight: 460, content: root,
  });
  setTimeout(() => root.focus(), 50);
  return win;
}

export default { id: 'calculator', name: 'Calculatrice', icon: '🧮', launch, description: 'Calculatrice standard' };
