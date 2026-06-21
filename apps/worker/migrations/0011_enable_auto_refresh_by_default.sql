-- Migration: 0011_enable_auto_refresh_by_default
-- The default product flow is subscription URL -> automatic refresh -> usable export.

UPDATE app_settings
SET enable_auto_refresh = 1,
    updated_at = datetime('now')
WHERE id = 'singleton';
