/**
 * Lược đồ cơ sở dữ liệu quan hệ SQLite cho DISCORD GAME BOT PRO.
 * Tích hợp sẵn ràng buộc toàn vẹn số dư không âm (CHECK >= 0) và khóa phân quyền.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('ADMIN', 'MODERATOR')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  wallet INTEGER NOT NULL DEFAULT 0 CHECK(wallet >= 0),
  bank INTEGER NOT NULL DEFAULT 0 CHECK(bank >= 0),
  savings INTEGER NOT NULL DEFAULT 0 CHECK(savings >= 0),
  savings_opened_at INTEGER NOT NULL DEFAULT 0,
  last_interest_at INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0 CHECK(exp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
  active_title TEXT NOT NULL DEFAULT 'tan_thu',
  unlocked_titles TEXT NOT NULL DEFAULT '["tan_thu"]',
  active_frame TEXT DEFAULT NULL,
  active_pet_id INTEGER DEFAULT NULL,
  protected_until INTEGER NOT NULL DEFAULT 0,
  exp_boost_until INTEGER NOT NULL DEFAULT 0,
  lucky_boost_until INTEGER NOT NULL DEFAULT 0,
  last_daily_at INTEGER NOT NULL DEFAULT 0,
  last_weekly_at INTEGER NOT NULL DEFAULT 0,
  last_monthly_at INTEGER NOT NULL DEFAULT 0,
  last_work_at INTEGER NOT NULL DEFAULT 0,
  last_beg_at INTEGER NOT NULL DEFAULT 0,
  last_rob_at INTEGER NOT NULL DEFAULT 0,
  login_streak INTEGER NOT NULL DEFAULT 0,
  last_streak_date TEXT DEFAULT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT DEFAULT NULL,
  is_frozen INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_wealth ON users ((wallet + bank + savings) DESC);
CREATE INDEX IF NOT EXISTS idx_users_level ON users (level DESC, exp DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  counterparty_id TEXT DEFAULT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  bet INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  net INTEGER NOT NULL,
  won INTEGER NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gamelogs_game_time ON game_logs (game, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gamelogs_user_game ON game_logs (user_id, game);

CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  species_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  hunger INTEGER NOT NULL DEFAULT 100,
  last_fed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pets_user ON pets (user_id);

CREATE TABLE IF NOT EXISTS quest_progress (
  user_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, quest_id, period_key)
);

CREATE TABLE IF NOT EXISTS custom_quests (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('daily', 'weekly', 'special', 'event')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  metric TEXT NOT NULL,
  target INTEGER NOT NULL CHECK(target >= 1),
  reward_vnd INTEGER NOT NULL CHECK(reward_vnd >= 0),
  reward_exp INTEGER NOT NULL CHECK(reward_exp >= 0),
  expires_at INTEGER DEFAULT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bounties (
  target_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL CHECK(amount >= 0),
  placed_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bounties_amount ON bounties (amount DESC);

CREATE TABLE IF NOT EXISTS server_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_vnd INTEGER NOT NULL CHECK(reward_vnd >= 0),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_scores (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT DEFAULT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS guild_game_channels (
  guild_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, game_id)
);

CREATE TABLE IF NOT EXISTS wordchain_custom_words (
  word TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wordchain_stats (
  user_id TEXT PRIMARY KEY,
  correct_turns INTEGER NOT NULL DEFAULT 0,
  rounds_won INTEGER NOT NULL DEFAULT 0,
  best_chain INTEGER NOT NULL DEFAULT 0,
  total_vnd INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;
