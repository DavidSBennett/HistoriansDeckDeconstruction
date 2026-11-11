-- SQLite schema for the backend tests only. Mirrors database/01_dk_games.sql and the columns of Board's
-- users / user_sessions tables (database/04_user_accounts_migration.sql in Historians_Board_Version) that
-- this backend reads and writes. Keep it in step with both.

CREATE TABLE users (
  user_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL,
  username_lower       TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  email                TEXT NOT NULL,
  email_verified       INTEGER NOT NULL DEFAULT 0,
  is_admin             INTEGER NOT NULL DEFAULT 0,
  is_disabled          INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  login_blocked_until  TEXT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at        TEXT NULL
);

CREATE TABLE user_sessions (
  session_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  user_agent    TEXT NULL,
  ip_address    TEXT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

CREATE TABLE dk_games (
  game_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  join_code      TEXT NOT NULL UNIQUE,
  host_user_id   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished','cancelled')),
  length         TEXT NOT NULL DEFAULT 'medium',
  deck_id        TEXT NOT NULL DEFAULT 'ai-history',
  rules          TEXT NULL,
  state          TEXT NULL,
  state_version  INTEGER NOT NULL DEFAULT 0,
  to_act_seat    INTEGER NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  started_at     TEXT NULL,
  finished_at    TEXT NULL
);

CREATE TABLE dk_seats (
  game_id    INTEGER NOT NULL REFERENCES dk_games (game_id) ON DELETE CASCADE,
  seat       INTEGER NOT NULL,
  user_id    INTEGER NULL,
  is_bot     INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, seat)
);
