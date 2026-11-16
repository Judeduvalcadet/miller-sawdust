-- Run against the local sandbox inside a transaction. Every fixture is rolled back.
begin;
select set_config('request.jwt.claims','',true);
insert into public.customers(id,name) values ('10000000-0000-4000-8000-000000000001','Pricing regression fixture');
insert into public.items(id,name) values ('10000000-0000-4000-8000-000000000002','Pricing regression item');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','app_role','admin','amr','password','sub',(select id from public.drivers where role='admin' and active limit 1))::text,true);
set local role authenticated;
insert into public.invoices(id,customer_id,source,lines) values
('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','app','[{"item_id":"10000000-0000-4000-8000-000000000002","unit_price":100,"qty":1}]');
insert into public.invoices(id,customer_id,source,lines) values
('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','app','[{"item_id":"10000000-0000-4000-8000-000000000002","unit_price":125,"qty":1}]');
-- Edit quantity on the older invoice; do not restore its old negotiated rate.
update public.invoices set lines='[{"item_id":"10000000-0000-4000-8000-000000000002","unit_price":100,"qty":2}]' where id='10000000-0000-4000-8000-000000000003';
do $$ begin
 if (select price from public.customer_item_prices where customer_id='10000000-0000-4000-8000-000000000001') is distinct from 125 then raise exception 'Quantity edit reset saved price'; end if;
 if (select (lines->0->>'unit_price')::numeric from public.invoices where id='10000000-0000-4000-8000-000000000003') <>100 then raise exception 'Historical price changed'; end if;
end $$;
update public.invoices set lines='[{"item_id":"10000000-0000-4000-8000-000000000002","unit_price":150,"qty":2}]' where id='10000000-0000-4000-8000-000000000003';
do $$ begin
 if (select price from public.customer_item_prices where customer_id='10000000-0000-4000-8000-000000000001') is distinct from 150 then raise exception 'Changed price not remembered'; end if;
 if (select (lines->0->>'unit_price')::numeric from public.invoices where id='10000000-0000-4000-8000-000000000004') <>125 then raise exception 'Other invoice changed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.invoices set lines='[{"item_id":"10000000-0000-4000-8000-000000000002","unit_price":999,"qty":1}]' where id='10000000-0000-4000-8000-000000000004';
do $$ begin
 if (select price from public.customer_item_prices where customer_id='10000000-0000-4000-8000-000000000001') is distinct from 150 then raise exception 'Server import changed negotiated rate'; end if;
end $$;
rollback;
