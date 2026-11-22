BEGIN;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS resource_kind TEXT NOT NULL DEFAULT 'contact'
  CHECK (resource_kind IN ('contact','group'));
CREATE INDEX IF NOT EXISTS contacts_resource_kind ON contacts(addressbook_id,resource_kind);
-- Force a read-only reclassification of cached remote resources on the next sync.
-- This does not convert or modify any manual/intelligent group or remote vCard.
UPDATE addressbooks SET ctag=NULL,sync_token=NULL;
COMMIT;
