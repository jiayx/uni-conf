-- Migration: 0019_normalize_zero_setup_foundations
-- Keep a freshly migrated database aligned with the zero-setup built-in graph.

INSERT OR IGNORE INTO collections
  (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
VALUES
  (
    'builtin-default-node-pool',
    '默认可用节点',
    '[]',
    '[]',
    '[{"id":"default-exclude-high-multiplier","field":"tag","operator":"not_in","value":["high-multiplier"],"enabled":true}]',
    '[]',
    'full_config',
    'name',
    '[]',
    1,
    '[uni-conf:default-node-pool]',
    datetime('now'),
    datetime('now')
  );

UPDATE collections
SET name = '默认可用节点',
    source_ids = '[]',
    node_ids = '[]',
    filters = '[{"id":"default-exclude-high-multiplier","field":"tag","operator":"not_in","value":["high-multiplier"],"enabled":true}]',
    renames = '[]',
    dedup = 'full_config',
    sort = 'name',
    sort_country_order = '[]',
    enabled = 1,
    notes = '[uni-conf:default-node-pool]',
    updated_at = datetime('now')
WHERE id = 'builtin-default-node-pool';

INSERT OR IGNORE INTO groups
  (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
VALUES
  ('builtin-google', 'Google', 'select', '[]', '[]', '[]', 'http://www.gstatic.com/generate_204', 300, 150, 1, 1, 6, 1, datetime('now'), datetime('now'));

UPDATE groups
SET name = CASE id
    WHEN 'builtin-proxy' THEN 'PROXY'
    WHEN 'builtin-ai' THEN 'AI'
    WHEN 'builtin-streaming' THEN 'Streaming'
    WHEN 'builtin-telegram' THEN 'Telegram'
    WHEN 'builtin-social' THEN 'Social'
    WHEN 'builtin-github' THEN 'GitHub'
    WHEN 'builtin-google' THEN 'Google'
    WHEN 'builtin-apple' THEN 'Apple'
    WHEN 'builtin-microsoft' THEN 'Microsoft'
    WHEN 'builtin-final' THEN '漏网之鱼'
    WHEN 'builtin-crypto' THEN 'Crypto'
    WHEN 'builtin-gaming' THEN 'Gaming'
    WHEN 'builtin-developer' THEN 'Developer'
    WHEN 'builtin-direct' THEN 'DIRECT'
    WHEN 'builtin-reject' THEN 'REJECT'
    WHEN 'builtin-all-nodes' THEN '全部节点'
    WHEN 'builtin-node-select' THEN '节点选择'
    WHEN 'builtin-auto-select' THEN '自动选择'
    WHEN 'builtin-fallback-select' THEN '故障切换'
    ELSE name
  END,
  type = CASE id
    WHEN 'builtin-auto-select' THEN 'url-test'
    WHEN 'builtin-fallback-select' THEN 'fallback'
    WHEN 'builtin-direct' THEN 'direct'
    WHEN 'builtin-reject' THEN 'reject'
    ELSE 'select'
  END,
  collection_ids = CASE id
    WHEN 'builtin-all-nodes' THEN '["builtin-default-node-pool"]'
    WHEN 'builtin-node-select' THEN '["builtin-default-node-pool"]'
    WHEN 'builtin-auto-select' THEN '["builtin-default-node-pool"]'
    WHEN 'builtin-fallback-select' THEN '["builtin-default-node-pool"]'
    ELSE '[]'
  END,
  builtins = CASE id
    WHEN 'builtin-direct' THEN '["DIRECT"]'
    WHEN 'builtin-reject' THEN '["REJECT"]'
    ELSE '[]'
  END,
  test_url = 'http://www.gstatic.com/generate_204',
  interval = 300,
  tolerance = 150,
  lazy = 1,
  sort_order = CASE id
    WHEN 'builtin-proxy' THEN 0
    WHEN 'builtin-ai' THEN 1
    WHEN 'builtin-streaming' THEN 2
    WHEN 'builtin-telegram' THEN 3
    WHEN 'builtin-social' THEN 4
    WHEN 'builtin-github' THEN 5
    WHEN 'builtin-google' THEN 6
    WHEN 'builtin-apple' THEN 7
    WHEN 'builtin-microsoft' THEN 8
    WHEN 'builtin-final' THEN 9
    WHEN 'builtin-crypto' THEN 10
    WHEN 'builtin-gaming' THEN 11
    WHEN 'builtin-developer' THEN 12
    WHEN 'builtin-direct' THEN 13
    WHEN 'builtin-reject' THEN 14
    WHEN 'builtin-all-nodes' THEN 15
    WHEN 'builtin-node-select' THEN 16
    WHEN 'builtin-auto-select' THEN 17
    WHEN 'builtin-fallback-select' THEN 18
    ELSE sort_order
  END,
  is_builtin = 1,
  updated_at = datetime('now')
WHERE id IN (
  'builtin-proxy',
  'builtin-ai',
  'builtin-streaming',
  'builtin-telegram',
  'builtin-social',
  'builtin-github',
  'builtin-google',
  'builtin-apple',
  'builtin-microsoft',
  'builtin-final',
  'builtin-crypto',
  'builtin-gaming',
  'builtin-developer',
  'builtin-direct',
  'builtin-reject',
  'builtin-all-nodes',
  'builtin-node-select',
  'builtin-auto-select',
  'builtin-fallback-select'
);
