-- Migration: 0009_add_telegram_and_final_policy_groups
-- Add explicit Telegram and catch-all routing policy groups for the default smart template.

INSERT OR IGNORE INTO groups
  (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
VALUES
  ('builtin-telegram', 'Telegram', 'select', '[]', '[]', '[]', 'http://www.gstatic.com/generate_204', 300, 150, 1, 1, 3, 1, datetime('now'), datetime('now')),
  ('builtin-final', '漏网之鱼', 'select', '[]', '[]', '[]', 'http://www.gstatic.com/generate_204', 300, 150, 1, 1, 8, 1, datetime('now'), datetime('now'));

UPDATE groups SET sort_order = 4, updated_at = datetime('now') WHERE id = 'builtin-social';
UPDATE groups SET sort_order = 5, updated_at = datetime('now') WHERE id = 'builtin-github';
UPDATE groups SET sort_order = 6, updated_at = datetime('now') WHERE id = 'builtin-apple';
UPDATE groups SET sort_order = 7, updated_at = datetime('now') WHERE id = 'builtin-microsoft';
UPDATE groups SET sort_order = 9, updated_at = datetime('now') WHERE id = 'builtin-crypto';
UPDATE groups SET sort_order = 10, updated_at = datetime('now') WHERE id = 'builtin-gaming';
UPDATE groups SET sort_order = 11, updated_at = datetime('now') WHERE id = 'builtin-developer';
UPDATE groups SET sort_order = 12, updated_at = datetime('now') WHERE id = 'builtin-direct';
UPDATE groups SET sort_order = 13, updated_at = datetime('now') WHERE id = 'builtin-reject';
UPDATE groups SET sort_order = 14, updated_at = datetime('now') WHERE id = 'builtin-all-nodes';
UPDATE groups SET sort_order = 15, updated_at = datetime('now') WHERE id = 'builtin-node-select';
UPDATE groups SET sort_order = 16, updated_at = datetime('now') WHERE id = 'builtin-auto-select';
UPDATE groups SET sort_order = 17, updated_at = datetime('now') WHERE id = 'builtin-fallback-select';
