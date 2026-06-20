-- Migration: 0001_initial_schema
-- UniConf initial database schema

-- Sources table: subscription sources
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('url', 'manual', 'file', 'clipboard')),
  url TEXT,
  format TEXT NOT NULL DEFAULT 'auto',
  enabled INTEGER NOT NULL DEFAULT 1,
  node_count INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT,
  update_interval INTEGER DEFAULT 0,
  user_agent TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source_groups TEXT NOT NULL DEFAULT '[]',
  raw_content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Nodes table: parsed proxy nodes
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  server TEXT NOT NULL,
  port INTEGER NOT NULL,
  country TEXT,
  country_code TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  raw_config TEXT NOT NULL DEFAULT '{}',
  parsed_config TEXT NOT NULL DEFAULT '{}',
  is_manual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_source_id ON nodes(source_id);
CREATE INDEX IF NOT EXISTS idx_nodes_protocol ON nodes(protocol);
CREATE INDEX IF NOT EXISTS idx_nodes_country_code ON nodes(country_code);
CREATE INDEX IF NOT EXISTS idx_nodes_enabled ON nodes(enabled);

-- Collections table: node grouping/filtering configurations
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_ids TEXT NOT NULL DEFAULT '[]',
  node_ids TEXT NOT NULL DEFAULT '[]',
  filters TEXT NOT NULL DEFAULT '[]',
  renames TEXT NOT NULL DEFAULT '[]',
  dedup TEXT NOT NULL DEFAULT 'name',
  sort TEXT NOT NULL DEFAULT 'country',
  sort_country_order TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Groups table: proxy policy groups
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('select', 'url-test', 'fallback', 'load-balance', 'direct', 'reject')),
  collection_ids TEXT NOT NULL DEFAULT '[]',
  group_ids TEXT NOT NULL DEFAULT '[]',
  builtins TEXT NOT NULL DEFAULT '[]',
  test_url TEXT,
  interval INTEGER DEFAULT 300,
  tolerance INTEGER DEFAULT 150,
  lazy INTEGER DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_sort_order ON groups(sort_order);

-- Rules table: traffic routing rules
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  no_resolve INTEGER NOT NULL DEFAULT 0,
  target_group_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  compatibility TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_group_id) REFERENCES groups(id)
);

CREATE INDEX IF NOT EXISTS idx_rules_sort_order ON rules(sort_order);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);

-- Remote rule sets
CREATE TABLE IF NOT EXISTS remote_rule_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  format TEXT NOT NULL,
  preset_source TEXT,
  preset_id TEXT,
  target_group_id TEXT NOT NULL,
  update_interval INTEGER NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_updated TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_group_id) REFERENCES groups(id)
);

-- Export configurations
CREATE TABLE IF NOT EXISTS export_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  include_collection_ids TEXT NOT NULL DEFAULT '[]',
  include_group_ids TEXT NOT NULL DEFAULT '[]',
  include_rule_ids TEXT NOT NULL DEFAULT '[]',
  include_remote_set_ids TEXT NOT NULL DEFAULT '[]',
  extra_config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_export_configs_token ON export_configs(token);
CREATE INDEX IF NOT EXISTS idx_export_configs_format ON export_configs(format);

-- App settings (single row)
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  language TEXT NOT NULL DEFAULT 'zh',
  theme TEXT NOT NULL DEFAULT 'system',
  routing_policy_template TEXT NOT NULL DEFAULT 'common',
  default_export_token TEXT,
  show_compatibility_warnings INTEGER NOT NULL DEFAULT 1,
  enable_auto_refresh INTEGER NOT NULL DEFAULT 0,
  auto_refresh_interval INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES ('singleton', datetime('now'));

-- Insert default builtin groups
INSERT OR IGNORE INTO groups (id, name, type, collection_ids, group_ids, builtins, enabled, sort_order, is_builtin, created_at, updated_at) VALUES
  ('builtin-proxy',     'PROXY',     'select',   '[]', '[]', '["DIRECT"]', 1, 0,  1, datetime('now'), datetime('now')),
  ('builtin-ai',        'AI',        'select',   '[]', '["builtin-proxy"]', '[]', 1, 1,  1, datetime('now'), datetime('now')),
  ('builtin-streaming', 'Streaming', 'select',   '[]', '["builtin-proxy"]', '[]', 1, 2,  1, datetime('now'), datetime('now')),
  ('builtin-social',    'Social',    'select',   '[]', '["builtin-proxy"]', '[]', 1, 3,  1, datetime('now'), datetime('now')),
  ('builtin-crypto',    'Crypto',    'select',   '[]', '["builtin-proxy"]', '[]', 0, 4,  1, datetime('now'), datetime('now')),
  ('builtin-gaming',    'Gaming',    'select',   '[]', '["builtin-proxy"]', '[]', 0, 5,  1, datetime('now'), datetime('now')),
  ('builtin-developer', 'Developer', 'select',   '[]', '["builtin-proxy"]', '[]', 0, 6,  1, datetime('now'), datetime('now')),
  ('builtin-direct',    'DIRECT',    'direct',   '[]', '[]', '["DIRECT"]',  1, 7,  1, datetime('now'), datetime('now')),
  ('builtin-reject',    'REJECT',    'reject',   '[]', '[]', '["REJECT"]',  1, 8,  1, datetime('now'), datetime('now')),
  ('builtin-all-nodes', '全部节点',   'select',   '[]', '[]', '[]',          1, 9,  1, datetime('now'), datetime('now')),
  ('builtin-node-select', '节点选择', 'select',   '[]', '[]', '[]',          1, 10, 1, datetime('now'), datetime('now')),
  ('builtin-auto-select', '自动选择', 'url-test', '[]', '[]', '[]',          1, 11, 1, datetime('now'), datetime('now'));
