-- Add specific default routing policy groups used by the default smart template.

INSERT OR IGNORE INTO groups (id, name, type, collection_ids, group_ids, builtins, enabled, sort_order, is_builtin, created_at, updated_at) VALUES
  ('builtin-github',    'GitHub',    'select', '[]', '["builtin-proxy"]', '[]', 1, 4, 1, datetime('now'), datetime('now')),
  ('builtin-apple',     'Apple',     'select', '[]', '["builtin-proxy"]', '[]', 1, 5, 1, datetime('now'), datetime('now')),
  ('builtin-microsoft', 'Microsoft', 'select', '[]', '["builtin-proxy"]', '[]', 1, 6, 1, datetime('now'), datetime('now'));

UPDATE groups SET sort_order = 7, updated_at = datetime('now') WHERE id = 'builtin-crypto';
UPDATE groups SET sort_order = 8, updated_at = datetime('now') WHERE id = 'builtin-gaming';
UPDATE groups SET sort_order = 9, updated_at = datetime('now') WHERE id = 'builtin-developer';
UPDATE groups SET sort_order = 10, updated_at = datetime('now') WHERE id = 'builtin-direct';
UPDATE groups SET sort_order = 11, updated_at = datetime('now') WHERE id = 'builtin-reject';
UPDATE groups SET sort_order = 12, updated_at = datetime('now') WHERE id = 'builtin-all-nodes';
UPDATE groups SET sort_order = 13, updated_at = datetime('now') WHERE id = 'builtin-node-select';
UPDATE groups SET sort_order = 14, updated_at = datetime('now') WHERE id = 'builtin-auto-select';
