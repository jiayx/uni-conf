-- Keep the built-in PROXY outlet canonical: members are resolved from groups,
-- not from a hard-coded DIRECT builtin.
UPDATE groups
SET builtins = '[]',
    updated_at = datetime('now')
WHERE id = 'builtin-proxy';
