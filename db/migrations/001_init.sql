-- Enable trigram extension for future full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE addressbooks (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  url          TEXT NOT NULL,
  ctag         TEXT,
  sync_token   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  uid            TEXT PRIMARY KEY,
  addressbook_id TEXT NOT NULL REFERENCES addressbooks(id) ON DELETE CASCADE,
  etag           TEXT NOT NULL DEFAULT '',
  fn             TEXT NOT NULL DEFAULT '',
  given_name     TEXT NOT NULL DEFAULT '',
  family_name    TEXT NOT NULL DEFAULT '',
  org            TEXT,
  title          TEXT,
  birthday       TEXT,
  note           TEXT,
  photo_data_uri TEXT,
  phones         JSONB NOT NULL DEFAULT '[]',
  emails         JSONB NOT NULL DEFAULT '[]',
  addresses      JSONB NOT NULL DEFAULT '[]',
  raw_vcard      TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX contacts_family_name    ON contacts (family_name);
CREATE INDEX contacts_addressbook_id ON contacts (addressbook_id);
CREATE INDEX contacts_fn_trgm        ON contacts USING gin (fn gin_trgm_ops);
CREATE INDEX contacts_created_at     ON contacts (created_at DESC);
