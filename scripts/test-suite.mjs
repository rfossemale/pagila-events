#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ============================================================================
 *  🧪  PAGILA-EVENTS · BATERÍA DE PRUEBAS DE INTEGRACIÓN (end-to-end)
 * ============================================================================
 *
 * Este script NO usa un framework de testing: es un runner autónomo que dispara
 * pedidos HTTP REALES contra el `producer` (y opcionalmente el `consumer`) y
 * verifica los efectos en la base PostgreSQL. Sirve como "smoke test" vivo de
 * toda la arquitectura event-driven:
 *
 *     POST /rentals  ──▶  outbox  ──▶  LISTEN/NOTIFY  ──▶  BullMQ  ──▶  consumer
 *                                                                         │
 *                                          proyección `inventory_availability`
 *
 * Qué valida, suite por suite:
 *   0. Preflight ............ el API responde (si no, aborta con instrucciones).
 *   1. Alta de rental ....... 201 + fila en DB + outbox drenado + proyección −1.
 *   2. Devolución ........... 200 + return_date + proyección restaurada (+1).
 *   3. Reglas de negocio .... doble-return 409, inexistente 404, payload 400.
 *   4. Idempotencia ......... mismo eventId dos veces se procesa UNA sola vez.
 *   5. Orden por versión .... un evento "viejo" (v menor) se descarta.
 *   6. Concurrencia ......... N pedidos en paralelo NO doble-reservan el mismo
 *                             ejemplar (lock pesimista FOR UPDATE SKIP LOCKED).
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   • `docker compose up -d --build` (postgres, redis, producer, nginx, consumer)
 *   • Node ≥ 18 (fetch nativo) y `psql` en el PATH.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/test-suite.mjs
 *
 *   # con overrides por variables de entorno:
 *   API_URL=http://localhost:3000/api \
 *   CONSUMER_URL=http://localhost:3101 \
 *   DATABASE_URL=postgresql://pagila:pagila@localhost:5433/pagila \
 *   node scripts/test-suite.mjs
 *
 * Exit code 0 = todo verde. Exit code 1 = al menos una prueba falló.
 * ============================================================================
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ── Configuración (con defaults para un compose local) ──────────────────────
const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
const CONSUMER_URL = process.env.CONSUMER_URL ?? 'http://localhost:3101';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://pagila:pagila@localhost:5433/pagila';

// ── Colores ANSI (sin dependencias) ─────────────────────────────────────────
const paint = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

// ════════════════════════════════════════════════════════════════════════════
//  Helpers de infraestructura
// ════════════════════════════════════════════════════════════════════════════

const COL_SEP = '\x1f'; // unit separator: separador de columnas improbable en datos

/**
 * Ejecuta una consulta SQL vía `psql` y devuelve las filas como array de arrays
 * de strings. Usa modo tuples-only (-t), sin alinear (-A) y aborta ante errores
 * (ON_ERROR_STOP). Ejemplo: sql('SELECT 1, 2') → [['1','2']].
 */
function sql(text) {
  const out = execFileSync(
    'psql',
    [DATABASE_URL, '-tAqF', COL_SEP, '-v', 'ON_ERROR_STOP=1', '-c', text],
    { encoding: 'utf8' },
  ).trim();
  if (out === '') return [];
  return out.split('\n').map((line) => line.split(COL_SEP));
}

/** Devuelve la primera celda de la primera fila (o null si no hay filas). */
function sqlScalar(text) {
  const rows = sql(text);
  return rows.length ? rows[0][0] : null;
}

/**
 * Wrapper de fetch → { status, ok, json }. `base` permite apuntar al producer
 * o al consumer. Nunca lanza por status HTTP: devuelve el código para que la
 * prueba lo assertee.
 */
async function http(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json };
}

const api = (method, path, body) => http(API_URL, method, path, body);

/**
 * Reintenta `fn` hasta que devuelva un valor truthy o se agote el timeout.
 * Ideal para consistencia eventual: el consumer aplica los eventos de forma
 * asíncrona, así que "esperamos a que" la proyección refleje el cambio.
 */
