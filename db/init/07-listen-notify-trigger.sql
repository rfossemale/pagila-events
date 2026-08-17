CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  NOTIFY outbox_new;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbox_notify
  AFTER INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION notify_outbox();