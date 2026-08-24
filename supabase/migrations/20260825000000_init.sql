-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Products Catalog Table
create table products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  price_paise bigint not null check (price_paise >= 0),
  description text,
  category text not null,
  stock integer not null check (stock >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Checkouts Table (Internal record of checkout attempts)
create table checkouts (
  id uuid default gen_random_uuid() primary key,
  status text not null default 'STARTED' check (status in ('STARTED', 'PAID', 'EXPIRED', 'ABANDONED')),
  customer_email text,
  customer_phone text,
  preferred_channel text check (preferred_channel in ('EMAIL', 'WHATSAPP')),
  consent_given boolean default false not null,
  total_amount_paise bigint not null check (total_amount_paise >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Checkout Hashed Session Tokens (For secure customer checkout URL access)
create table checkout_sessions (
  id uuid default gen_random_uuid() primary key,
  checkout_id uuid not null references checkouts(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Checkout Items (Normalized snapshotted line items)
create table checkout_items (
  id uuid default gen_random_uuid() primary key,
  checkout_id uuid not null references checkouts(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name_snapshot text not null,
  unit_price_paise_snapshot bigint not null check (unit_price_paise_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table products enable row level security;
alter table checkouts enable row level security;
alter table checkout_sessions enable row level security;
alter table checkout_items enable row level security;

-- Row Level Security (RLS) Policies
-- Products: Read-only for the public
create policy "Allow public read access to products" on products
  for select using (true);

-- Checkouts, Sessions, Items: Restrict all direct client-side select/insert/update/delete.
-- Access is only permitted via database service_role/backend client queries.
create policy "Restrict checkouts to service role" on checkouts
  for all using (false);

create policy "Restrict checkout_sessions to service role" on checkout_sessions
  for all using (false);

create policy "Restrict checkout_items to service role" on checkout_items
  for all using (false);

-- Indexing for performance and lookup speed
create index idx_products_category on products(category);
create index idx_checkouts_status_created on checkouts(status, created_at);
create index idx_checkout_sessions_hash on checkout_sessions(session_token_hash);
create index idx_checkout_items_checkout_id on checkout_items(checkout_id);

-- Seed Products (10 items across 3 categories)
insert into products (name, price_paise, description, category, stock) values
-- Electronics
('ElectroSound Wireless Headphones', 899900, 'Premium over-ear noise-cancelling wireless headphones.', 'Electronics', 50),
('Quantum Charge Power Bank', 249900, '20000mAh fast charging compact portable power bank.', 'Electronics', 100),
('AeroFit Smartwatch v2', 1299900, 'Waterproof fitness tracker with heart rate and sleep monitor.', 'Electronics', 35),
('FlexiPod Mini Tripod', 159900, 'Flexible tabletop tripod with phone mount and Bluetooth shutter.', 'Electronics', 150),
-- Home & Kitchen
('BrewMaster Drip Coffee Maker', 499900, '12-cup programmable coffee maker with strength control.', 'Home & Kitchen', 20),
('ThermoGlow Insulated Flask', 189900, 'Double-walled stainless steel flask (1 Litre).', 'Home & Kitchen', 80),
('PureAir HEPA Air Purifier', 1499900, 'Ultra-quiet air purifier with true HEPA filter for medium rooms.', 'Home & Kitchen', 15),
-- Apparel & Accessories
('UrbanShield Anti-Theft Backpack', 399900, 'Water-resistant travel backpack with hidden pockets and USB port.', 'Apparel & Accessories', 60),
('Classic Cotton Crewneck Tee', 129900, 'Pack of 3 super soft breathable organic cotton t-shirts.', 'Apparel & Accessories', 200),
('SolVibe Polarized Sunglasses', 299900, 'UV400 protection unisex sunglasses with wooden temples.', 'Apparel & Accessories', 75);
