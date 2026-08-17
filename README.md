# Pagila Events

Sistema de ejemplo **event-driven** construido sobre la base de datos de muestra **Pagila** (el clásico "DVD rental store"). Modela el alquiler y la devolución de ejemplares de películas y propaga esos cambios de forma **confiable y asíncrona** hacia un servicio de lectura, aplicando patrones de sistemas distribuidos de nivel producción.

El repositorio es un **monorepo** con dos servicios NestJS (`producer` y `consumer`) que comparten una base PostgreSQL y un broker Redis, orquestados con Docker Compose.

> 🇬🇧 English version: [README.en.md](README.en.md)

---

## ¿Qué demuestra este proyecto?

El objetivo es mostrar, con código real y ejecutable, cómo se resuelven los problemas difíciles de un sistema orientado a eventos:

| Concepto | Dónde vive | Qué resuelve |
| --- | --- | --- |
| **Transactional Outbox** | `producer` + `db/init/05-outbox.sql` | Publicar eventos sin perder la atomicidad con la escritura de negocio (evita dual-write). |
| **LISTEN/NOTIFY** | `db/init/07-listen-notify-trigger.sql` + `outbox-relay.service.ts` | Despachar el outbox en *tiempo casi real* sin polling agresivo (con timer de respaldo). |
| **Cola de trabajo (BullMQ/Redis)** | `producer/queues` → `consumer/queues` | Desacoplar productor y consumidor, con reintentos y backoff exponencial. |
| **Idempotencia** | `consumer/processed_events` | Procesar cada evento *exactamente una vez* aunque llegue duplicado (INSERT ... ON CONFLICT). |
| **Ordenamiento por versión** | `consumer/aggregate_version` | Descartar eventos viejos/fuera de orden por agregado. |
| **Proyección de lectura** | `consumer/inventory_availability` | Materializar una vista de disponibilidad de stock (CQRS-lite). |
| **Saga orquestada + compensación** | `producer/saga` + `consumer/saga` | Transacciones distribuidas con pasos locales/remotos y rollback por compensación. |
| **Condición de carrera + lock pesimista** | `scripts/` + `rental.service.ts` | Demostrar y prevenir doble-alquiler del mismo ejemplar bajo concurrencia. |
| **Escalado horizontal** | `docker-compose.yml` + `nginx/` | Balanceo round-robin de N réplicas del `producer` detrás de Nginx. |
| **Observabilidad** | `monitoring/` + `/metrics` en cada servicio | Métricas Prometheus (HTTP, outbox, eventos) y dashboards en Grafana. |

---

## Arquitectura

```mermaid
flowchart LR
    client([Cliente HTTP]) --> nginx[Nginx<br/>load balancer]
    nginx --> p1[Producer #1]
    nginx --> p2[Producer #N]

    subgraph producer[Producer · NestJS]
      p1 --- relay[Outbox Relay<br/>LISTEN/NOTIFY]
    end

    p1 -- "escritura de negocio + outbox<br/>(misma transacción)" --> pg[(PostgreSQL<br/>Pagila)]
    pg -- "NOTIFY outbox_new" --> relay
    relay -- "publica evento" --> redis[(Redis · BullMQ)]
    redis --> worker[Consumer · Worker]

    subgraph consumer[Consumer · NestJS]
      worker --> proc[Event Processor<br/>idempotente + ordenado]
    end

    proc -- "proyección de lectura" --> pg
```

**Flujo de un alquiler (happy path):**

1. El cliente hace `POST /api/rentals` contra Nginx, que balancea hacia una réplica del `producer`.
2. El `producer` crea el `rental` + `payment` **y** escribe un evento en la tabla `outbox`, todo en **una sola transacción**.
3. Un trigger dispara `NOTIFY outbox_new`; el **Outbox Relay** despierta, lee las filas `pending` con `FOR UPDATE SKIP LOCKED` y las publica en la cola BullMQ (con `jobId` = id del evento → dedup en el broker).
4. El `consumer` toma el job, registra el evento en `processed_events` (idempotencia), valida la versión del agregado (orden) y actualiza la proyección `inventory_availability`.

---

## Stack

- **Node.js / TypeScript** con **NestJS 11**
- **PostgreSQL 16** (dataset Pagila) + **TypeORM** y `pg` crudo para LISTEN/NOTIFY
- **Redis 7** + **BullMQ** (colas, reintentos, backoff) con **Bull Board** para inspección
- **Nginx** como load balancer de réplicas
- **Docker Compose** para orquestar todo

---

## Estructura del repositorio

```
pagila-events/
├── docker-compose.yml      # Orquesta postgres, redis, producer(xN), nginx, consumer
├── db/init/                # Migraciones/seed que corren al inicializar Postgres
│   ├── 01-schema.sql       # Esquema Pagila
│   ├── 02-data.sql         # Datos de muestra
│   ├── 05-outbox.sql       # Tabla outbox
│   ├── 07-listen-notify-trigger.sql  # Trigger NOTIFY outbox_new
│   ├── 06-consumer.sql     # Esquema del consumer (idempotencia + proyección)
│   └── 10-saga-tabe.sql    # Tabla de instancias de saga
├── nginx/producer.conf     # Load balancer round-robin
├── monitoring/             # Prometheus (scrape) + Grafana (datasource + dashboard)
├── producer/               # Servicio de escritura (API + outbox + saga + /metrics)
├── consumer/               # Servicio de lectura (worker + proyección + saga + /metrics)
└── scripts/                # Batería de tests + reproductor de la condición de carrera
```

