-- Read-only, server-side paging. Ordinary caller permissions and existing
-- invoice/customer RLS policies apply; this never runs as a privileged owner.
create or replace function public.invoice_list_page(
  p_search text default '', p_status text default 'all',
  p_from date default null, p_to date default null,
  p_page integer default 1, p_page_size integer default 50
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with filtered as (
    select i.id, i.txn_date
    from public.invoices i
    left join public.customers c on c.id = i.customer_id
    where not coalesce(i.qb_archived, false)
      and (p_status is null or p_status = 'all' or i.status = p_status)
      and (p_from is null or i.txn_date >= p_from)
      and (p_to is null or i.txn_date <= p_to)
      and (coalesce(btrim(p_search), '') = '' or
        strpos(lower(concat_ws(' ', c.company_name, c.name, i.doc_number, i.note)), lower(btrim(p_search))) > 0)
  ), page_ids as (
    select * from filtered
    order by txn_date desc nulls last, id desc
    limit greatest(1, least(coalesce(p_page_size, 50), 100))
    offset (greatest(coalesce(p_page, 1), 1)::bigint - 1) * greatest(1, least(coalesce(p_page_size, 50), 100))
  ), page_rows as (
    select i.* from public.invoices i join page_ids p on p.id = i.id
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object('customer', to_jsonb(c)) order by p.txn_date desc nulls last, p.id desc)
      from page_rows p left join public.customers c on c.id = p.customer_id
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.invoice_list_page(text,text,date,date,integer,integer) from public, anon;
grant execute on function public.invoice_list_page(text,text,date,date,integer,integer) to authenticated;
grant execute on function public.invoice_list_page(text,text,date,date,integer,integer) to service_role;
notify pgrst, 'reload schema';
