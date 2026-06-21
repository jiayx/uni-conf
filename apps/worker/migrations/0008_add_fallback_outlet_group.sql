-- Migration: 0008_add_fallback_outlet_group
-- Add the built-in fallback outlet group used by the default smart strategy.

INSERT OR IGNORE INTO groups
  (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
VALUES
  ('builtin-fallback-select', '故障切换', 'fallback', '[]', '[]', '[]', 'http://www.gstatic.com/generate_204', 300, 150, 1, 1, 15, 1, datetime('now'), datetime('now'));
