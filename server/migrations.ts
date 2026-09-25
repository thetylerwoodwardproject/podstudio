/*
 * Database migrations, applied in order at start (see db.ts). Never edit one
 * that has shipped: add the next.
 */
export const migrations: string[] = [
  // 1 · Accounts, episodes and scripts, pads, takes, live sessions
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at INTEGER
  );
  -- Signed-in browsers. The cookie holds a random id; only its hash is stored.
  CREATE TABLE auth_sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 0 until the second factor is entered (when 2FA is on)
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE shows (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE scripts (
    episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Solo or with a guest, the script mode, producer, talking points (lib/show.ts)
  CREATE TABLE show_setup (
    episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Hotkey pads: the show set (episode_id NULL) and episode overrides (lib/pads.ts)
  CREATE TABLE pads (
    id TEXT PRIMARY KEY,
    show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
    key INTEGER NOT NULL CHECK (key BETWEEN 1 AND 9),
    json TEXT NOT NULL
  );
  CREATE UNIQUE INDEX pads_key ON pads (show_id, ifnull(episode_id, ''), key);
  -- The sound library: media/<id>.wav. Never deleted when a pad is cleared.
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT,
    seconds REAL NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  -- Recordings uploaded as they're made: takes/<id>/seg-NNNNNN.pcm
  CREATE TABLE takes (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    meta TEXT NOT NULL,
    segments INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Live sessions with a guest and a producer (docs/server-api.md)
  CREATE TABLE live_sessions (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    ended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  -- One open 6-digit code per role per session. The host's invite card shows it again,
  -- so it's kept as is; what protects it is the host letting each person in, and the
  -- limit on join attempts. Deleted when revoked or when the session ends.
  CREATE TABLE invites (
    session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('guest', 'producer')),
    code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, role)
  );
  CREATE TABLE members (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('host', 'guest', 'producer')),
    name TEXT NOT NULL,
    admitted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  `,
  // 2 · 2FA: the last code step used (so a code works once), and trusted devices
  `
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT -1;
  ALTER TABLE users ADD COLUMN totp_added_at INTEGER;
  -- "Trust this device for 30 days": skips the code at sign-in on that browser
  CREATE TABLE trusted_devices (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
];
