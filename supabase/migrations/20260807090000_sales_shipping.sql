-- Capture the shipping fee on a sale so invoices match what the customer was
-- actually charged (e.g. a Shopify order's Total = subtotal - discount + shipping).
-- Previously shipping was dropped entirely, so Shopify-origin invoices under-
-- reported the total by the shipping amount.
--
-- Defaults to 0, so every existing sale and every manual (non-shipping) sale is
-- unaffected; only the Shopify webhook (and any future channel) populates it.
alter table public.sales
  add column if not exists shipping numeric(12, 2) not null default 0;
