-- Migration: 0010_add_remote_rule_set_sort_order
-- Keep preset remote rule sets in a deterministic routing order.

-- The current initial schema already includes sort_order.

CREATE INDEX IF NOT EXISTS idx_remote_rule_sets_sort_order ON remote_rule_sets(sort_order);

UPDATE remote_rule_sets SET sort_order = 10, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('private');
UPDATE remote_rule_sets SET sort_order = 20, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('adrules', 'httpdns');
UPDATE remote_rule_sets SET sort_order = 30, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('cn', 'cncidr', 'cncidr-resolve', 'apple-cn', 'microsoft-cn', 'games-cn', 'socialmedia-cn', 'iplocation-direct', 'apns', 'cdn', 'douyin', 'fake-ip-filter', 'bilibili');
UPDATE remote_rule_sets SET sort_order = 40, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('ai');
UPDATE remote_rule_sets SET sort_order = 50, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('telegram');
UPDATE remote_rule_sets SET sort_order = 60, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('netflix', 'youtube', 'disney', 'apple-tv', 'primevideo', 'hbo', 'hulu', 'dazn', 'abema', 'bahamut', 'dmm', 'mytvsuper', 'niconico', 'spotify', 'twitch');
UPDATE remote_rule_sets SET sort_order = 70, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('gits');
UPDATE remote_rule_sets SET sort_order = 80, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('apple', 'apple-proxy');
UPDATE remote_rule_sets SET sort_order = 90, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('microsoft', 'onedrive');
UPDATE remote_rule_sets SET sort_order = 100, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('google', 'googlefcm');
UPDATE remote_rule_sets SET sort_order = 110, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('games', 'steam');
UPDATE remote_rule_sets SET sort_order = 120, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('crypto');
UPDATE remote_rule_sets SET sort_order = 130, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('forum', 'socialmedia', 'talkatone', 'tiktok');
UPDATE remote_rule_sets SET sort_order = 140, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('gfw', 'proxy', 'tld-proxy', 'iplocation-proxy');
UPDATE remote_rule_sets SET sort_order = 150, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND preset_id IN ('ecommerce', 'paypal', 'speedtest', 'dmca');
UPDATE remote_rule_sets SET sort_order = 900, updated_at = datetime('now') WHERE preset_source = 'quixotic' AND sort_order = 0;
