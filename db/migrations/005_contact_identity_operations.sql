BEGIN;
-- Keep the existing primary key and every local group reference unchanged.
-- `uid` is now an opaque internal ID; vcard_uid is scoped to its address book.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vcard_uid TEXT;
UPDATE contacts SET vcard_uid = uid WHERE vcard_uid IS NULL;
ALTER TABLE contacts ALTER COLUMN vcard_uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_book_vcard_uid ON contacts(addressbook_id, vcard_uid);

CREATE TABLE IF NOT EXISTS contact_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'merge')),
  source_uid TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','writing','target_verified','source_deleted','complete','cancelled')),
  plan JSONB NOT NULL,
  target_etag TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_operations_active_source
  ON contact_operations(source_uid) WHERE status NOT IN ('complete','cancelled');
COMMIT;
