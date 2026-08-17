-- =====================================================================
-- Extender la tabla `payment` particionada con rangos que cubran el
-- presente/futuro. En Pagila upstream solo vienen 2022-01..2022-07,
-- por lo que cualquier INSERT con payment_date != 2022 falla con:
--   ERROR: no partition of relation "payment" found for row
--
-- Este script agrega:
--   * Particiones mensuales para 2026 (payment_p2026_01 .. payment_p2026_12).
--   * Una partición DEFAULT como red de seguridad para fechas fuera de rango.
--   * Si existe una partición anual previa `payment_p2026`, se descarta antes
--     de crear las mensuales (una partición anual y mensuales del mismo año
--     no pueden coexistir: sus rangos se solapan).
--
-- Es idempotente (chequea existencia antes de crear).
--
-- =====================================================================

-- Si existe la partición anual previa payment_p2026 (creada por versiones
-- anteriores de este script), descartarla para dar lugar a las mensuales.
-- Cualquier fila que hubiera en payment_p2026 se pierde. En este demo
-- la tabla arranca vacía para 2026, así que no hay datos a preservar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payment_p2026'
  ) THEN
    EXECUTE 'DROP TABLE public.payment_p2026';
    RAISE NOTICE 'Dropped previous yearly partition payment_p2026';
  END IF;
END $$;

-- Particiones mensuales de 2026.
DO $$
DECLARE
  m INT;
  part_name TEXT;
  from_ts   TIMESTAMPTZ;
  to_ts     TIMESTAMPTZ;
BEGIN
  FOR m IN 1..12 LOOP
    part_name := format('payment_p2026_%s', lpad(m::text, 2, '0'));
    from_ts   := make_timestamptz(2026, m, 1, 0, 0, 0, 'UTC');
    IF m = 12 THEN
      to_ts := make_timestamptz(2027, 1, 1, 0, 0, 0, 'UTC');
    ELSE
      to_ts := make_timestamptz(2026, m + 1, 1, 0, 0, 0, 'UTC');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.payment
           FOR VALUES FROM (%L) TO (%L)',
        part_name, from_ts, to_ts
      );
      RAISE NOTICE 'Created partition %', part_name;
    ELSE
      RAISE NOTICE 'Partition % already exists, skipped', part_name;
    END IF;
  END LOOP;
END $$;

-- Red de seguridad: cualquier fecha fuera de los rangos definidos cae acá.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payment_default'
  ) THEN
    EXECUTE 'CREATE TABLE public.payment_default PARTITION OF public.payment DEFAULT';
    RAISE NOTICE 'Created DEFAULT partition payment_default';
  ELSE
    RAISE NOTICE 'DEFAULT partition already exists, skipped';
  END IF;
END $$;

-- Listado final de particiones (chequeo visual).
SELECT
  inhrelid::regclass::text AS part_name,
  pg_get_expr(c.relpartbound, c.oid) AS bounds
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
WHERE inhparent = 'public.payment'::regclass
ORDER BY 1;
