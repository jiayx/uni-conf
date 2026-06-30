-- The current initial schema already includes behavior.

UPDATE remote_rule_sets
SET behavior = 'domain', updated_at = datetime('now')
WHERE preset_source = 'uni-conf' AND preset_id = 'telegram';
