# Pagila Events

An **event-driven** sample system built on top of the **Pagila** sample database (the classic "DVD rental store"). It models renting and returning film copies and propagates those changes **reliably and asynchronously** to a read service, applying production-grade distributed-systems patterns.

The repository is a **monorepo** with two NestJS services (`producer` and `consumer`) that share a PostgreSQL database and a Redis broker, orchestrated with Docker Compose.

> 🇪🇸 Versión en español: [README.md](README.md)

---

## What does this project demonstrate?

The goal is to show, with real runnable code, how the hard problems of an event-oriented system are solved:

| Concept | Where it lives | What it solves |
| --- | --- | --- |
| **Transactional Outbox** | `producer` + `db/init/05-outbox.sql` | Publish events without losing atomicity with the business write (avoids dual-write). |
| **LISTEN/NOTIFY** | `db/init/07-listen-notify-trigger.sql` + `outbox-relay.service.ts` | Dispatch the outbox in *near real-time* without aggressive polling (with a fallback timer). |
| **Work queue (BullMQ/Redis)** | `producer/queues` → `consumer/queues` | Decouple producer and consumer, with retries and exponential backoff. |
| **Idempotency** | `consumer/processed_events` | Process each event *exactly once* even if it arrives duplicated (INSERT ... ON CONFLICT). |
| **Version ordering** | `consumer/aggregate_version` | Discard old/out-of-order events per aggregate. |
| **Read projection** | `consumer/inventory_availability` | Materialize a stock-availability view (CQRS-lite). |
| **Orchestrated saga + compensation** | `producer/saga` + `consumer/saga` | Distributed transactions with local/remote steps and rollback via compensation. |
| **Race condition + pessimistic lock** | `scripts/` + `rental.service.ts` | Demonstrate and prevent double-renting the same copy under concurrency. |
| **Horizontal scaling** | `docker-compose.yml` + `nginx/` | Round-robin balancing of N `producer` replicas behind Nginx. |
| **Observability** | `monitoring/` + `/metrics` on each service | Prometheus metrics (HTTP, outbox, events) and Grafana dashboards. |

---

## Architecture

```mermaid
flowchart LR
    client([HTTP client]) --> nginx[Nginx<br/>load balancer]
    nginx --> p1[Producer #1]
    nginx --> p2[Producer #N]

    subgraph producer[Producer · NestJS]
      p1 --- relay[Outbox Relay<br/>LISTEN/NOTIFY]
    end

    p1 -- "business write + outbox<br/>(same transaction)" --> pg[(PostgreSQL<br/>Pagila)]
    pg -- "NOTIFY outbox_new" --> relay
    relay -- "publish event" --> redis[(Redis · BullMQ)]
    redis --> worker[Consumer · Worker]

    subgraph consumer[Consumer · NestJS]
      worker --> proc[Event Processor<br/>idempotent + ordered]
    end

    proc -- "read projection" --> pg
```

**Rental flow (happy path):**

1. The client sends `POST /api/rentals` to Nginx, which balances to a `producer` replica.
2. The `producer` creates the `rental` + `payment` **and** writes an event to the `outbox` table, all in **a single transaction**.
3. A trigger fires `NOTIFY outbox_new`; the **Outbox Relay** wakes up, reads the `pending` rows with `FOR UPDATE SKIP LOCKED` and publishes them to the BullMQ queue (with `jobId` = event id → dedup at the broker).
4. The `consumer` picks up the job, records the event in `processed_events` (idempotency), validates the aggregate version (ordering) and updates the `inventory_availability` projection.

---

## Stack

- **Node.js / TypeScript** with **NestJS 11**
- **PostgreSQL 16** (Pagila dataset) + **TypeORM** and raw `pg` for LISTEN/NOTIFY
- **Redis 7** + **BullMQ** (queues, retries, backoff) with **Bull Board** for inspection
- **Nginx** as a replica load balancer
- **Docker Compose** to orchestrate everything

---

## Repository structure

```
pagila-events/
├── docker-compose.yml      # Orchestrates postgres, redis, producer(xN), nginx, consumer
├── db/init/                # Migrations/seed that run when Postgres initializes
│   ├── 01-schema.sql       # Pagila schema
│   ├── 02-data.sql         # Sample data
│   ├── 05-outbox.sql       # Outbox table
│   ├── 07-listen-notify-trigger.sql  # NOTIFY outbox_new trigger
│   ├── 06-consumer.sql     # Consumer schema (idempotency + projection)
│   └── 10-saga-tabe.sql    # Saga instances table
├── nginx/producer.conf     # Round-robin load balancer
├── monitoring/             # Prometheus (scrape) + Grafana (datasource + dashboard)
├── producer/               # Write service (API + outbox + saga + /metrics)
├── consumer/               # Read service (worker + projection + saga + /metrics)
└── scripts/                # Test suite + race-condition reproducer
```

