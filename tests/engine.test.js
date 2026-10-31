const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../app/js/engine.js');

const cerca = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) / Math.max(1, Math.abs(b)) < tol, `${a} vs ${b}`);
const final = (f) => f[f.length - 1];

test('coincide con la fórmula cerrada (capitalización y aportes mensuales)', () => {
  const P = 10000, C = 200, r = 0.07, n = 30 * 12, i = r / 12;
  const esperado = P * Math.pow(1 + i, n) + C * (Math.pow(1 + i, n) - 1) / i;
  const f = E.proyectar({ inicial: P, anios: 30, tasa: 7, capitalizacion: 12, aporte: C, frecuenciaAporte: 12 });
  cerca(final(f).saldo, esperado);
  cerca(final(f).aportado, P + C * n);
});

test('capitalización anual con aporte anual', () => {
  const f = E.proyectar({ inicial: 1000, anios: 10, tasa: 5, capitalizacion: 1, aporte: 100, frecuenciaAporte: 1 });
  const esperado = 1000 * 1.05 ** 10 + 100 * (1.05 ** 10 - 1) / 0.05;
  cerca(final(f).saldo, esperado);
});

test('tasa 0 y años 0', () => {
  assert.equal(final(E.proyectar({ inicial: 500, anios: 5, tasa: 0, aporte: 10 })).saldo, 500 + 10 * 60);
  const f0 = E.proyectar({ inicial: 500, anios: 0, tasa: 8 });
  assert.equal(f0.length, 1);
  assert.equal(f0[0].saldo, 500);
});

test('contribución creciente y por tramos', () => {
  const o = { aporte: 100, crecimientoAporte: 10, tramos: [{ desde: 5, monto: 500 }] };
  cerca(E.aporteDelAnio(o, 1), 100);
  cerca(E.aporteDelAnio(o, 3), 121);
  cerca(E.aporteDelAnio(o, 5), 500);
  cerca(E.aporteDelAnio(o, 6), 550);
});

test('retiros nunca dejan saldo negativo', () => {
  const f = E.proyectar({ inicial: 1000, anios: 10, tasa: 0, aporte: -50 });
  assert.equal(final(f).saldo, 0);
});

test('comisión reduce el valor final y valor real descuenta inflación', () => {
  const base = { inicial: 10000, anios: 30, tasa: 7, aporte: 0, inflacion: 3 };
  const sin = final(E.proyectar(base)).saldo;
  const con = final(E.proyectar({ ...base, comision: 1 })).saldo;
  assert.ok(con < sin * 0.8, 'una comisión de 1% debe comerse >20% en 30 años');
  cerca(final(E.proyectar(base)).real, sin / 1.03 ** 30);
});

test('varios capitales iniciales y banda de tasas', () => {
  const r = E.escenarios({ capitales: [1000, 5000], anios: 10, tasa: 6, varianza: 2, aporte: 0 });
  assert.equal(r.length, 2);
  assert.ok(final(r[0].bajo).saldo < final(r[0].filas).saldo && final(r[0].filas).saldo < final(r[0].alto).saldo);
});

test('portafolio diversificado reduce volatilidad', () => {
  const corr = { categorias: ['a', 'b'], matriz: [[1, 0], [0, 1]] };
  const p = E.portafolio([
    { peso: 50, retorno: 8, volatilidad: 20, categoria: 'a' },
    { peso: 50, retorno: 8, volatilidad: 20, categoria: 'b' },
  ], corr);
  cerca(p.volatilidad, Math.sqrt(0.5) * 20, 1e-6);
  assert.ok(p.retornoGeom > 8, 'bono de diversificación');
});

test('Monte Carlo: mediana cercana a la proyección determinista y es reproducible', () => {
  const o = { inicial: 10000, anios: 20, retorno: 7, volatilidad: 15, aporte: 0, sims: 4000 };
  const a = E.monteCarlo(o), b = E.monteCarlo(o);
  assert.equal(a.bandas[20].p50, b.bandas[20].p50);
  cerca(a.bandas[20].p50, 10000 * 1.07 ** 20, 0.06);
  assert.ok(a.bandas[20].p10 < a.bandas[20].p50 && a.bandas[20].p50 < a.bandas[20].p90);
});

test('regla del 72', () => {
  const d = E.duplicar(8);
  cerca(d.exacto, 9.006, 1e-3);
  assert.equal(d.regla72, 9);
});

test('Monte Carlo con retiros reporta probabilidad de agotar el capital', () => {
  const mc = E.monteCarlo({ inicial: 10000, anios: 10, retorno: 5, volatilidad: 10, aporte: -200 });
  assert.equal(mc.bandas[10].p50, 0);
  assert.ok(mc.probAgotar > 0.9);
  assert.ok(mc.probPerdida > 0.9);
});

