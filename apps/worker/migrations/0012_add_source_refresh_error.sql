-- Migration: 0012_add_source_refresh_error
-- Persist the latest subscription refresh error so source status survives reloads and scheduled refreshes.
-- The current initial schema already includes last_refresh_error.

UPDATE sources SET updated_at = updated_at WHERE 0;
