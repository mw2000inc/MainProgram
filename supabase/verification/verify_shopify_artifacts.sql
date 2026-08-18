-- Verification-only script: inspect the live Supabase database for Shopify artifacts.
-- This script is non-destructive and intended to be run manually in the Supabase SQL editor.

-- 1) Placeholder customer rows and direct references
WITH placeholder_customers AS (
  SELECT
    c.id,
    c.full_name,
    c.company_name,
    c.email,
    c.contact_number,
    c.created_at,
    c.order_number
  FROM public.customers c
  WHERE c.is_system = true
)
SELECT
  'placeholder_customers' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(pc)) AS details
FROM placeholder_customers pc;

-- 2) Shopfiy settings table contents
SELECT
  'shopify_settings' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(s)) AS details
FROM public.shopify_settings s;

-- 3) Any sales tied to the placeholder customer
SELECT
  'sales_linked_to_placeholder_customer' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(s)) AS details
FROM public.sales s
JOIN public.customers c ON c.id = s.customer_id
WHERE c.is_system = true;

-- 4) Any contracts tied to the placeholder customer
SELECT
  'contracts_linked_to_placeholder_customer' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(ct)) AS details
FROM public.contracts ct
JOIN public.customers c ON c.id = ct.customer_id
WHERE c.is_system = true;

-- 5) Any remaining Shopify-specific columns still populated
SELECT
  'customers_is_system_populated' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(c)) AS details
FROM public.customers c
WHERE c.is_system IS TRUE;

SELECT
  'customers_shopify_customer_id_populated' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(c)) AS details
FROM public.customers c
WHERE c.shopify_customer_id IS NOT NULL;

SELECT
  'customers_is_shopify_customer_populated' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(c)) AS details
FROM public.customers c
WHERE c.is_shopify_customer IS TRUE;

SELECT
  'sales_shopify_order_id_populated' AS check_name,
  COUNT(*) AS affected_rows,
  jsonb_agg(to_jsonb(s)) AS details
FROM public.sales s
WHERE s.shopify_order_id IS NOT NULL;

-- 6) Optional defensive cross-check: if the table/columns do not exist, these will return a helpful error.
-- If a column is missing, that means it is already gone and there is nothing left to clean up.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'is_system'
  ) THEN
    RAISE NOTICE 'public.customers.is_system exists';
  ELSE
    RAISE NOTICE 'public.customers.is_system does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'shopify_customer_id'
  ) THEN
    RAISE NOTICE 'public.customers.shopify_customer_id exists';
  ELSE
    RAISE NOTICE 'public.customers.shopify_customer_id does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'is_shopify_customer'
  ) THEN
    RAISE NOTICE 'public.customers.is_shopify_customer exists';
  ELSE
    RAISE NOTICE 'public.customers.is_shopify_customer does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales'
      AND column_name = 'shopify_order_id'
  ) THEN
    RAISE NOTICE 'public.sales.shopify_order_id exists';
  ELSE
    RAISE NOTICE 'public.sales.shopify_order_id does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'shopify_settings'
  ) THEN
    RAISE NOTICE 'public.shopify_settings exists';
  ELSE
    RAISE NOTICE 'public.shopify_settings does not exist';
  END IF;
END $$;
