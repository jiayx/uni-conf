ALTER TABLE app_settings ADD COLUMN auto_node_groups_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN auto_node_group_types TEXT NOT NULL DEFAULT '["url-test"]';
ALTER TABLE app_settings ADD COLUMN auto_node_group_keys TEXT;
ALTER TABLE app_settings ADD COLUMN auto_node_group_include_flag INTEGER NOT NULL DEFAULT 1;
