#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ============================================================================
 *  🌊  PAGILA-EVENTS · SIMULADOR DE TRÁFICO DINÁMICO
 * ============================================================================
 *
 * Genera carga HTTP REAL contra el `producer` durante un período de tiempo
 * (por defecto ~2 minutos) para poder OBSERVAR el sistema bajo estrés en
 * Grafana/Prometheus: throughput, latencia p95, backlog del outbox,
 * eventos/s del consumer y salud de Postgres/Redis.
 *
 * La gracia es que el tráfico NO es plano: sigue un "perfil" de fases que
 * sube y baja el RPS objetivo (warm-up → rampa → pico → valle → SPIKE →
 * recuperación → enfriamiento). Así el dashboard muestra ondas realistas en
 * lugar de una línea recta.
 *
 *        RPS
 *         │            ╱╲            ╱╲  (spike)
 *         │        ╱╲ ╱  ╲         ╱   ╲
 *         │      ╱   ╱    ╲   ╱╲ ╱      ╲
 *         │   ╱                          ╲___
 *         └──────────────────────────────────▶ t
 *
 * Cada "operación" es un ciclo de negocio real:
 *   • ALQUILAR  →  POST /api/rentals            (baja la disponibilidad)
 *   • DEVOLVER  →  POST /api/rentals/:id/return (la restaura)
 * Se mantiene un pool de alquileres abiertos y se mezcla alta creación con
 * devoluciones, de modo que la proyección `inventory_availability` "respira".
 * Algunos 409 (sin stock / doble devolución) son ESPERADOS y forman parte de
 * una simulación realista.
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   • Stack levantado: `docker compose up -d --build`
 *   • Node ≥ 18 (fetch nativo) y `psql` en el PATH (sólo para elegir targets).
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/load-simulation.mjs
 *
 *   # overrides por variables de entorno:
 *   DURATION_SEC=180 PEAK_RPS=120 \
 *   API_URL=http://localhost:3000/api \
 *   DATABASE_URL=postgresql://pagila:pagila@localhost:5433/pagila \
 *   node scripts/load-simulation.mjs
 *
 *   Ctrl-C corta limpiamente y devuelve los alquileres que queden abiertos.
 * ============================================================================
 */

import { execFileSync } from 'node:child_process';

// ── Configuración ────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://pagila:pagila@localhost:5433/pagila';

const DURATION_SEC = Number(process.env.DURATION_SEC ?? 120); // duración total
const PEAK_RPS = Number(process.env.PEAK_RPS ?? 80); // RPS del pico/spike
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 250); // tope de conexiones simultáneas
const RETURN_BIAS = Number(process.env.RETURN_BIAS ?? 0.45); // prob. base de devolver vs alquilar

// ── Colores ANSI ─────────────────────────────────────────────────────────────
const paint = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const magenta = paint('35');

// ════════════════════════════════════════════════════════════════════════════
//  Perfil de tráfico: fases (name, dur[s], from→to RPS). Interpolación lineal
//  dentro de cada fase + un poco de jitter sinusoidal para que "respire".
// ════════════════════════════════════════════════════════════════════════════
function buildProfile(total, peak) {
  // Fracciones de la duración total; escalan con DURATION_SEC.
  const raw = [
    { name: 'warm-up', frac: 0.05, from: 0.03, to: 0.12 },
    { name: 'ramp-up', frac: 0.18, from: 0.12, to: 0.55 },
    { name: 'peak', frac: 0.2, from: 0.6, to: 0.6 },
    { name: 'valley', frac: 0.12, from: 0.6, to: 0.18 },
    { name: 'SPIKE', frac: 0.1, from: 0.25, to: 1.0 },
    { name: 'recovery', frac: 0.2, from: 1.0, to: 0.3 },
    { name: 'cool-down', frac: 0.15, from: 0.3, to: 0.03 },
  ];
  let acc = 0;
  return raw.map((p) => {
    const dur = Math.max(1, Math.round(p.frac * total));
    const phase = {
      name: p.name,
      start: acc,
      end: acc + dur,
      from: p.from * peak,
      to: p.to * peak,
    };
    acc += dur;
    return phase;
  });
}

const profile = buildProfile(DURATION_SEC, PEAK_RPS);
const totalPlanned = profile[profile.length - 1].end;

/** RPS objetivo para el segundo `t` según el perfil (+ jitter suave). */
function targetRps(t) {
  const phase = profile.find((p) => t >= p.start && t < p.end) ?? profile[profile.length - 1];
  const span = Math.max(1, phase.end - phase.start);
  const k = (t - phase.start) / span; // 0..1 dentro de la fase
  const base = phase.from + (phase.to - phase.from) * k;
  const jitter = 1 + 0.12 * Math.sin(t / 3); // ±12% ondulación
  return { name: phase.name, rps: Math.max(0, base * jitter) };
}

