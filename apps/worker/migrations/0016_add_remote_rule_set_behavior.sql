ALTER TABLE remote_rule_sets ADD COLUMN behavior TEXT NOT NULL DEFAULT 'classical';

UPDATE remote_rule_sets
SET behavior = 'domain', updated_at = datetime('now')
WHERE preset_source = 'uni-conf' AND preset_id = 'telegram';