async function waitFor(fn, { timeoutMs = 10_000, intervalMs = 200, desc } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timeout (${timeoutMs}ms) esperando: ${desc ?? 'condición'} (último valor: ${JSON.stringify(last)})`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Mini-framework de aserciones + reporte
// ════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function section(title) {
  console.log(`\n${bold(cyan(`▐ ${title}`))}`);
}

async function test(name, fn) {
  process.stdout.write(`  ${dim('•')} ${name} ${dim('…')} `);
  try {
    await fn();
    passed++;
    console.log(green('PASS'));
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.log(red('FAIL'));
    console.log(red(`      ↳ ${err.message}`));
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  ${dim('•')} ${name} ${dim('…')} ${yellow('SKIP')} ${dim(`(${reason})`)}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assert falló');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `${msg ? msg + ': ' : ''}esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Consultas de dominio reutilizables
// ════════════════════════════════════════════════════════════════════════════

/** Disponibilidad proyectada por el consumer para un (film, store). */
const availabilityOf = (filmId, storeId) => {
  const v = sqlScalar(
    `SELECT available FROM consumer.inventory_availability
      WHERE film_id = ${filmId} AND store_id = ${storeId}`,
  );
  return v === null ? null : Number(v);
};

/** Versión del agregado aplicada por el consumer (o null si nunca se vio). */
const aggregateVersionOf = (aggregateId) => {
  const v = sqlScalar(
    `SELECT version FROM consumer.aggregate_version
      WHERE aggregate_id = '${aggregateId}'`,
  );
  return v === null ? null : Number(v);
};

/** true si el rental sigue abierto (return_date IS NULL). Devolvemos un
 *  booleano SQL ('t'/'f') para no confundir NULL con "fila inexistente". */
const rentalIsOpen = (rentalId) =>
  sqlScalar(`SELECT (return_date IS NULL) FROM rental WHERE rental_id = ${rentalId}`) === 't';

/** Backlog del outbox: cantidad de filas todавía sin publicar. */
async function outboxPending() {
  const { json } = await api('GET', '/health/outbox');
  return json?.pending ?? 0;
}

/**
 * Busca un (film, store) con al menos `minAvailable` ejemplares libres,
 * junto con un customer y un staff válidos de esa tienda. Devuelve el "target"
 * o null si no hay candidatos.
 */
function pickTarget(minAvailable) {
  const rows = sql(`
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
    SELECT film_id, store_id, free
    FROM avail
    WHERE free >= ${minAvailable}
    ORDER BY free ASC, film_id ASC
    LIMIT 1
  `);
  if (!rows.length) return null;
  const [filmId, storeId, free] = rows[0].map(Number);
  // customer/staff sólo necesitan existir (FK) y ser enteros positivos; en este
  // dataset (Pagila ampliado) los ids no se alinean 1:1 con la tienda, así que
  // tomamos cualquier id válido > 0.
  const customerId = Number(
    sqlScalar(`SELECT customer_id FROM customer WHERE customer_id > 0 ORDER BY customer_id LIMIT 1`),
  );
  const staffId = Number(
    sqlScalar(`SELECT staff_id FROM staff WHERE staff_id > 0 ORDER BY staff_id LIMIT 1`),
  );
  return { filmId, storeId, free, customerId, staffId };
}

// Rentals creados durante la corrida → se devuelven al final (test higiénico).
const openedRentals = new Set();
const trackOpen = (id) => openedRentals.add(id);
const trackReturned = (id) => openedRentals.delete(id);

// ════════════════════════════════════════════════════════════════════════════
//  SUITES
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'));
  console.log(bold('  🧪  Pagila-Events · batería de pruebas de integración'));
  console.log(bold('══════════════════════════════════════════════════════'));
  console.log(dim(`  API      : ${API_URL}`));
  console.log(dim(`  Consumer : ${CONSUMER_URL}`));
  console.log(dim(`  Database : ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`));

  // ── Suite 0 · Preflight ───────────────────────────────────────────────────
  section('Suite 0 · Preflight');
  let apiUp = false;
  await test('el API del producer responde (GET /health/outbox)', async () => {
    const { status, json } = await api('GET', '/health/outbox');
    assertEq(status, 200, 'status');
    assert(json && typeof json.pending === 'number', 'respuesta con { pending }');
    apiUp = true;
  });
  if (!apiUp) {
    console.log(
      red(
        '\n✖ El producer no responde. Levantá el stack con:\n' +
          '    docker compose up -d --build\n',
      ),
    );
    process.exit(1);
  }

  // ¿El consumer expone HTTP? (para las suites de idempotencia / orden)
  let consumerUp = false;
  try {
    const r = await http(CONSUMER_URL, 'GET', '/');
    consumerUp = r.status < 500;
  } catch {
    consumerUp = false;
  }

  // ── Suite 1 · Alta de rental (happy path) ─────────────────────────────────
  section('Suite 1 · Alta de rental (happy path)');
  const target = pickTarget(1);
  assert(target, 'debe existir al menos un film/store con stock disponible');
  console.log(
    dim(
      `      target → film=${target.filmId} store=${target.storeId} ` +
        `customer=${target.customerId} staff=${target.staffId} (libres=${target.free})`,
    ),
  );

  // Esperamos a que el pipeline esté ocioso para medir una base estable.
  await waitFor(async () => (await outboxPending()) === 0, {
    desc: 'outbox drenado antes de empezar',
  });
  const availBefore = availabilityOf(target.filmId, target.storeId);

  let rentalId;
  await test('POST /rentals → 201 con la forma esperada', async () => {
    const { status, json } = await api('POST', '/rentals', {
      filmId: target.filmId,
      storeId: target.storeId,
      customerId: target.customerId,
      staffId: target.staffId,
    });
    assertEq(status, 201, 'status');
    for (const k of ['rentalId', 'inventoryId', 'paymentId', 'amount']) {
      assert(json[k] !== undefined, `la respuesta incluye ${k}`);
    }
    rentalId = json.rentalId;
    trackOpen(rentalId);
  });

  await test('el rental existe en DB y sigue ABIERTO (return_date IS NULL)', () => {
    assert(rentalId, 'se creó un rentalId');
    assert(rentalIsOpen(rentalId), 'return_date debe ser NULL');
  });

  await test('el evento se publica: el outbox se drena a 0 pending', async () => {
    await waitFor(async () => (await outboxPending()) === 0, {
      desc: 'outbox pending → 0',
    });
  });

  await test('la proyección del consumer decrementa la disponibilidad en 1', async () => {
    await waitFor(
      () => availabilityOf(target.filmId, target.storeId) === availBefore - 1,
      { desc: `available ${availBefore} → ${availBefore - 1}` },
    );
  });

  await test('el consumer registra la versión 1 del agregado (RentalStarted)', async () => {
    await waitFor(() => aggregateVersionOf(String(rentalId)) === 1, {
      desc: 'aggregate_version = 1',
    });
  });

  // ── Suite 2 · Devolución del rental ───────────────────────────────────────
  section('Suite 2 · Devolución del rental');

  await test('POST /rentals/:id/return → 200 con la forma esperada', async () => {
    const { status, json } = await api('POST', `/rentals/${rentalId}/return`);
    assertEq(status, 200, 'status');
    for (const k of ['rentalId', 'inventoryId', 'filmId', 'storeId', 'returnDate']) {
      assert(json[k] !== undefined, `la respuesta incluye ${k}`);
    }
    trackReturned(rentalId);
  });

  await test('el rental queda CERRADO en DB (return_date NOT NULL)', () => {
    assert(!rentalIsOpen(rentalId), 'return_date ya no debe ser NULL');
  });

  await test('la proyección restaura la disponibilidad (+1 → valor original)', async () => {
    await waitFor(
      () => availabilityOf(target.filmId, target.storeId) === availBefore,
      { desc: `available vuelve a ${availBefore}` },
    );
  });

  await test('el consumer avanza el agregado a la versión 2 (RentalReturned)', async () => {
    await waitFor(() => aggregateVersionOf(String(rentalId)) === 2, {
      desc: 'aggregate_version = 2',
    });
  });

  // ── Suite 3 · Reglas de negocio y manejo de errores ───────────────────────
  section('Suite 3 · Reglas de negocio y manejo de errores');

  await test('devolver un rental YA devuelto → 409 Conflict', async () => {
    const { status } = await api('POST', `/rentals/${rentalId}/return`);
    assertEq(status, 409, 'status');
  });

  await test('devolver un rental inexistente → 404 Not Found', async () => {
    const { status } = await api('POST', '/rentals/999999999/return');
    assertEq(status, 404, 'status');
  });

  await test('payload inválido (customerId = 0) → 400 Bad Request', async () => {
    const { status } = await api('POST', '/rentals', {
      filmId: target.filmId,
      storeId: target.storeId,
      customerId: 0,
      staffId: target.staffId,
    });
    assertEq(status, 400, 'status');
  });

  await test('payload inválido (filmId negativo) → 400 Bad Request', async () => {
    const { status } = await api('POST', '/rentals', {
      filmId: -1,
      storeId: target.storeId,
      customerId: target.customerId,
      staffId: target.staffId,
    });
    assertEq(status, 400, 'status');
  });

  // ── Suite 4 · Idempotencia (directo contra el consumer) ───────────────────
  // Enviamos DOS veces el mismo evento (mismo eventId). El consumer usa
  // `processed_events` con INSERT ... ON CONFLICT DO NOTHING, así que el efecto
  // debe aplicarse UNA sola vez. Usamos un agregado sintético y un film/store
  // que NO existe en la proyección → no ensuciamos datos reales.
  section('Suite 4 · Idempotencia (procesar-exactamente-una-vez)');
  if (!consumerUp) {
    skip('mismo eventId dos veces se procesa una sola vez', 'consumer no accesible por HTTP');
    skip('el agregado sintético queda en la versión enviada', 'consumer no accesible por HTTP');
  } else {
    const dupEventId = randomUUID();
    const dupAgg = `test-idem-${Date.now()}`;
    const dupEvent = {
      eventId: dupEventId,
      eventType: 'RentalStarted',
      aggregateId: dupAgg,
      payload: { filmId: 999999, storeId: 999999, version: 1 },
    };

    await test('mismo eventId enviado dos veces → 1 sola fila en processed_events', async () => {
      const first = await http(CONSUMER_URL, 'POST', '/events', dupEvent);
      const second = await http(CONSUMER_URL, 'POST', '/events', dupEvent);
      assert(first.status < 400, `1er envío ok (status ${first.status})`);
      assert(second.status < 400, `2do envío ok (status ${second.status})`);
      const count = Number(
        sqlScalar(
          `SELECT count(*) FROM consumer.processed_events WHERE event_id = '${dupEventId}'`,
        ),
      );
      assertEq(count, 1, 'processed_events debe tener exactamente 1 fila');
    });

    await test('el agregado sintético queda en la versión enviada (v1)', () => {
      assertEq(aggregateVersionOf(dupAgg), 1, 'aggregate_version');
    });
  }

  // ── Suite 5 · Guard de orden (eventos fuera de secuencia) ──────────────────
  // Aplicamos v5 y luego intentamos aplicar v3 (más viejo). El consumer descarta
  // lo viejo-o-igual, así que la versión final debe quedar en 5.
  section('Suite 5 · Orden por versión (descarta eventos viejos)');
  if (!consumerUp) {
    skip('un evento con versión menor se descarta', 'consumer no accesible por HTTP');
  } else {
    const ordAgg = `test-order-${Date.now()}`;
    await test('tras aplicar v5, un evento v3 no retrocede la versión', async () => {
      await http(CONSUMER_URL, 'POST', '/events', {
        eventId: randomUUID(),
        eventType: 'RentalStarted',
        aggregateId: ordAgg,
        payload: { filmId: 999998, storeId: 999998, version: 5 },
      });
      await http(CONSUMER_URL, 'POST', '/events', {
        eventId: randomUUID(),
        eventType: 'RentalStarted',
        aggregateId: ordAgg,
        payload: { filmId: 999998, storeId: 999998, version: 3 },
      });
      assertEq(aggregateVersionOf(ordAgg), 5, 'la versión debe permanecer en 5');
    });
  }

  // ── Suite 6 · Concurrencia: sin doble-reserva del mismo ejemplar ──────────
  // Disparamos (k+2) POST en paralelo sobre un film/store con k ejemplares
  // libres. El lock pesimista (FOR UPDATE SKIP LOCKED) debe garantizar:
  //   • exactamente k éxitos (201), cada uno con un inventory_id DISTINTO,
  //   • los 2 sobrantes fallan con 409 (no hay ejemplares disponibles),
  //   • en DB ningún inventory queda con más de 1 rental abierto.
  section('Suite 6 · Concurrencia (lock pesimista, sin doble-booking)');
  const raceTarget = pickTarget(2);
  if (!raceTarget) {
    skip('N pedidos concurrentes no doble-reservan un ejemplar', 'no hay film/store con ≥2 libres');
  } else {
    const k = raceTarget.free;
    const n = k + 2;
    console.log(
      dim(
        `      target → film=${raceTarget.filmId} store=${raceTarget.storeId} ` +
          `libres=${k}, disparando ${n} POST concurrentes`,
      ),
    );

    const body = {
      filmId: raceTarget.filmId,
      storeId: raceTarget.storeId,
      customerId: raceTarget.customerId,
      staffId: raceTarget.staffId,
    };
    const results = await Promise.all(
      Array.from({ length: n }, () => api('POST', '/rentals', body)),
    );
    const winners = results.filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status !== 201);
    winners.forEach((w) => trackOpen(w.json.rentalId));

    await test(`exactamente ${k} pedidos ganan (201) y el resto falla`, () => {
      assertEq(winners.length, k, 'cantidad de éxitos');
      assertEq(losers.length, n - k, 'cantidad de fallos');
    });

    await test('cada ganador tomó un inventory_id DISTINTO (no hubo doble-booking)', () => {
      const ids = winners.map((w) => w.json.inventoryId);
      const distinct = new Set(ids);
      assertEq(distinct.size, ids.length, `inventory_ids distintos [${ids.join(', ')}]`);
    });

    await test('los pedidos perdedores responden 409 (sin stock)', () => {
      assert(
        losers.every((r) => r.status === 409),
        `todos 409, obtenidos [${losers.map((r) => r.status).join(', ')}]`,
      );
    });

    await test('en DB ningún ejemplar quedó con >1 rental abierto', () => {
      const bad = sql(`
        SELECT r.inventory_id, count(*)
        FROM rental r
        JOIN inventory i USING (inventory_id)
        WHERE r.return_date IS NULL
          AND i.film_id = ${raceTarget.filmId}
          AND i.store_id = ${raceTarget.storeId}
        GROUP BY r.inventory_id
        HAVING count(*) > 1
      `);
      assertEq(bad.length, 0, 'inventarios doble-reservados');
    });
  }

  // ── Limpieza: devolver los rentals que abrimos (deja la DB reutilizable) ──
  section('Limpieza');
  if (openedRentals.size === 0) {
    console.log(dim('  Nada que limpiar.'));
  } else {
    let cleaned = 0;
    for (const id of openedRentals) {
      const { status } = await api('POST', `/rentals/${id}/return`);
      if (status === 200) cleaned++;
    }
    console.log(dim(`  Devueltos ${cleaned}/${openedRentals.size} rentals abiertos por la suite.`));
  }

  // ── Resumen final ─────────────────────────────────────────────────────────
  console.log(bold('\n══════════════════════════════════════════════════════'));
  const line = `  ${green(`${passed} passed`)}  ·  ${failed ? red(`${failed} failed`) : dim('0 failed')}  ·  ${yellow(`${skipped} skipped`)}`;
  console.log(line);
  if (failures.length) {
    console.log(red('\n  Fallos:'));
    for (const f of failures) console.log(red(`   ✖ ${f.name}\n       ${f.message}`));
  }
  console.log(bold('══════════════════════════════════════════════════════\n'));

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(red(`\n💥 Error inesperado en el runner: ${err.stack ?? err.message}`));
  process.exit(1);
});