// ════════════════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════════════════
const COL_SEP = '\x1f';
function sql(text) {
  const out = execFileSync(
    'psql',
    [DATABASE_URL, '-tAqF', COL_SEP, '-v', 'ON_ERROR_STOP=1', '-c', text],
    { encoding: 'utf8' },
  ).trim();
  return out === '' ? [] : out.split('\n').map((l) => l.split(COL_SEP));
}

const rand = (arr) => arr[(Math.random() * arr.length) | 0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Precarga un catálogo de targets (film, store) con disponibilidad, más listas
 * de customers y staff válidos. Repartir la carga entre muchos films/stores
 * evita agotar un único ejemplar y ahoga menos la simulación en 409s.
 */
function loadCatalog() {
  const targets = sql(`
    WITH avail AS (
      SELECT i.film_id, i.store_id,
             COUNT(*) FILTER (
               WHERE NOT EXISTS (
                 SELECT 1 FROM rental r
                 WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
               )
             ) AS free
      FROM inventory i
      GROUP BY i.film_id, i.store_id
    )
    SELECT film_id, store_id FROM avail
    WHERE free >= 3
    ORDER BY free DESC
    LIMIT 60
  `).map(([f, s]) => ({ filmId: Number(f), storeId: Number(s) }));

  const customers = sql(
    `SELECT customer_id FROM customer WHERE customer_id > 0 ORDER BY random() LIMIT 40`,
  ).map(([c]) => Number(c));

  const staff = sql(`SELECT staff_id FROM staff WHERE staff_id > 0 LIMIT 20`).map(([s]) =>
    Number(s),
  );

  return { targets, customers, staff };
}

// ════════════════════════════════════════════════════════════════════════════
//  Estado / métricas de la corrida
// ════════════════════════════════════════════════════════════════════════════
const stats = {
  sent: 0,
  ok2xx: 0,
  c4xx: 0,
  e5xx: 0,
  netErr: 0,
  created: 0,
  returned: 0,
  noStock: 0,
  latSum: 0,
  latCount: 0,
  latMax: 0,
};
const lat = []; // muestras de latencia (ms) para p95 (ventana acotada)
const openRentals = []; // pool de rentalIds abiertos
let inflight = 0;
let stopping = false;

function recordLatency(ms) {
  stats.latSum += ms;
  stats.latCount++;
  if (ms > stats.latMax) stats.latMax = ms;
  lat.push(ms);
  if (lat.length > 2000) lat.shift();
}

function p95() {
  if (!lat.length) return 0;
  const sorted = [...lat].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]);
}

async function post(path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    recordLatency(performance.now() - t0);
    stats.sent++;
    if (res.status >= 500) stats.e5xx++;
    else if (res.status >= 400) stats.c4xx++;
    else stats.ok2xx++;
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* respuesta sin body JSON */
    }
    return { status: res.status, json };
  } catch {
    recordLatency(performance.now() - t0);
    stats.sent++;
    stats.netErr++;
    return { status: 0, json: null };
  }
}

let catalog;

