-- Migration: Create queue-based article generation system
-- This solves the 150-second Edge Function timeout limit by using a queue system
-- Cron job enqueues tasks (fast, no timeout), worker processes them (can retry on timeout)

-- Queue table already exists from previous migration, but let's ensure it has all needed fields
DO $$
BEGIN
  -- Add columns if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'title_id'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN title_id UUID REFERENCES article_titles(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'status'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN error_message TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN started_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'article_generation_queue' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE article_generation_queue ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create index for faster queue processing
CREATE INDEX IF NOT EXISTS idx_article_generation_queue_status ON article_generation_queue(status, created_at) WHERE status = 'pending';

-- Create index for retry logic
CREATE INDEX IF NOT EXISTS idx_article_generation_queue_retry ON article_generation_queue(status, retry_count, created_at) WHERE status IN ('pending', 'failed') AND retry_count < 3;

-- Function to enqueue next article title
CREATE OR REPLACE FUNCTION enqueue_next_article()
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  next_title_id UUID;
  queue_id UUID;
BEGIN
  -- Get the next unprocessed title (using the same logic as Edge Function)
  -- Try rotation silo first, then today's silo, then any
  SELECT id INTO next_title_id
  FROM article_titles
  WHERE processed = false
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF next_title_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Insert into queue
  INSERT INTO article_generation_queue (title_id, status, created_at)
  VALUES (next_title_id, 'pending', NOW())
  RETURNING id INTO queue_id;
  
  RETURN queue_id;
END;
$$;

-- Function to get next pending job from queue
CREATE OR REPLACE FUNCTION get_next_queue_job()
RETURNS TABLE (
  queue_id UUID,
  title_id UUID,
  title TEXT,
  silo_category TEXT,
  retry_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  job_record RECORD;
BEGIN
  -- Get next pending job, or failed job with retry_count < 3
  SELECT 
    q.id,
    q.title_id,
    t.title,
    t.silo_category,
    q.retry_count
  INTO job_record
  FROM article_generation_queue q
  JOIN article_titles t ON t.id = q.title_id
  WHERE q.status IN ('pending', 'failed')
    AND q.retry_count < 3
    AND t.processed = false
  ORDER BY 
    CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END,
    q.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF job_record IS NULL THEN
    RETURN;
  END IF;
  
  -- Mark as processing
  UPDATE article_generation_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE id = job_record.id;
  
  RETURN QUERY SELECT 
    job_record.id,
    job_record.title_id,
    job_record.title,
    job_record.silo_category,
    job_record.retry_count;
END;
$$;

-- Function to mark job as completed
CREATE OR REPLACE FUNCTION mark_queue_job_completed(queue_job_id UUID, article_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE article_generation_queue
  SET status = 'completed',
      completed_at = NOW()
  WHERE id = queue_job_id;
  
  -- Mark title as processed
  UPDATE article_titles
  SET processed = true,
      processed_at = NOW()
  WHERE id = (SELECT title_id FROM article_generation_queue WHERE id = queue_job_id);
END;
$$;

-- Function to mark job as failed
CREATE OR REPLACE FUNCTION mark_queue_job_failed(queue_job_id UUID, error_msg TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE article_generation_queue
  SET status = 'failed',
      error_message = error_msg,
      retry_count = retry_count + 1,
      completed_at = NOW()
  WHERE id = queue_job_id;
END;
$$;

-- Enable RLS on queue table
ALTER TABLE article_generation_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow service role full access
CREATE POLICY IF NOT EXISTS "Allow service role full access to article_generation_queue"
ON article_generation_queue
FOR ALL
USING (true)
WITH CHECK (true);

COMMENT ON TABLE article_generation_queue IS 'Queue for article generation jobs to handle long-running tasks that exceed Edge Function timeout limits';
COMMENT ON FUNCTION enqueue_next_article() IS 'Enqueues the next unprocessed article title for generation';
COMMENT ON FUNCTION get_next_queue_job() IS 'Gets and locks the next pending job from the queue';
COMMENT ON FUNCTION mark_queue_job_completed(UUID, UUID) IS 'Marks a queue job as completed and updates the article title';
COMMENT ON FUNCTION mark_queue_job_failed(UUID, TEXT) IS 'Marks a queue job as failed and increments retry count';

