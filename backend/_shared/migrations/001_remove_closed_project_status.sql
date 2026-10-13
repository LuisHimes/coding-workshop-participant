-- Projects no longer use the "closed" status: completing a project archives it,
-- so status now moves planning -> active -> completed.

-- Closed projects become completed. The workflow trigger is paused so this data
-- fix can't be refused by today's rules; the audit trigger still records it.
ALTER TABLE projects DISABLE TRIGGER projects_check;
UPDATE projects SET status = 'completed' WHERE status = 'closed';
ALTER TABLE projects ENABLE TRIGGER projects_check;

-- The original constraints were unnamed, so find the ones that allow 'closed'
DO $$
DECLARE
    old_constraint record;
BEGIN
    FOR old_constraint IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%closed%'
    LOOP
        EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', old_constraint.conname);
    END LOOP;
END $$;

ALTER TABLE projects
    ADD CONSTRAINT projects_status_check
        CHECK (status IN ('planning', 'active', 'completed')),
    ADD CONSTRAINT projects_archive_reason_status_check
        CHECK (archive_reason IS DISTINCT FROM 'completed' OR status = 'completed');
