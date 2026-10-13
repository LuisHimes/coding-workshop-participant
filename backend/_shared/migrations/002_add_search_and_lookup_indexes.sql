-- Indexes for searches, permission checks and reports.

-- "Contains" searches (ILIKE '%term%') need trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS users_search_idx ON users
    USING gin ((first_name || ' ' || last_name || ' ' || email || ' ' || id) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_search_idx ON projects
    USING gin ((name || ' ' || coalesce(description, '')) public.gin_trgm_ops);

-- Project-wide assignment lookups, and cascades when a member is removed
CREATE INDEX IF NOT EXISTS milestone_assignments_project_user_idx ON milestone_assignments (project_id, user_id);

-- A project's hours by date, and the check made when a milestone is deleted
DROP INDEX IF EXISTS time_entries_project_id_idx;
CREATE INDEX IF NOT EXISTS time_entries_project_date_idx ON time_entries (project_id, work_date);
CREATE INDEX IF NOT EXISTS time_entries_milestone_id_idx ON time_entries (milestone_id) WHERE milestone_id IS NOT NULL;

-- Newest messages across every board (admins)
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC, id DESC);

-- Audit log filtered by record or by user, newest first
DROP INDEX IF EXISTS audit_log_entity_idx;
DROP INDEX IF EXISTS audit_log_actor_idx;
CREATE INDEX IF NOT EXISTS audit_log_entity_time_idx ON audit_log (entity, entity_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_time_idx ON audit_log (actor_id, occurred_at DESC, id DESC);
