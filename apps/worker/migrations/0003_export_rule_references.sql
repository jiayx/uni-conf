-- Keep scoped profiles intact across manual deletion, import undo and catalog updates.
CREATE TRIGGER restrict_exported_rule_delete BEFORE DELETE ON rules
WHEN EXISTS (
  SELECT 1 FROM export_configs e, json_each(e.include_rule_ids) ref
  WHERE e.workspace_id = OLD.workspace_id AND ref.value = OLD.id
) AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'export_rule_reference');
END;

CREATE TRIGGER restrict_exported_remote_set_delete BEFORE DELETE ON remote_rule_sets
WHEN EXISTS (
  SELECT 1 FROM export_configs e, json_each(e.include_remote_set_ids) ref
  WHERE e.workspace_id = OLD.workspace_id AND ref.value = OLD.id
) AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'export_rule_reference');
END;

CREATE TRIGGER validate_profile_rules_on_insert BEFORE INSERT ON export_configs
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.include_rule_ids) ref WHERE NOT EXISTS
  (SELECT 1 FROM rules r WHERE r.id = ref.value AND r.workspace_id = NEW.workspace_id)
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.include_remote_set_ids) ref WHERE NOT EXISTS
  (SELECT 1 FROM remote_rule_sets r WHERE r.id = ref.value AND r.workspace_id = NEW.workspace_id)
)
BEGIN
  SELECT RAISE(ABORT, 'missing_export_rule');
END;

CREATE TRIGGER validate_profile_rules_on_update BEFORE UPDATE OF include_rule_ids, include_remote_set_ids, workspace_id ON export_configs
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.include_rule_ids) ref WHERE NOT EXISTS
  (SELECT 1 FROM rules r WHERE r.id = ref.value AND r.workspace_id = NEW.workspace_id)
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.include_remote_set_ids) ref WHERE NOT EXISTS
  (SELECT 1 FROM remote_rule_sets r WHERE r.id = ref.value AND r.workspace_id = NEW.workspace_id)
)
BEGIN
  SELECT RAISE(ABORT, 'missing_export_rule');
END;
