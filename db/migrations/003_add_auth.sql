CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  must_change_password  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember      BOOLEAN NOT NULL DEFAULT false,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id    ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Each Frigg user connects their own Baïkal (CardDAV) account.
CREATE TABLE carddav_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carddav_url         TEXT NOT NULL,
  username            TEXT NOT NULL,
  password_encrypted  TEXT NOT NULL,
  password_iv         TEXT NOT NULL,
  password_auth_tag   TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, carddav_url, username)
);

ALTER TABLE addressbooks
  ADD COLUMN carddav_account_id UUID REFERENCES carddav_accounts(id) ON DELETE CASCADE;

-- Sharing: lets a book's owner grant other Frigg users visibility into it.
CREATE TABLE addressbook_access (
  addressbook_id TEXT NOT NULL REFERENCES addressbooks(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (addressbook_id, user_id)
);
