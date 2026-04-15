-- Migration: Create queue-based translation system
-- Mirrors the article_generation_queue pattern (20250103_create_article_queue_system.sql)
-- so a browser click becomes a fast INSERT and a background cron worker does the slow
-- Gemini translation work one language per invocation. This is the permanent fix for
-- WORKER_RESOURCE_LIMIT (546) and IDLE_TIMEOUT (150s) errors on the interactive path.

CREATE TABLE IF NOT EXISTS translation_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  translation_id   UUID NOT NULL,
  target_language  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message    TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  result_article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  UNIQUE (translation_id, target_language)
);

-- Fast lookup by translation_id for UI realtime subscriptions
CREATE INDEX IF NOT EXISTS idx_translation_queue_translation_id
  ON translation_queue(translation_id);

-- Worker picks up pending jobs oldest-first
CREATE INDEX IF NOT EXISTS idx_translation_queue_pending
  ON translation_queue(status, created_at) WHERE status = 'pending';

-- Worker can also pick up failed jobs with retry_count < 3
CREATE INDEX IF NOT EXISTS idx_translation_queue_retry
  ON translation_queue(status, retry_count, created_at)
  WHERE status IN ('pending', 'failed') AND retry_count < 3;

COMMENT ON TABLE translation_queue IS
  'Queue for per-language article translation jobs. Each row is one (article, language) pair. Processed by process-translation-queue edge function via pg_cron.';

---------------------------------------------------------------------
-- Enqueue helper: insert one row per target language, skip duplicates
---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_translations(
  p_article_id UUID,
  p_languages  TEXT[]
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_translation_id UUID;
  v_lang TEXT;
  v_queue_id UUID;
BEGIN
  -- Resolve the translation group id from the English master article
  SELECT translation_id INTO v_translation_id
    FROM articles
   WHERE id = p_article_id;

  IF v_translation_id IS NULL THEN
    RAISE EXCEPTION 'Article % has no translation_id', p_article_id;
  END IF;

  -- Insert one pending row per language. Conflict handling: if a row already
  -- exists for (translation_id, target_language), reuse it: reset to pending
  -- when it previously failed, otherwise leave a completed job alone.
  FOREACH v_lang IN ARRAY p_languages LOOP
    INSERT INTO translation_queue (
      article_id, translation_id, target_language, status, created_at
    )
    VALUES (p_article_id, v_translation_id, v_lang, 'pending', NOW())
    ON CONFLICT (translation_id, target_language) DO UPDATE
      SET status       = CASE
                           WHEN translation_queue.status IN ('failed', 'pending') THEN 'pending'
                           ELSE translation_queue.status
                         END,
          error_message = NULL,
          started_at   = NULL,
          completed_at = NULL,
          created_at   = NOW()
    RETURNING id INTO v_queue_id;

    RETURN NEXT v_queue_id;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION enqueue_translations(UUID, TEXT[]) IS
  'Inserts or resets translation_queue rows for each (article, language) pair. Returns queue ids.';

---------------------------------------------------------------------
-- Worker helper: atomically claim the next job
---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_next_translation_job()
RETURNS TABLE (
  queue_id        UUID,
  article_id      UUID,
  translation_id  UUID,
  target_language TEXT,
  retry_count     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT q.id, q.article_id, q.translation_id, q.target_language, q.retry_count
    INTO v_row
    FROM translation_queue q
   WHERE q.status IN ('pending', 'failed')
     AND q.retry_count < 3
   ORDER BY
     CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END,
     q.created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_row IS NULL THEN
    RETURN;
  END IF;

  UPDATE translation_queue
     SET status     = 'processing',
         started_at = NOW()
   WHERE id = v_row.id;

  queue_id        := v_row.id;
  article_id      := v_row.article_id;
  translation_id  := v_row.translation_id;
  target_language := v_row.target_language;
  retry_count     := v_row.retry_count;
  RETURN NEXT;
  RETURN;
END;
$$;

COMMENT ON FUNCTION get_next_translation_job() IS
  'Atomically claims the next pending/failed translation_queue row and marks it processing.';

---------------------------------------------------------------------
-- Mark completed
---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_translation_job_completed(
  p_queue_id UUID,
  p_result_article_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE translation_queue
     SET status            = 'completed',
         result_article_id = p_result_article_id,
         completed_at      = NOW(),
         error_message     = NULL
   WHERE id = p_queue_id;
END;
$$;

---------------------------------------------------------------------
-- Mark failed (and auto-increment retry_count)
---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_translation_job_failed(
  p_queue_id UUID,
  p_error    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE translation_queue
     SET status        = 'failed',
         error_message = p_error,
         retry_count   = retry_count + 1,
         completed_at  = NOW()
   WHERE id = p_queue_id;
END;
$$;

---------------------------------------------------------------------
-- Row-Level Security
---------------------------------------------------------------------
ALTER TABLE translation_queue ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by edge functions)
DROP POLICY IF EXISTS "Service role full access to translation_queue" ON translation_queue;
CREATE POLICY "Service role full access to translation_queue"
  ON translation_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: SELECT only, for realtime progress display.
-- Access follows the same visibility as the corresponding article.
DROP POLICY IF EXISTS "Authenticated can read own translation_queue" ON translation_queue;
CREATE POLICY "Authenticated can read own translation_queue"
  ON translation_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM articles a
       WHERE a.id = translation_queue.article_id
    )
  );

---------------------------------------------------------------------
-- Enable Realtime for this table so the UI can subscribe
---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname   = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'translation_queue'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE translation_queue';
  END IF;
END $$;
