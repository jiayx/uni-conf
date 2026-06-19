-- Migration: 0003_add_source_groups
-- Store upstream proxy groups and raw content parsed from subscription sources.

ALTER TABLE sources ADD COLUMN source_groups TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sources ADD COLUMN raw_content TEXT;
