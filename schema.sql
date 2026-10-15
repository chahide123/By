CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role    AS ENUM ('customer', 'courier', 'store_owner', 'admin');
CREATE TYPE order_status AS ENUM ('pending','accepted','preparing','ready','picked_up','on_the_way','delivered','cancelled');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role          user_role NOT NULL,
    full_name     TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    phone         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    vehicle_type  TEXT,
    is_available  BOOLEAN NOT NULL DEFAULT FALSE,
    last_lat      NUMERIC(9,6),
    last_lng      NUMERIC(9,6),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stores (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    category   TEXT NOT NULL CHECK (category IN ('food','grocery','pharmacy')),
    address    TEXT NOT NULL,
    lat        NUMERIC(9,6) NOT NULL,
    lng        NUMERIC(9,6) NOT NULL,
    is_open    BOOLEAN NOT NULL DEFAULT TRUE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    image_url    TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL REFERENCES users(id),
    store_id         UUID REFERENCES stores(id),          -- NULL = طلب "أي شيء"
    courier_id       UUID REFERENCES users(id),
    status           order_status NOT NULL DEFAULT 'pending',
    items            JSONB NOT NULL DEFAULT '[]',
    subtotal         NUMERIC(10,2) NOT NULL DEFAULT 0,
    delivery_fee     NUMERIC(10,2) NOT NULL DEFAULT 0,
    total            NUMERIC(10,2) NOT NULL DEFAULT 0,
    delivery_address TEXT NOT NULL,
    pickup_address   TEXT,
    description      TEXT,
    delivery_lat     NUMERIC(9,6),
    delivery_lng     NUMERIC(9,6),
    payment_method   TEXT NOT NULL DEFAULT 'cash',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (store_id IS NOT NULL OR (description IS NOT NULL AND pickup_address IS NOT NULL))
);

CREATE TABLE order_tracking (
    id          BIGSERIAL PRIMARY KEY,
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status      order_status,
    courier_lat NUMERIC(9,6),
    courier_lng NUMERIC(9,6),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stores_owner    ON stores(owner_id);
CREATE INDEX idx_stores_cat      ON stores(category) WHERE is_active;
CREATE INDEX idx_products_store  ON products(store_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_store    ON orders(store_id);
CREATE INDEX idx_orders_courier  ON orders(courier_id);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_tracking_order  ON order_tracking(order_id, created_at DESC);
