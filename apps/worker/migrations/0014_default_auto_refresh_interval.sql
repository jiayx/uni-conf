-- Align the default subscription refresh cadence with the product default: 24 hours.
UPDATE app_settings
SET auto_refresh_interval = 1440,
    updated_at = datetime('now')
WHERE id = 'singleton';
