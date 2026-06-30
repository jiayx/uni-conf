-- The current initial schema already includes remote rule-set preset columns.
UPDATE remote_rule_sets SET updated_at = updated_at WHERE 0;
