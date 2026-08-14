-- Migration: 0001_initial_schema
-- UniConf initial database schema

-- Configuration spaces managed by the single deployment administrator.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default
  ON workspaces(is_default)
  WHERE is_default = 1;

INSERT OR IGNORE INTO workspaces (id, name, is_default, created_at, updated_at)
VALUES ('default', '我的配置', 1, datetime('now'), datetime('now'));

-- Sources table: subscription sources
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('url', 'manual', 'file', 'clipboard')),
  url TEXT,
  format TEXT NOT NULL DEFAULT 'auto',
  enabled INTEGER NOT NULL DEFAULT 1,
  node_count INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT,
  last_refresh_error TEXT,
  update_interval INTEGER DEFAULT 0,
  user_agent TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source_groups TEXT NOT NULL DEFAULT '[]',
  raw_content TEXT,
  upload_bytes INTEGER,
  download_bytes INTEGER,
  total_bytes INTEGER,
  expire_time INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sources_workspace_id ON sources(workspace_id);

-- Import run audit records intentionally contain summaries only, never raw config or node credentials.
CREATE TABLE IF NOT EXISTS source_import_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT,
  source_name TEXT NOT NULL,
  format TEXT NOT NULL,
  node_import_mode TEXT NOT NULL DEFAULT 'all' CHECK (node_import_mode IN ('all', 'new-only')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'undone')),
  node_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_existing_count INTEGER NOT NULL DEFAULT 0,
  rule_count INTEGER NOT NULL DEFAULT 0,
  remote_rule_set_count INTEGER NOT NULL DEFAULT 0,
  skipped_rule_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  refresh_error TEXT,
  structured_error TEXT,
  structured_changes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  undone_at TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_import_runs_created_at ON source_import_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_import_runs_source_id ON source_import_runs(source_id);
CREATE INDEX IF NOT EXISTS idx_source_import_runs_recovery ON source_import_runs(status, completed_at, created_at);

-- Nodes table: parsed proxy nodes
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_workspace_id ON nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nodes_source_id ON nodes(source_id);
CREATE INDEX IF NOT EXISTS idx_nodes_protocol ON nodes(protocol);
CREATE INDEX IF NOT EXISTS idx_nodes_country_code ON nodes(country_code);
CREATE INDEX IF NOT EXISTS idx_nodes_enabled ON nodes(enabled);

-- Collections table: node grouping/filtering configurations
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collections_workspace_id ON collections(workspace_id);

-- Groups table: proxy policy groups
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_groups_workspace_id ON groups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_groups_sort_order ON groups(sort_order);

-- Rules table: traffic routing rules
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  FOREIGN KEY (target_group_id) REFERENCES groups(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rules_workspace_id ON rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_sort_order ON rules(sort_order);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);

