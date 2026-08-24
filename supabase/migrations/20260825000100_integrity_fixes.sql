-- Migration: fix checkout integrity and updated_at trigger
-- 1. Add ON DELETE RESTRICT to checkout_items.product_id foreign key
--    (products should not be silently deletable while referenced by financial records)
alter table checkout_items
  drop constraint checkout_items_product_id_fkey,
  add constraint checkout_items_product_id_fkey
    foreign key (product_id) references products(id) on delete restrict;

-- 2. Add updated_at auto-update trigger for checkouts table
create or replace function update_updated_at_column()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create trigger set_checkouts_updated_at
  before update on checkouts
  for each row
  execute function update_updated_at_column();

-- 3. Add partial index for storefront query (in-stock products by category)
create index idx_products_in_stock on products(category, name)
  where stock > 0;
