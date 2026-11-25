-- Run after schema.sql on Supabase. Configure the role's login separately.
DO $role$
BEGIN
  IF to_regrole('leavemate_runtime') IS NULL THEN
    CREATE ROLE leavemate_runtime NOLOGIN;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA leavemate TO leavemate_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON leavemate.items TO leavemate_runtime;
GRANT SELECT, INSERT, UPDATE ON
  leavemate.verification_sessions, leavemate.alerts, leavemate.notifications, leavemate.device_status
  TO leavemate_runtime;
GRANT SELECT, INSERT ON leavemate.verification_results TO leavemate_runtime;
GRANT SELECT, UPDATE ON leavemate.application_settings TO leavemate_runtime;

DO $policies$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'items', 'verification_sessions', 'verification_results', 'alerts',
    'notifications', 'device_status', 'application_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE leavemate.%I ENABLE ROW LEVEL SECURITY', app_table);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'leavemate'
        AND tablename = app_table
        AND policyname = 'backend_runtime'
    ) THEN
      EXECUTE format(
        'CREATE POLICY backend_runtime ON leavemate.%I TO leavemate_runtime USING (true) WITH CHECK (true)',
        app_table
      );
    END IF;
  END LOOP;
END
$policies$;
