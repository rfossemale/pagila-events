#!/usr/bin/env node
/**
 * Race-condition tester para POST /rentals.
 *
 * Dispara N POST casi simultáneos con Promise.all apuntando al mismo
 * film/store, y reporta cuántos "ganaron" (201) y cuántos fallaron.
 * Con la versión naive del servicio (sin FOR UPDATE), esperás >1 éxitos
 * cuando solo hay 1 ejemplar disponible → doble alquiler del mismo inventory.
 *
 * Uso:
 *   node scripts/race-rental.mjs \
 *     --film 1 --store 1 --customer 1 --staff 1 [--n 2] [--url http://localhost:3000/api/rentals]
 *
 * Variables de entorno equivalentes: FILM_ID, STORE_ID, CUSTOMER_ID, STAFF_ID, N, URL
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const filmId     = Number(args.film     ?? process.env.FILM_ID     ?? 1);
const storeId    = Number(args.store    ?? process.env.STORE_ID    ?? 1);
const customerId = Number(args.customer ?? process.env.CUSTOMER_ID ?? 1);
const staffId    = Number(args.staff    ?? process.env.STAFF_ID    ?? 1);
const n          = Number(args.n        ?? process.env.N           ?? 2);
const url        = args.url ?? process.env.URL ?? 'http://localhost:3000/api/rentals';

const body = JSON.stringify({ filmId, storeId, customerId, staffId });

console.log(`▶ Disparando ${n} POST concurrentes a ${url}`);
console.log(`  body: ${body}\n`);

const started = Date.now();

const results = await Promise.all(
  Array.from({ length: n }, async (_, i) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = text; }
      return { i, status: res.status, ms: Date.now() - t0, body: json };
    } catch (err) {
      return { i, status: 'ERR', ms: Date.now() - t0, body: String(err) };
    }
  }),
);

const totalMs = Date.now() - started;

for (const r of results) {
  const tag = r.status === 201 ? '✅' : r.status === 409 ? '⛔' : '❌';
  console.log(`${tag} req#${r.i}  status=${r.status}  ${r.ms}ms`);
  console.log(`    ${typeof r.body === 'string' ? r.body : JSON.stringify(r.body)}`);
}

const winners = results.filter((r) => r.status === 201);
const inventories = winners.map((r) => r.body?.inventoryId).filter((v) => v != null);
const distinct = new Set(inventories);

console.log(`\n─── Resumen (${totalMs}ms totales) ───`);
console.log(`  éxitos (201): ${winners.length}/${n}`);
console.log(`  inventory_id devueltos: [${inventories.join(', ')}]`);
console.log(`  inventory_id distintos: ${distinct.size}`);

if (winners.length > 1 && distinct.size < winners.length) {
  console.log(
    `\n🔥 RACE CONDITION: ${winners.length} rentals crearon apuntando al mismo inventory_id.`,
  );
  process.exit(2);
} else if (winners.length > 1) {
  console.log(
    `\nℹ️  ${winners.length} éxitos, pero cada uno tomó un inventory distinto → había stock. ` +
    `Repetí en un film/store con 1 sola copia disponible.`,
  );
} else {
  console.log(`\n✔ Sin colisión detectada en esta corrida.`);
}
