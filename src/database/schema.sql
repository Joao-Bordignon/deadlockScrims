-- Times
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  captain_discord_id VARCHAR(50) NOT NULL,
  role_id VARCHAR(50),
  category_id VARCHAR(50),
  channel_chat_id VARCHAR(50),
  channel_agenda_id VARCHAR(50),
  channel_historico_id VARCHAR(50),
  channel_lineup_id VARCHAR(50),
  channel_propostas_id VARCHAR(50),
  suspended_until TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Jogadores
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  discord_id VARCHAR(50),
  discord_username VARCHAR(100),
  is_captain BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Disponibilidades semanais
CREATE TABLE IF NOT EXISTS availabilities (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0=domingo, 1=segunda ... 6=sabado
  hour INTEGER NOT NULL, -- 18, 19, 20, 21, 22, 23
  is_blocked BOOLEAN DEFAULT FALSE, -- bloqueado por scrim confirmada
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, week_start, day_of_week, hour)
);

-- Horários fixos (template semanal recorrente)
CREATE TABLE IF NOT EXISTS recurring_availability (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  PRIMARY KEY (team_id, day_of_week, hour)
);

-- Scrims
CREATE TABLE IF NOT EXISTS scrims (
  id SERIAL PRIMARY KEY,
  team_home_id INTEGER REFERENCES teams(id), -- time que propôs
  team_away_id INTEGER REFERENCES teams(id), -- time que recebeu a proposta
  scheduled_at TIMESTAMPTZ NOT NULL,
  week_start DATE,
  day_of_week INTEGER,
  hour INTEGER,
  status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, cancelled, expired
  proposed_by VARCHAR(50),
  expires_at TIMESTAMPTZ,
  proposal_message_id VARCHAR(50),
  proposal_channel_id VARCHAR(50),
  reminder_sent BOOLEAN DEFAULT FALSE,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico de partidas
CREATE TABLE IF NOT EXISTS match_history (
  id SERIAL PRIMARY KEY,
  scrim_id INTEGER REFERENCES scrims(id),
  team_id INTEGER REFERENCES teams(id),
  result VARCHAR(10) NOT NULL, -- vitoria, derrota
  match_code VARCHAR(50),
  screenshot_url TEXT,
  registered_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);
