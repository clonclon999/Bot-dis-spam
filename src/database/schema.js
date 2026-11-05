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
  extra_channels TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS noitu_rooms (
  room_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  board_message_id TEXT DEFAULT NULL,
  host_id TEXT NOT NULL,
  host_name TEXT NOT NULL DEFAULT '',
  guest_id TEXT DEFAULT NULL,
  guest_name TEXT DEFAULT NULL,
  invited_user_id TEXT DEFAULT NULL,
  status TEXT NOT NULL CHECK(status IN ('waiting', 'playing', 'finished', 'cancelled', 'aborted_restart')),
  current_turn_user_id TEXT DEFAULT NULL,
  current_word TEXT DEFAULT NULL,
  required_prefix TEXT DEFAULT NULL,
  used_words_json TEXT NOT NULL DEFAULT '[]',
  turn_count INTEGER NOT NULL DEFAULT 0,
  turn_timeout_sec INTEGER NOT NULL DEFAULT 30,
  turn_deadline_at INTEGER DEFAULT NULL,
  winner_id TEXT DEFAULT NULL,
  loser_id TEXT DEFAULT NULL,
  end_reason TEXT DEFAULT NULL,
  reward_vnd INTEGER NOT NULL DEFAULT 0,
  streak_bonus_vnd INTEGER NOT NULL DEFAULT 0,
  reward_paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER DEFAULT NULL,
  ended_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_noitu_rooms_status ON noitu_rooms (status);
CREATE INDEX IF NOT EXISTS idx_noitu_rooms_guild_chan ON noitu_rooms (guild_id, channel_id, status);

CREATE TABLE IF NOT EXISTS noitu_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL UNIQUE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT DEFAULT NULL,
  loser_id TEXT DEFAULT NULL,
  end_reason TEXT NOT NULL,
  total_turns INTEGER NOT NULL DEFAULT 0,
  last_word TEXT DEFAULT NULL,
  words_json TEXT NOT NULL DEFAULT '[]',
  base_reward_vnd INTEGER NOT NULL DEFAULT 0,
  streak_bonus_vnd INTEGER NOT NULL DEFAULT 0,
  total_reward_vnd INTEGER NOT NULL DEFAULT 0,
  winner_streak_after INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_noitu_matches_time ON noitu_matches (ended_at DESC);

CREATE TABLE IF NOT EXISTS noitu_stats (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  total_matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_turns_played INTEGER NOT NULL DEFAULT 0,
  total_vnd_earned INTEGER NOT NULL DEFAULT 0,
  last_match_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_noitu_stats_wins ON noitu_stats (wins DESC, best_streak DESC);
CREATE INDEX IF NOT EXISTS idx_noitu_stats_streak ON noitu_stats (best_streak DESC, wins DESC);
CREATE INDEX IF NOT EXISTS idx_noitu_stats_active ON noitu_stats (total_matches DESC, wins DESC);

-- 17. Phiên Đặt Cược Nhiều Người Chơi (Multiplayer Round System — PUBLIC START)
CREATE TABLE IF NOT EXISTS multiplayer_rounds (
  round_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT DEFAULT NULL,
  table_index INTEGER NOT NULL DEFAULT 1,
  game_id TEXT NOT NULL CHECK(game_id IN ('baucua', 'taixiu', 'race')),
  status TEXT NOT NULL CHECK(status IN ('WAITING', 'BETTING', 'LOCKED', 'DRAWING', 'SETTLING', 'COMPLETED', 'CANCELLED')),
  started_by TEXT NOT NULL,
  started_by_name TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL CHECK(duration_sec >= 5),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  locked_at INTEGER DEFAULT NULL,
  completed_at INTEGER DEFAULT NULL,
  cancelled_by TEXT DEFAULT NULL,
  cancel_reason TEXT DEFAULT NULL,
  result_json TEXT DEFAULT NULL,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0, 1)),
  refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded IN (0, 1)),
  total_players INTEGER NOT NULL DEFAULT 0 CHECK(total_players >= 0),
  total_bet_vnd INTEGER NOT NULL DEFAULT 0 CHECK(total_bet_vnd >= 0),
  total_payout_vnd INTEGER NOT NULL DEFAULT 0 CHECK(total_payout_vnd >= 0),
  total_won_vnd INTEGER NOT NULL DEFAULT 0 CHECK(total_won_vnd >= 0),
  total_lost_vnd INTEGER NOT NULL DEFAULT 0 CHECK(total_lost_vnd >= 0),
  notified_30s INTEGER NOT NULL DEFAULT 0 CHECK(notified_30s IN (0, 1)),
  notified_10s INTEGER NOT NULL DEFAULT 0 CHECK(notified_10s IN (0, 1)),
  notified_5s INTEGER NOT NULL DEFAULT 0 CHECK(notified_5s IN (0, 1)),
  auto_next_state TEXT NOT NULL DEFAULT 'NONE',
  next_round_at INTEGER DEFAULT NULL,
  next_round_id TEXT DEFAULT NULL,
  prev_round_id TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mp_rounds_active
  ON multiplayer_rounds (guild_id, game_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_rounds_history
  ON multiplayer_rounds (guild_id, game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_rounds_autonext
  ON multiplayer_rounds (auto_next_state, next_round_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_unique_active_table
  ON multiplayer_rounds (guild_id, game_id, table_index)
  WHERE status IN ('WAITING', 'BETTING', 'LOCKED', 'DRAWING', 'SETTLING');

-- 18. Danh Sách Vé Cược Cá Nhân Của Từng Phiên Chung (ACID + Chống Trả Thưởng/Hoàn Tiền Kép)
CREATE TABLE IF NOT EXISTS multiplayer_bets (
  bet_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  choice TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CANCELLED', 'SETTLED', 'REFUNDED')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout >= 0),
  net INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  settled_tx_done INTEGER NOT NULL DEFAULT 0 CHECK(settled_tx_done IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mp_bets_round_status
  ON multiplayer_bets (round_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_bets_round_user
  ON multiplayer_bets (round_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_bets_user_time
  ON multiplayer_bets (user_id, created_at DESC);

-- 19. Trạng Thái Tự Động Tạm Ngừng Khi Vắng Người Chơi (Auto Stop When No Players — Độc lập theo Server & Trò chơi)
CREATE TABLE IF NOT EXISTS multiplayer_idle_states (
  guild_id TEXT NOT NULL,
  game_id TEXT NOT NULL CHECK(game_id IN ('baucua', 'taixiu', 'race')),
  empty_streak INTEGER NOT NULL DEFAULT 0 CHECK(empty_streak >= 0),
  auto_paused INTEGER NOT NULL DEFAULT 0 CHECK(auto_paused IN (0, 1)),
  prev_auto_next_enabled INTEGER NOT NULL DEFAULT 1 CHECK(prev_auto_next_enabled IN (0, 1)),
  last_round_id TEXT DEFAULT NULL,
  last_counted_round_id TEXT DEFAULT NULL,
  paused_at INTEGER DEFAULT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, game_id)
);
`;
