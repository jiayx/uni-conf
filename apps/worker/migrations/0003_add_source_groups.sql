-- Migration: 0003_add_source_groups
-- Store upstream proxy groups and raw content parsed from subscription sources.
-- The current initial schema already includes these columns.

UPDATE sources SET updated_at = updated_at WHERE 0;