`producer` and `consumer` were integrated into the monorepo with `git subtree`, so their **individual commit history is preserved** within this repo.

---

## Getting started

### Requirements

- Docker and Docker Compose
- (Optional, to run outside Docker) Node.js ≥ 18 and `psql`

### Option A — All with Docker (recommended)

```bash
docker compose up -d --build
```

This brings up:

| Service | Host port | Description |
| --- | --- | --- |
| Nginx → Producer | `3000` | Public API (load-balanced) |
| Consumer | `3101` | Read service |
| PostgreSQL | `5433` | Pagila database (self-initializes via `db/init`) |
| Redis | `6379` | BullMQ broker |
| Prometheus | `9090` | Metrics collection |
| Grafana | `3002` | Dashboards (also at `/grafana`) |

To **scale** the producer and see Nginx balancing in action:

```bash
docker compose up -d --scale producer=3
```

- API: `http://localhost:3000/api`
- Bull Board (queue monitor): `http://localhost:3000/admin/queues`

### Option B — Services locally, infra in Docker

```bash
# 1. Infrastructure only
docker compose up -d postgres redis

# 2. Producer
cd producer && npm install && npm run start:dev   # http://localhost:3000

# 3. Consumer (another terminal)
cd consumer && npm install && npm run start:dev    # http://localhost:3001
```

Relevant environment variables (with local defaults): `DB_HOST`, `DB_PORT` (`5433`), `DB_USER`/`DB_PASSWORD`/`DB_NAME` (`pagila`), `REDIS_HOST`, `REDIS_PORT`, `PORT`.

---

## Main endpoints (producer)

All under the global `/api` prefix.

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/rentals` | Rents an available copy of a film at a store. |
| `POST` | `/api/rentals/:rentalId/return` | Registers the return of a rental. |

Example:

```bash
curl -X POST http://localhost:3000/api/rentals \
  -H 'Content-Type: application/json' \
  -d '{"filmId":1,"storeId":1,"customerId":1,"staffId":1}'
```

---

## Monitoring (Prometheus + Grafana)

The stack ships with full observability. Both NestJS services expose Prometheus
metrics, and two exporters add infrastructure metrics:

| Source | Endpoint | What it exposes |
| --- | --- | --- |
| Producer | `GET /api/metrics` | HTTP (rate/latency), outbox backlog (`outbox_pending_total`, `outbox_failed_total`, `outbox_oldest_pending_seconds`) and Node metrics. |
| Consumer | `GET /metrics` | HTTP, events processed by result (`consumer_events_total{result}`) and Node metrics. |
| postgres-exporter | `:9187/metrics` | Connections, locks, database size. |
| redis-exporter | `:9121/metrics` | Memory, clients, commands, keyspace. |

**Prometheus** ([`monitoring/prometheus/prometheus.yml`](monitoring/prometheus/prometheus.yml)) scrapes all four every 15s (the producer via DNS discovery, so it finds every replica when scaling).

**Grafana** auto-provisions the datasource and an overview dashboard (HTTP throughput, p95 latency, outbox backlog, consumer events/s and Postgres/Redis health).

### 👉 View the dashboard

- Through Nginx (same host as the API): **http://localhost:3000/grafana** → *Pagila Events · Overview* dashboard.
- Or directly: **http://localhost:3002** (login `admin` / `admin`; read-only access is anonymous).

---

## Demo: race condition and pessimistic lock

The [`scripts/`](scripts/README.md) directory lets you **reproduce** double-renting the last copy under concurrency and verify how the pessimistic lock (`FOR UPDATE SKIP LOCKED`) prevents it.

```bash
# 1. Pick a film/store with a single available copy
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-setup.sql

# 2. Fire N concurrent requests
node scripts/race-rental.mjs --film 1 --store 1 --customer 1 --staff 1 --n 2

# 3. Check in the DB whether a collision happened
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-verify.sql
```

See [scripts/README.md](scripts/README.md) for details.

---

## Tests

### End-to-end integration suite

[`scripts/test-suite.mjs`](scripts/test-suite.mjs) is a standalone runner that fires **real HTTP requests** against the running system and verifies the effects in the database: rental creation and return, outbox draining, consumer projection, idempotency, version ordering and concurrency without double-booking.

```bash
docker compose up -d --build   # the stack must be running
node scripts/test-suite.mjs    # 21 passed · 0 failed
```

See [scripts/README.md](scripts/README.md) for the detail of each suite.

### Per-service unit / e2e

Each service ships its own Jest suite:

```bash
cd producer && npm run test        # unit
cd producer && npm run test:e2e    # end-to-end
```

(same in `consumer/`).
