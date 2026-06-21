-- Migration: 0012_add_source_refresh_error
-- Persist the latest subscription refresh error so source status survives reloads and scheduled refreshes.

ALTER TABLE sources ADD COLUMN last_refresh_error TEXT;
