-- Minimal stand-in for the pg_cron 1.6 objects that the Phase 5 switch-over files use
-- (supabase/migrations/*_deactivate_ported_crons.sql, *_unschedule_ported_crons.sql).
-- Shapes follow pg_cron 1.6 as installed on the project: cron.job with jobname of type name,
-- cron.alter_job(job_id bigint, schedule, command, database, username, active) and the two
-- cron.unschedule overloads (by id and by name), so overload resolution matches the real extension.
-- The rows are inserted by cron-switch.test.mjs (their commands carry runtime-built token shapes).

CREATE SCHEMA cron;

CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  schedule text      NOT NULL,
  command  text      NOT NULL,
  nodename text      NOT NULL DEFAULT 'localhost',
  nodeport int       NOT NULL DEFAULT 5432,
  database text      NOT NULL DEFAULT current_database(),
  username text      NOT NULL DEFAULT current_user,
  active   boolean   NOT NULL DEFAULT true,
  jobname  name,
  UNIQUE (jobname, username)
);

CREATE TABLE cron.job_run_details (
  jobid          bigint,
  runid          bigserial PRIMARY KEY,
  job_pid        int,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

-- Calls are recorded so the tests can tell which overload and which arguments were used.
CREATE TABLE cron._calls (
  n    bigserial PRIMARY KEY,
  fn   text NOT NULL,
  args jsonb NOT NULL
);

CREATE FUNCTION cron.alter_job(
  job_id   bigint,
  schedule text    DEFAULT NULL,
  command  text    DEFAULT NULL,
  database text    DEFAULT NULL,
  username text    DEFAULT NULL,
  active   boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cron._calls (fn, args)
  VALUES ('alter_job', jsonb_build_object('job_id', job_id, 'schedule', schedule, 'command', command,
                                          'database', database, 'username', username, 'active', active));
  IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = alter_job.job_id) THEN
    RAISE EXCEPTION 'Job % does not exist or you don''t own it', job_id;
  END IF;
  UPDATE cron.job j SET
    schedule = coalesce(alter_job.schedule, j.schedule),
    command  = coalesce(alter_job.command,  j.command),
    database = coalesce(alter_job.database, j.database),
    username = coalesce(alter_job.username, j.username),
    active   = coalesce(alter_job.active,   j.active)
  WHERE j.jobid = alter_job.job_id;
END $$;

CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cron._calls (fn, args) VALUES ('unschedule(bigint)', jsonb_build_object('job_id', job_id));
  DELETE FROM cron.job j WHERE j.jobid = unschedule.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job %', job_id;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cron._calls (fn, args) VALUES ('unschedule(text)', jsonb_build_object('job_name', job_name));
  DELETE FROM cron.job j WHERE j.jobname = unschedule.job_name AND j.username = current_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name;
  END IF;
  RETURN true;
END $$;
