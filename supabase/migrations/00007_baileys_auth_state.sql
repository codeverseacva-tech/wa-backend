CREATE TABLE baileys_auth_state (
  session_id TEXT NOT NULL,
  key_type TEXT NOT NULL,
  key_id TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, key_type, key_id)
);

-- Index for fast lookup by session_id
CREATE INDEX idx_baileys_auth_state_session ON baileys_auth_state(session_id);

-- Security: Lock down this table so only the service role can access it.
-- We enable RLS and add NO policies, meaning anon/authenticated roles 
-- have absolutely zero access.
ALTER TABLE public.baileys_auth_state ENABLE ROW LEVEL SECURITY;