-- Remote rule sets
CREATE TABLE IF NOT EXISTS remote_rule_sets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  format TEXT NOT NULL,
  behavior TEXT NOT NULL DEFAULT 'classical',
  preset_source TEXT,
  preset_id TEXT,
  source_overrides TEXT NOT NULL DEFAULT '{}',
  source_id TEXT,
  source_rule_set_key TEXT,
  source_missing INTEGER NOT NULL DEFAULT 0,
  target_group_id TEXT NOT NULL,
  target_override_group_id TEXT,
  update_interval INTEGER NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_group_id) REFERENCES groups(id),
  FOREIGN KEY (target_override_group_id) REFERENCES groups(id),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_rule_sets_workspace_id ON remote_rule_sets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_remote_rule_sets_sort_order ON remote_rule_sets(sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_rule_sets_source_key
  ON remote_rule_sets(source_id, source_rule_set_key)
  WHERE source_id IS NOT NULL AND source_rule_set_key IS NOT NULL;

-- Export configurations
CREATE TABLE IF NOT EXISTS export_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  include_collection_ids TEXT NOT NULL DEFAULT '[]',
  include_group_ids TEXT NOT NULL DEFAULT '[]',
  include_rule_ids TEXT NOT NULL DEFAULT '[]',
  include_remote_set_ids TEXT NOT NULL DEFAULT '[]',
  rule_set_conversion_policy TEXT CHECK (
    rule_set_conversion_policy IS NULL
    OR rule_set_conversion_policy IN ('compatible', 'strict')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_export_configs_workspace_id ON export_configs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_export_configs_token ON export_configs(token);
CREATE INDEX IF NOT EXISTS idx_export_configs_format ON export_configs(format);

-- Settings are independent for each configuration space.
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'zh',
  theme TEXT NOT NULL DEFAULT 'system',
  unmatched_traffic_policy TEXT NOT NULL DEFAULT 'proxy' CHECK (
    unmatched_traffic_policy IN ('proxy', 'direct')
  ),
  routing_policy_scenarios TEXT NOT NULL DEFAULT '["ai-development","streaming","diagnostics"]',
  routing_outlet_preferences TEXT,
  export_node_naming_mode TEXT NOT NULL DEFAULT 'smart',
  dns_real_ip_domains TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(dns_real_ip_domains)
    AND json_type(dns_real_ip_domains) = 'array'
  ),
  default_export_token TEXT,
  show_compatibility_warnings INTEGER NOT NULL DEFAULT 1,
  rule_set_conversion_policy TEXT NOT NULL DEFAULT 'compatible' CHECK (
    rule_set_conversion_policy IN ('compatible', 'strict')
  ),
  enable_auto_refresh INTEGER NOT NULL DEFAULT 1,
  auto_refresh_interval INTEGER NOT NULL DEFAULT 240,
  auto_node_groups_enabled INTEGER NOT NULL DEFAULT 1,
  auto_node_group_types TEXT NOT NULL DEFAULT '["url-test"]',
  auto_node_group_keys TEXT,
  auto_node_group_include_flag INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Insert default settings
INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES ('default', datetime('now'));

-- Insert managed default node pool
INSERT OR IGNORE INTO collections (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at, workspace_id) VALUES
  (
    'builtin-default-node-pool',
    '默认节点池',
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
    datetime('now'),
    'default'
  );

-- Insert default builtin groups
INSERT OR IGNORE INTO groups (id, name, type, collection_ids, group_ids, builtins, enabled, sort_order, is_builtin, created_at, updated_at, workspace_id) VALUES
  ('builtin-proxy',     'PROXY',     'select',   '[]', '[]', '[]',         1, 0,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-ai',        'AI',        'select',   '[]', '[]', '[]', 1, 1,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-streaming', 'Streaming', 'select',   '[]', '[]', '[]', 1, 2,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-social',    'Social',    'select',   '[]', '[]', '[]', 0, 3,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-github',    'GitHub',    'select',   '[]', '[]', '[]', 1, 4,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-google',    'Google',    'select',   '[]', '[]', '[]', 1, 5,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-apple',     'Apple',     'select',   '[]', '[]', '[]', 0, 6,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-microsoft', 'Microsoft', 'select',   '[]', '[]', '[]', 1, 7,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-speedtest', 'Speedtest', 'select',   '[]', '[]', '[]', 1, 8,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-crypto',    'Crypto',    'select',   '[]', '[]', '[]', 0, 9,  1, datetime('now'), datetime('now'), 'default'),
  ('builtin-gaming',    'Gaming',    'select',   '[]', '[]', '[]', 0, 10, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-broker',    'Broker',    'select',   '[]', '[]', '[]', 0, 11, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-developer', 'Developer', 'select',   '[]', '[]', '[]', 0, 12, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-direct',    'DIRECT',    'direct',   '[]', '[]', '["DIRECT"]',  1, 13, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-reject',    'REJECT',    'reject',   '[]', '[]', '["REJECT"]',  1, 14, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-all-nodes', '全部节点',   'select',   '["builtin-default-node-pool"]', '[]', '[]', 1, 15, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-node-select', '节点选择', 'select',   '["builtin-default-node-pool"]', '[]', '[]', 1, 16, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-auto-select', '自动选择', 'url-test', '["builtin-default-node-pool"]', '[]', '[]', 1, 17, 1, datetime('now'), datetime('now'), 'default'),
  ('builtin-fallback-select', '故障切换', 'fallback', '["builtin-default-node-pool"]', '[]', '[]', 1, 18, 1, datetime('now'), datetime('now'), 'default');