/** Una operación de negocio: alquilar o devolver, según el estado del pool. */
async function oneOperation() {
  inflight++;
  try {
    const wantReturn =
      openRentals.length > 0 &&
      (Math.random() < RETURN_BIAS || openRentals.length > 400);

    if (wantReturn) {
      // Sacamos el id del pool ANTES de disparar para evitar doble-devolución
      // entre operaciones concurrentes.
      const idx = (Math.random() * openRentals.length) | 0;
      const rentalId = openRentals.splice(idx, 1)[0];
      const { status } = await post(`/rentals/${rentalId}/return`, {});
      if (status === 200) stats.returned++;
      // si falló (409/otros), no lo reinsertamos: quedó en estado indefinido.
    } else {
      const tgt = rand(catalog.targets);
      const { status, json } = await post('/rentals', {
        filmId: tgt.filmId,
        storeId: tgt.storeId,
        customerId: rand(catalog.customers),
        staffId: rand(catalog.staff),
      });
      if (status === 201 && json?.rentalId) {
        stats.created++;
        openRentals.push(json.rentalId);
      } else if (status === 409) {
        stats.noStock++;
      }
    }
  } finally {
    inflight--;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Motor de despacho: cada segundo apunta a `targetRps(t)` operaciones,
//  repartidas en el segundo, respetando el tope de conexiones simultáneas.
// ════════════════════════════════════════════════════════════════════════════
function bar(rps, max) {
  const width = 28;
  const n = Math.round((Math.min(rps, max) / max) * width);
  return '█'.repeat(n) + dim('░'.repeat(width - n));
}

async function driver() {
  const startedAt = Date.now();
  for (let t = 0; t < totalPlanned && !stopping; t++) {
    const { name, rps } = targetRps(t);
    const n = Math.round(rps);
    const gap = n > 0 ? 1000 / n : 1000;

    const secondEnds = Date.now() + 1000;
    for (let i = 0; i < n && !stopping; i++) {
      if (inflight < MAX_INFLIGHT) void oneOperation();
      await sleep(gap);
    }
    // Completar el segundo si terminamos antes.
    const remaining = secondEnds - Date.now();
    if (remaining > 0) await sleep(remaining);

    // ── Línea de estado en vivo ──
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    const avg = stats.latCount ? (stats.latSum / stats.latCount).toFixed(0) : '0';
    const phaseColor =
      name === 'SPIKE' ? magenta : name === 'peak' ? red : name.includes('cool') ? cyan : green;
    process.stdout.write(
      `\r${dim(`[${String(elapsed).padStart(3)}/${totalPlanned}s]`)} ` +
        `${phaseColor(name.padEnd(9))} ` +
        `${bar(rps, PEAK_RPS)} ${String(n).padStart(3)} rps  ` +
        `${dim('inflight')} ${String(inflight).padStart(3)}  ` +
        `${green('2xx')} ${String(stats.ok2xx).padStart(5)}  ` +
        `${yellow('4xx')} ${String(stats.c4xx).padStart(4)}  ` +
        `${red('5xx')} ${stats.e5xx}  ` +
        `${dim('p95')} ${String(p95()).padStart(4)}ms ` +
        `${dim('avg')} ${avg}ms   `,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Cierre limpio: esperar inflight y devolver alquileres abiertos.
// ════════════════════════════════════════════════════════════════════════════
async function drain() {
  process.stdout.write('\n' + dim('  drenando peticiones en vuelo…\n'));
  const deadline = Date.now() + 15_000;
  while (inflight > 0 && Date.now() < deadline) await sleep(200);
}

async function returnLeftovers() {
  const pending = [...openRentals];
  if (!pending.length) return;
  process.stdout.write(dim(`  devolviendo ${pending.length} alquileres abiertos (higiene)…\n`));
  let done = 0;
  const workers = Array.from({ length: 20 }, async () => {
    while (pending.length) {
      const id = pending.pop();
      try {
        await fetch(`${API_URL}/rentals/${id}/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {
        /* best effort */
      }
      done++;
    }
  });
  await Promise.all(workers);
  process.stdout.write(dim(`  devueltos ${done}.\n`));
}

function summary() {
  const avg = stats.latCount ? (stats.latSum / stats.latCount).toFixed(0) : '0';
  console.log(bold('\n══════════════════════════════════════════════════════'));
  console.log(bold('  Resumen de la simulación'));
  console.log(bold('══════════════════════════════════════════════════════'));
  console.log(`  Peticiones enviadas .... ${bold(stats.sent)}`);
  console.log(`  2xx OK ................. ${green(stats.ok2xx)}`);
  console.log(`  4xx (esperados) ........ ${yellow(stats.c4xx)}  ${dim(`(sin stock: ${stats.noStock})`)}`);
  console.log(`  5xx / errores red ...... ${red(stats.e5xx)} / ${red(stats.netErr)}`);
  console.log(`  Rentals creados ........ ${cyan(stats.created)}`);
  console.log(`  Devoluciones ........... ${cyan(stats.returned)}`);
  console.log(`  Latencia avg / p95 / max ${avg}ms / ${p95()}ms / ${stats.latMax.toFixed(0)}ms`);
  console.log(dim('\n  📊 Mirá el dashboard: http://localhost:3000/grafana  (o :3002)\n'));
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'));
  console.log(bold('  🌊  Pagila-Events · simulador de tráfico dinámico'));
  console.log(bold('══════════════════════════════════════════════════════'));
  console.log(dim(`  API       : ${API_URL}`));
  console.log(dim(`  Duración  : ${totalPlanned}s   ·   pico ≈ ${PEAK_RPS} rps   ·   inflight máx ${MAX_INFLIGHT}`));
  console.log(
    dim(
      `  Fases     : ${profile.map((p) => `${p.name}(${p.end - p.start}s)`).join(' → ')}`,
    ),
  );

  // Preflight: ¿está vivo el API?
  try {
    const res = await fetch(`${API_URL}/health/outbox`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.log(red('\n✖ El producer no responde. Levantá el stack:\n    docker compose up -d --build\n'));
    process.exit(1);
  }

  catalog = loadCatalog();
  if (!catalog.targets.length || !catalog.customers.length || !catalog.staff.length) {
    console.log(red('\n✖ No se encontraron targets con disponibilidad en la base.\n'));
    process.exit(1);
  }
  console.log(
    dim(
      `  Catálogo  : ${catalog.targets.length} (film,store) · ${catalog.customers.length} customers · ${catalog.staff.length} staff\n`,
    ),
  );

  // Ctrl-C → corte limpio.
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    process.stdout.write(yellow('\n  ⏹  cortando (Ctrl-C otra vez para forzar)…\n'));
  });

  await driver();
  await drain();
  await returnLeftovers();
  summary();
}

main().catch((err) => {
  console.error(red(`\nError fatal: ${err.message}`));
  process.exit(1);
});
