CREATE TABLE contact_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE contact_group_members (
  group_id    UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_uid TEXT NOT NULL REFERENCES contacts(uid) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_uid)
);
CREATE INDEX contact_group_members_contact ON contact_group_members (contact_uid);
