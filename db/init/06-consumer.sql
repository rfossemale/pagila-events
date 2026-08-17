-- db/init/05-consumer.sql
CREATE SCHEMA IF NOT EXISTS consumer;

CREATE TABLE consumer.inventory_availability (
  film_id   INT NOT NULL,
  store_id  INT NOT NULL,
  available INT NOT NULL DEFAULT 0,
  PRIMARY KEY (film_id, store_id)
);

-- insert initial values for inventory availability based on current inventory

INSERT INTO consumer.inventory_availability (film_id, store_id, available)
SELECT i.film_id, i.store_id, count(*)
FROM inventory i
GROUP BY i.film_id, i.store_id;

CREATE TABLE consumer.processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consumer.aggregate_version (
  aggregate_id TEXT PRIMARY KEY,
  version      INT NOT NULL
);
