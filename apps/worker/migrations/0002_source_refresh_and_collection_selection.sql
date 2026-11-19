ALTER TABLE sources ADD COLUMN refresh_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collections ADD COLUMN empty_selection INTEGER NOT NULL DEFAULT 0;

-- Reject a refresh prepared from an outdated source snapshot, rolling back its batch.
CREATE TRIGGER source_refresh_compare_revision
BEFORE UPDATE OF refresh_revision ON sources
WHEN NEW.refresh_revision != OLD.refresh_revision + 1
BEGIN
  SELECT RAISE(ABORT, 'stale source refresh');
END;

-- Explicit selections that lose their final member must not expand to every node.
CREATE TRIGGER clean_deleted_node_references AFTER DELETE ON nodes
BEGIN
  UPDATE collections SET
    empty_selection = NOT EXISTS (SELECT 1 FROM json_each(node_ids) WHERE value != OLD.id),
    node_ids = (SELECT json_group_array(value) FROM json_each(node_ids) WHERE value != OLD.id),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE workspace_id = OLD.workspace_id AND EXISTS (SELECT 1 FROM json_each(node_ids) WHERE value = OLD.id);
END;

CREATE TRIGGER clean_deleted_source_references AFTER DELETE ON sources
BEGIN
  UPDATE collections SET
    empty_selection = empty_selection OR (json_array_length(node_ids) = 0
      AND NOT EXISTS (SELECT 1 FROM json_each(source_ids) WHERE value != OLD.id)),
    source_ids = (SELECT json_group_array(value) FROM json_each(source_ids) WHERE value != OLD.id),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE workspace_id = OLD.workspace_id AND EXISTS (SELECT 1 FROM json_each(source_ids) WHERE value = OLD.id);
END;
