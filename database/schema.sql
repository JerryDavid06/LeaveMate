BEGIN;
CREATE SCHEMA IF NOT EXISTS leavemate;
REVOKE ALL ON SCHEMA leavemate FROM PUBLIC;

CREATE TABLE IF NOT EXISTS leavemate.items (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT '',
  image_reference text,
  image_override text,
  priority_type text NOT NULL CHECK (priority_type IN ('essential','optional')),
  detection_identifier text UNIQUE,
  monitoring_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leavemate.verification_sessions (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'DEPARTURE_DETECTED'),
  event_timestamp timestamptz NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('running','successful','incomplete','failed')),
  expected_item_count integer NOT NULL CHECK (expected_item_count >= 0),
  detected_item_count integer NOT NULL DEFAULT 0 CHECK (detected_item_count >= 0),
  missing_item_count integer NOT NULL DEFAULT 0 CHECK (missing_item_count >= 0),
  detection_source text NOT NULL CHECK (detection_source IN ('simulation','hardware')),
  device_identifier text,
  timeout_seconds integer NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 60),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (verification_status NOT IN ('successful','incomplete') OR
    (completed_at IS NOT NULL AND detected_item_count + missing_item_count = expected_item_count))
);

CREATE TABLE IF NOT EXISTS leavemate.verification_results (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES leavemate.verification_sessions(id) ON DELETE CASCADE,
  item_id uuid REFERENCES leavemate.items(id) ON DELETE SET NULL,
  original_item_id uuid NOT NULL,
  item_name text NOT NULL,
  category text NOT NULL,
  image_reference text,
  priority_type text NOT NULL CHECK (priority_type IN ('essential','optional')),
  detection_status text NOT NULL CHECK (detection_status IN ('detected','missing')),
  detected_at timestamptz,
  CHECK ((detection_status = 'detected') = (detected_at IS NOT NULL)),
  UNIQUE (session_id, original_item_id)
);

CREATE TABLE IF NOT EXISTS leavemate.alerts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE REFERENCES leavemate.verification_sessions(id) ON DELETE CASCADE,
  alert_message text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('high','normal')),
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz
);

CREATE TABLE IF NOT EXISTS leavemate.notifications (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL UNIQUE REFERENCES leavemate.alerts(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS leavemate.device_status (
  device_identifier text PRIMARY KEY,
  provider_type text NOT NULL DEFAULT 'generic',
  last_communication timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS leavemate.application_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  verification_timeout integer NOT NULL DEFAULT 5 CHECK (verification_timeout BETWEEN 1 AND 60),
  time_format text NOT NULL DEFAULT '12h' CHECK (time_format IN ('12h','24h')),
  date_format text NOT NULL DEFAULT 'short' CHECK (date_format IN ('short','iso','day-first')),
  voice_enabled boolean NOT NULL DEFAULT true,
  voice_selection text NOT NULL DEFAULT '',
  voice_rate real NOT NULL DEFAULT 1 CHECK (voice_rate BETWEEN 0.5 AND 2),
  voice_volume real NOT NULL DEFAULT 1 CHECK (voice_volume BETWEEN 0 AND 1),
  repeat_until_acknowledged boolean NOT NULL DEFAULT true,
  browser_notifications boolean NOT NULL DEFAULT false,
  simulation_mode boolean NOT NULL DEFAULT true
);

INSERT INTO leavemate.application_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS sessions_recent ON leavemate.verification_sessions (completed_at DESC);
CREATE INDEX IF NOT EXISTS results_by_item ON leavemate.verification_results (original_item_id);
CREATE INDEX IF NOT EXISTS results_live_item ON leavemate.verification_results (item_id);
CREATE INDEX IF NOT EXISTS alerts_recent ON leavemate.alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread ON leavemate.notifications (created_at DESC) WHERE NOT is_read;
COMMIT;
