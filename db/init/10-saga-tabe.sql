CREATE TABLE saga_instance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_type       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  current_step    INT  NOT NULL DEFAULT 0,
  payload         JSONB NOT NULL,
  completed_steps JSONB NOT NULL DEFAULT '[]',
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saga_active ON saga_instance (status)
  WHERE status IN ('running', 'compensating');