test('Monte Carlo: pérdida medida en términos reales', () => {
  const mc = E.monteCarlo({ inicial: 10000, anios: 20, retorno: 3, volatilidad: 12, aporte: 0, inflacion: 3, sims: 4000 });
  assert.ok(mc.probPerdida > 0.4 && mc.probPerdida < 0.75, String(mc.probPerdida));
});

test('Monte Carlo con aporte anual coincide con la proyección determinista (vol ≈ 0)', () => {
  const o = { inicial: 10000, anios: 20, retorno: 6, volatilidad: 0.0001, aporte: 2000, frecuenciaAporte: 1, sims: 50 };
  const det = final(E.proyectar({ ...o, tasa: 6, capitalizacion: 1 })).saldo;
  cerca(E.monteCarlo(o).bandas[20].p50, det, 1e-3);
});

test('entradas como texto se tratan como números', () => {
  const r = E.escenarios({ capitales: ['1000'], anios: 10, tasa: '7', varianza: 2, aporte: 0 });
  cerca(final(r[0].alto).saldo, final(E.proyectar({ inicial: 1000, anios: 10, tasa: 9 })).saldo);
  const p = E.portafolio([{ peso: '50', retorno: 5, volatilidad: 10, categoria: 'a' }, { peso: '50', retorno: 5, volatilidad: 10, categoria: 'a' }], null);
  cerca(p.pesos[0], 0.5);
});

test('sin capital ni aportes no hay falsa alarma de agotamiento', () => {
  assert.equal(E.monteCarlo({ inicial: 0, anios: 10, retorno: 5, volatilidad: 10, aporte: 0 }).probAgotar, 0);
});

test('parámetros año por año: tasa, aporte, comisión, inflación y aporte extra', () => {
  const base = { inicial: 1000, anios: 3, tasa: 10, capitalizacion: 1, aporte: 0, frecuenciaAporte: 1 };
  // año 2 a 0%: 1000·1,1·1·1,1
  cerca(final(E.proyectar({ ...base, porAnio: { 2: { tasa: 0 } } })).saldo, 1000 * 1.1 * 1.1);
  // aporte anual solo el año 3
  cerca(final(E.proyectar({ ...base, porAnio: { 3: { aporte: 500 } } })).saldo, 1000 * 1.1 ** 3 + 500);
  // aporte extra al inicio del año 2 crece dos años
  cerca(final(E.proyectar({ ...base, porAnio: { 2: { extra: 1000 } } })).saldo, 1000 * 1.1 ** 3 + 1000 * 1.1 ** 2);
  // comisión solo el año 1
  cerca(final(E.proyectar({ ...base, porAnio: { 1: { comision: 1 } } })).saldo, 1000 * 1.1 * 0.99 * 1.1 ** 2);
  // inflación variable: real = saldo / (1,02·1,10·1,02)
  const f = final(E.proyectar({ ...base, inflacion: 2, porAnio: { 2: { inflacion: 10 } } }));
  cerca(f.real, f.saldo / (1.02 * 1.1 * 1.02));
  // capitalización distinta un año
  cerca(final(E.proyectar({ ...base, anios: 1, porAnio: { 1: { capitalizacion: 12 } } })).saldo, 1000 * (1 + 0.1 / 12) ** 12);
});

test('banda ± y sin comisión respetan los overrides por año', () => {
  const r = E.escenarios({ capitales: [1000], anios: 2, tasa: 5, varianza: 1, capitalizacion: 1, comision: 1, porAnio: { 2: { tasa: 0, comision: 2 } } });
  cerca(final(r[0].alto).saldo, 1000 * 1.06 * 0.99 * 1.01 * 0.98);
  cerca(final(r[0].sinComision).saldo, 1000 * 1.05 * 1.0);
});

test('Monte Carlo aplica aporte extra e inflación por año', () => {
  const o = { inicial: 1000, anios: 3, retorno: 10, volatilidad: 0.0001, aporte: 0, frecuenciaAporte: 1, inflacion: 2, porAnio: { 2: { extra: 1000, inflacion: 10 } }, sims: 20 };
  const mc = E.monteCarlo(o);
  cerca(mc.bandas[3].p50, 1000 * 1.1 ** 3 + 1000 * 1.1 ** 2, 1e-3);
  cerca(mc.bandas[3].d, 1.02 * 1.1 * 1.02);
});

test('el bono de rebalanceo se limita: un activo muy volátil no infla el retorno del portafolio', () => {
  const p = E.portafolio([
    { peso: 34, retorno: 8, volatilidad: 20, categoria: 'tradicional' },
    { peso: 33, retorno: 5.5, volatilidad: 20, categoria: 'tradicional' },
    { peso: 33, retorno: 10, volatilidad: 70, categoria: 'cripto' },
  ], { categorias: ['tradicional', 'cripto'], matriz: [[1, 0.3], [0.3, 1]] });
  const ponderado = 0.34 * 8 + 0.33 * 5.5 + 0.33 * 10;
  assert.ok(p.bonoTeorico > 3, 'el bono teórico es grande');
  cerca(p.retornoGeom, ponderado + 0.5);
});
