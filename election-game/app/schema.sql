-- Tomato poll: correct hits per politician per day (Israel time).
CREATE TABLE IF NOT EXISTS hits (
  day TEXT NOT NULL,      -- YYYY-MM-DD, Asia/Jerusalem
  speaker TEXT NOT NULL,  -- caricature id, see assets/caricatures/cast.json
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, speaker)
);
