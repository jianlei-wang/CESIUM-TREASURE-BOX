-- 浏览量服务（Cloudflare D1）数据结构
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  first_viewed_at TEXT NOT NULL DEFAULT '',
  last_viewed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS daily (
  date TEXT NOT NULL,
  case_id TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, case_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON daily (date);
CREATE INDEX IF NOT EXISTS idx_cases_views ON cases (views DESC);
