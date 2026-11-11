-- 01_dk_games.sql
-- Game tables for the deck-builder at projecta.thehistorians.org. Run once, by hand, in phpMyAdmin, in the
-- database projecta's config.secret.php names as DK_DB_DSN. (Accounts live in Board's database; see
-- database/INSTALL.md. Nothing here touches Board's tables.)
--
-- A game's whole engine state is one JSON document (dk_games.state), so rule changes never need a
-- migration. dk_games.rules is a snapshot of data/ taken when the game starts, so a rebalance deployed
-- mid-game cannot change a game in progress.

CREATE TABLE dk_games (
  game_id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  join_code      CHAR(6)      NOT NULL,
  host_user_id   INT UNSIGNED NOT NULL,              -- Board users.user_id
  status         ENUM('lobby','playing','finished','cancelled') NOT NULL DEFAULT 'lobby',
  length         VARCHAR(16)  NOT NULL DEFAULT 'medium',
  deck_id        VARCHAR(64)  NOT NULL DEFAULT 'ai-history',
  rules          MEDIUMTEXT   NULL,                  -- JSON snapshot of data/ at start
  state          MEDIUMTEXT   NULL,                  -- JSON engine state once started
  state_version  INT UNSIGNED NOT NULL DEFAULT 0,    -- bumped on every change; clients poll with ?since=
  to_act_seat    TINYINT      NULL,                  -- whose move it is (for "your turn" lists)
  created_at     DATETIME     NOT NULL,
  updated_at     DATETIME     NOT NULL,
  started_at     DATETIME     NULL,
  finished_at    DATETIME     NULL,
  UNIQUE KEY join_code_unique (join_code),
  KEY status_idx (status),
  KEY host_idx (host_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dk_seats (
  game_id    INT UNSIGNED     NOT NULL,
  seat       TINYINT UNSIGNED NOT NULL,              -- 0-based; equals the engine's seat number
  user_id    INT UNSIGNED     NULL,                  -- NULL for a bot
  is_bot     TINYINT(1)       NOT NULL DEFAULT 0,
  name       VARCHAR(40)      NOT NULL,
  joined_at  DATETIME         NOT NULL,
  PRIMARY KEY (game_id, seat),
  KEY user_idx (user_id),
  CONSTRAINT fk_dk_seat_game FOREIGN KEY (game_id) REFERENCES dk_games (game_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
