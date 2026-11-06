-- ═══════════════════════════════════════════════════════════════
-- MELIO — Frigider Familiar: Schema Supabase
-- Rulează în Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Gospodării (households) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS households (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(6)  UNIQUE NOT NULL,
  name        VARCHAR(100) DEFAULT 'Casa mea',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Membrii gospodăriei ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS household_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_name    VARCHAR(50) NOT NULL,
  user_avatar  VARCHAR(10) DEFAULT '👤',
  fcm_token    TEXT,
  joined_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Lista de cumpărături ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS shopping_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  emoji        VARCHAR(10)  DEFAULT '🛒',
  quantity     VARCHAR(50),
  added_by     VARCHAR(50)  NOT NULL,
  checked      BOOLEAN      DEFAULT FALSE,
  checked_by   VARCHAR(50),
  checked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 4. Mesaje chat de familie ────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_name    VARCHAR(50) NOT NULL,
  user_avatar  VARCHAR(10) DEFAULT '👤',
  message      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Indecși pentru performanță ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_households_code
  ON households(code);

CREATE INDEX IF NOT EXISTS idx_shopping_household
  ON shopping_items(household_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_members_household
  ON household_members(household_id);

CREATE INDEX IF NOT EXISTS idx_chat_household
  ON chat_messages(household_id, created_at ASC);

-- ── 6. Activare Supabase Realtime (idempotent — nu da eroare la re-rulare) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='shopping_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE shopping_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='household_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE household_members;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END $$;

-- ── 7. Row Level Security (RLS) — dezactivat pentru simplitate ──
-- Securitatea e gestionată prin service_key pe backend
-- (nu expunem cheile în frontend pentru operații de scriere)
ALTER TABLE households        DISABLE ROW LEVEL SECURITY;
ALTER TABLE household_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_items    DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     DISABLE ROW LEVEL SECURITY;

-- ── Verificare ──────────────────────────────────────────────────
SELECT 'Schema Melio Frigider instalată cu succes! ✅' AS status;

-- ── 7. "Cumpăr mai târziu" (v3) ─────────────────────────────────
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS later BOOLEAN DEFAULT FALSE;
