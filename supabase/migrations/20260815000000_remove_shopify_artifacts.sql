-- Draft migration: remove Shopify-specific schema artifacts after the app code has been removed.
-- IMPORTANT: This file is intentionally not executed yet; it is for review before approval.

BEGIN;

DO $$
DECLARE
  v_placeholder_id uuid;
  v_fallback_id uuid;
BEGIN
  -- Find the generic placeholder customer row created by the Shopify migration.
  SELECT id INTO v_placeholder_id
  FROM public.customers
  WHERE is_system = true
  ORDER BY created_at ASC
  LIMIT 1;

  -- Choose a non-Shopify customer to reassign any sales or references, if one exists.
  SELECT id INTO v_fallback_id
  FROM public.customers
  WHERE is_system IS NOT TRUE OR is_system IS NULL
  ORDER BY created_at DESC, full_name ASC
  LIMIT 1;

  -- If the placeholder row is still present, clear the pointer from Shopify settings
  -- before deleting it below. If the table is already gone, this is a no-op.
  IF v_placeholder_id IS NOT NULL THEN
    UPDATE public.shopify_settings
    SET system_customer_id = NULL
    WHERE system_customer_id = v_placeholder_id;
  END IF;

  -- Reassign any sales that still point at the placeholder customer to a real customer.
  -- If no valid fallback exists, abort so no destructive action runs silently.
  IF v_placeholder_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.sales WHERE customer_id = v_placeholder_id) AND v_fallback_id IS NULL THEN
      RAISE EXCEPTION 'Cannot remove Shopify placeholder customer: sales still reference it and no fallback customer was found.';
    END IF;

    UPDATE public.sales
    SET customer_id = v_fallback_id
    WHERE customer_id = v_placeholder_id AND v_fallback_id IS NOT NULL;
  END IF;
END $$;

-- Drop the Shopify-specific customer flags once the placeholder row has been cleaned up.
ALTER TABLE public.customers DROP COLUMN IF EXISTS shopify_customer_id;
ALTER TABLE public.customers DROP COLUMN IF EXISTS is_shopify_customer;

-- Remove the placeholder customer row after reassigning linked sales.
DELETE FROM public.customers
WHERE is_system = true;

ALTER TABLE public.customers DROP COLUMN IF EXISTS is_system;

-- Remove the Shopify order idempotency key from sales.
ALTER TABLE public.sales DROP COLUMN IF EXISTS shopify_order_id;

-- Remove the Shopify integration configuration table.
DROP TABLE IF EXISTS public.shopify_settings;

COMMIT;
