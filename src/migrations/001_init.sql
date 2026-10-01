-- Multi-tenant core: every business table carries company_id.
CREATE TABLE companies (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'trial',
  trial_ends  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'counter')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token       text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE locations (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE items (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku         text NOT NULL,
  name        text NOT NULL,
  unit        text NOT NULL DEFAULT 'pcs',
  price       numeric(14,2) NOT NULL DEFAULT 0,
  system_qty  numeric(14,3) NOT NULL DEFAULT 0,
  location_id bigint REFERENCES locations(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

-- One physical QR label. The QR encodes "OPN:<code>".
CREATE TABLE tags (
  code        text PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id     bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id bigint REFERENCES locations(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_item_idx ON tags (item_id);

CREATE TABLE stocktakes (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  location_id bigint REFERENCES locations(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  applied     boolean NOT NULL DEFAULT false
);

-- client_id makes offline sync idempotent: retries never double-count.
CREATE TABLE count_entries (
  id           bigserial PRIMARY KEY,
  stocktake_id bigint NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  item_id      bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_code     text REFERENCES tags(code) ON DELETE SET NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty >= 0),
  note         text,
  counted_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  counted_at   timestamptz NOT NULL DEFAULT now(),
  client_id    uuid NOT NULL UNIQUE,
  voided       boolean NOT NULL DEFAULT false
);
CREATE INDEX count_entries_st_idx ON count_entries (stocktake_id, item_id);
