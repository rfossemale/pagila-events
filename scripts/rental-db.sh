#!/usr/bin/env bash
# =====================================================================
#  🎬  rental-db.sh — operar sobre la tabla `rental` SIN entrar al contenedor
# =====================================================================
#
#  La base Postgres está publicada en el host (puerto 5433), así que no hace
#  falta `docker exec ... psql`: este wrapper corre las sentencias directo
#  desde la consola usando el `psql` local.
#
#  Uso:
#    scripts/rental-db.sh <comando> [args]
#
#  Comandos:
#    status [film] [store]     Muestra disponibilidad y rentals abiertos de un
#                              film/store (default: 1 1).
#    free   [film] [store]     Cierra (return_date = now()) TODOS los rentals
#                              abiertos de ese film/store → libera las copias
#                              para volver a correr la demo de race condition.
#    close  <rentalId>         Cierra un rental puntual (lo marca devuelto).
#    reopen <rentalId>         Reabre un rental (return_date = NULL). Útil para
#                              re-crear el escenario de la carrera.
#    sql    "<QUERY>"          Ejecuta una sentencia SQL arbitraria.
#
#  Config:
#    DATABASE_URL   (default: postgresql://pagila:pagila@localhost:5433/pagila)
#
#  Nota: estas escrituras van directo a la tabla `rental` y NO emiten eventos,
#  así que la proyección `consumer.inventory_availability` no se entera. Es lo
#  esperado para "resetear" el estado de la demo a mano.
# =====================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://pagila:pagila@localhost:5433/pagila}"

# psql debe estar en el PATH del host.
if ! command -v psql >/dev/null 2>&1; then
  echo "✖ No se encontró 'psql' en el PATH. Instalá el cliente de PostgreSQL." >&2
  exit 1
fi

# Ejecuta SQL contra la BD del host.
run_sql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$1"
}

cmd="${1:-status}"

case "$cmd" in
  status)
    film="${2:-1}"
    store="${3:-1}"
    echo "=== Disponibilidad e inventarios de film=$film store=$store ==="
    run_sql "
      SELECT
        i.inventory_id,
        (SELECT COUNT(*) FROM rental r
           WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL) AS open_rentals,
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM rental r
          WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
        ) THEN 'AVAILABLE' ELSE 'RENTED' END AS status
      FROM inventory i
      WHERE i.film_id = $film AND i.store_id = $store
      ORDER BY i.inventory_id;
    "
    ;;

  free)
    film="${2:-1}"
    store="${3:-1}"
    echo "=== Cerrando rentals abiertos de film=$film store=$store ==="
    run_sql "
      UPDATE rental r
         SET return_date = now(), last_update = now()
        FROM inventory i
       WHERE r.inventory_id = i.inventory_id
         AND i.film_id = $film AND i.store_id = $store
         AND r.return_date IS NULL;
    "
    echo "✔ Copias liberadas."
    ;;

  close)
    rental_id="${2:?Falta el rentalId: scripts/rental-db.sh close <rentalId>}"
    echo "=== Cerrando rental $rental_id ==="
    run_sql "
      UPDATE rental
         SET return_date = now(), last_update = now()
       WHERE rental_id = $rental_id AND return_date IS NULL;
    "
    ;;

  reopen)
    rental_id="${2:?Falta el rentalId: scripts/rental-db.sh reopen <rentalId>}"
    echo "=== Reabriendo rental $rental_id ==="
    run_sql "
      UPDATE rental
         SET return_date = NULL, last_update = now()
       WHERE rental_id = $rental_id;
    "
    ;;

  sql)
    query="${2:?Falta la query: scripts/rental-db.sh sql \"<QUERY>\"}"
    run_sql "$query"
    ;;

  *)
    echo "Comando desconocido: $cmd" >&2
    echo "Usá: status | free | close | reopen | sql   (ver cabecera del script)" >&2
    exit 1
    ;;
esac
