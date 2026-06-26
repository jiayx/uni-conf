-- Keep built-in outlet members canonical: members are resolved from sync,
-- not from static seed relationships.
UPDATE groups
SET builtins = '[]',
    updated_at = datetime('now')
WHERE id = 'builtin-proxy';

UPDATE groups
SET group_ids = '[]',
    updated_at = datetime('now')
WHERE id IN (
  'builtin-ai',
  'builtin-streaming',
  'builtin-telegram',
  'builtin-social',
  'builtin-github',
  'builtin-apple',
  'builtin-microsoft',
  'builtin-final',
  'builtin-crypto',
  'builtin-gaming',
  'builtin-developer'
);