`producer` y `consumer` fueron integrados al monorepo con `git subtree`, por lo que su **historial de commits individual está preservado** dentro de este repo.

---

## Puesta en marcha

### Requisitos

- Docker y Docker Compose
- (Opcional, para correr fuera de Docker) Node.js ≥ 18 y `psql`

### Opción A — Todo con Docker (recomendado)

```bash
docker compose up -d --build
```

Esto levanta:

| Servicio | Puerto host | Descripción |
| --- | --- | --- |
| Nginx → Producer | `3000` | API pública (balanceada) |
| Consumer | `3101` | Servicio de lectura |
| PostgreSQL | `5433` | Base Pagila (se inicializa sola con `db/init`) |
| Redis | `6379` | Broker BullMQ |
| Prometheus | `9090` | Recolección de métricas |
| Grafana | `3002` | Dashboards (también en `/grafana`) |

Para **escalar** el producer y ver el balanceo de Nginx en acción:

```bash
docker compose up -d --scale producer=3
```

- API: `http://localhost:3000/api`
- Bull Board (monitor de colas): `http://localhost:3000/admin/queues`

### Opción B — Servicios en local, infra en Docker

```bash
# 1. Solo infraestructura
docker compose up -d postgres redis

# 2. Producer
cd producer && npm install && npm run start:dev   # http://localhost:3000

# 3. Consumer (otra terminal)
cd consumer && npm install && npm run start:dev    # http://localhost:3001
```

Variables de entorno relevantes (con defaults para local): `DB_HOST`, `DB_PORT` (`5433`), `DB_USER`/`DB_PASSWORD`/`DB_NAME` (`pagila`), `REDIS_HOST`, `REDIS_PORT`, `PORT`.

---

## Endpoints principales (producer)

Todos bajo el prefijo global `/api`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/rentals` | Alquila un ejemplar disponible de un film en un store. |
| `POST` | `/api/rentals/:rentalId/return` | Registra la devolución de un alquiler. |

Ejemplo:

```bash
curl -X POST http://localhost:3000/api/rentals \
  -H 'Content-Type: application/json' \
  -d '{"filmId":1,"storeId":1,"customerId":1,"staffId":1}'
```

---

## Monitoreo (Prometheus + Grafana)

El stack incluye observabilidad completa. Ambos servicios NestJS exponen
métricas en formato Prometheus, y dos *exporters* aportan métricas de
infraestructura:

| Fuente | Endpoint | Qué expone |
| --- | --- | --- |
| Producer | `GET /api/metrics` | HTTP (rate/latencia), backlog del outbox (`outbox_pending_total`, `outbox_failed_total`, `outbox_oldest_pending_seconds`) y métricas de Node. |
| Consumer | `GET /metrics` | HTTP, eventos procesados por resultado (`consumer_events_total{result}`) y métricas de Node. |
| postgres-exporter | `:9187/metrics` | Conexiones, locks, tamaño de la base. |
| redis-exporter | `:9121/metrics` | Memoria, clientes, comandos, keyspace. |

**Prometheus** ([`monitoring/prometheus/prometheus.yml`](monitoring/prometheus/prometheus.yml)) scrapea los cuatro cada 15s (el producer vía DNS discovery, así descubre todas las réplicas al escalar).

**Grafana** provisiona solo el datasource y un dashboard de overview (throughput HTTP, latencia p95, backlog del outbox, eventos/s del consumer y salud de Postgres/Redis).

### 👉 Ver el dashboard

- A través de Nginx (mismo host que la API): **http://localhost:3000/grafana** → dashboard *Pagila Events · Overview*.
- O directo: **http://localhost:3002** (login `admin` / `admin`; el acceso de sólo-lectura es anónimo).

---

## Demo: condición de carrera y lock pesimista

El directorio [`scripts/`](scripts/README.md) permite **reproducir** el doble-alquiler del último ejemplar bajo concurrencia y verificar cómo el lock pesimista (`FOR UPDATE SKIP LOCKED`) lo previene.

```bash
# 1. Elegir un film/store con 1 sola copia disponible
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-setup.sql

# 2. Disparar N requests concurrentes
node scripts/race-rental.mjs --film 1 --store 1 --customer 1 --staff 1 --n 2

# 3. Verificar en la BD si hubo colisión
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-verify.sql
```

Ver [scripts/README.md](scripts/README.md) para el detalle.

---

## Tests

### Batería de integración end-to-end

[`scripts/test-suite.mjs`](scripts/test-suite.mjs) es un runner autónomo que dispara **pedidos HTTP reales** contra el sistema levantado y verifica los efectos en la base: alta y devolución de rentals, drenado del outbox, proyección del consumer, idempotencia, orden por versión y concurrencia sin doble-booking.

```bash
docker compose up -d --build   # el stack debe estar corriendo
node scripts/test-suite.mjs    # 21 passed · 0 failed
```

Ver [scripts/README.md](scripts/README.md) para el detalle de cada suite.

### Unitarios / e2e por servicio

Cada servicio trae su suite de Jest:

```bash
cd producer && npm run test        # unitarios
cd producer && npm run test:e2e    # end-to-end
```

(idéntico en `consumer/`).
