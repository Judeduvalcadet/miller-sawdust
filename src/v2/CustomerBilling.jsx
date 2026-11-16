import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';
import { base44 } from '@/api/entities';
import { billingPayload } from '@/lib/invoiceBilling';
import { validateContactFields } from '@/lib/contactValidation';

export default function CustomerBilling({ customer, jobs }) {
  const cache = useQueryClient();
  const [value, setValue] = useState(customer.billing_preference || {mode:'shipping',customer_id:'',address:{}});
  const [saved, setSaved] = useState(false);
  const { data: customers = [], isPending, isError } = useQuery({queryKey:['v2-customers'],queryFn:() => base44.entities.Customer.list('name')});
  const job = jobs?.find(j => j.job_type === 'delivery' && j.status !== 'cancelled' && j.address);
  const shipping = job?.address || [customer.street_address,customer.city,customer.state,customer.zip_code].filter(Boolean).join(', ');
  const change = next => { setValue(next); setSaved(false); save.reset(); };
  const patch = (key, val) => change({...value,address:{...value.address,[key]:val}});
  const save = useMutation({
    mutationFn: async () => {
      const payload = billingPayload(value,{customer_id:customer.id,address:shipping},customers);
      if (value.mode === 'address') validateContactFields(payload.billing_address);
      const preference = value.mode === 'shipping' ? {mode:'shipping'} : value.mode === 'customer' ? {mode:'customer',customer_id:value.customer_id} : {mode:'address',address:payload.billing_address};
      return base44.entities.Customer.update(customer.id,{billing_preference:preference});
    },
    onSuccess: async () => { await cache.invalidateQueries({queryKey:['v2-customers']}); setSaved(true); },
  });
  return <div className="p-5 space-y-4">
    <fieldset disabled={save.isPending} className="space-y-4 min-w-0">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.mode === 'shipping'} onChange={e => change({...value,mode:e.target.checked ? 'shipping' : 'customer'})} /> Same as shipping</label>
      {value.mode === 'shipping' ? <div className="rounded-lg bg-gray-50 px-3 py-2.5">
        <p className="text-sm text-gray-900 whitespace-pre-line">{shipping || 'No shipping address yet.'}</p>
        <p className="text-xs text-gray-500 mt-1">{job ? `Job address (${job.scheduled_date}). Each invoice uses its own job’s address.` : 'Customer address shown until a job has a delivery address.'}</p>
      </div> : <>
        <p className="text-sm font-semibold">Billing address</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="billing-source" checked={value.mode === 'customer'} onChange={() => change({...value,mode:'customer'})} /> Use Existing Customer</label>
          <label className="flex items-center gap-2"><input type="radio" name="billing-source" checked={value.mode === 'address'} onChange={() => change({...value,mode:'address'})} /> New Billing Address</label>
        </div>
        {value.mode === 'customer' ? <>
          <SearchableSelect value={value.customer_id} onValueChange={id => change({...value,customer_id:id})} options={customers.map(c => ({value:c.id,label:[c.company_name,c.name,c.active === false ? '(past customer)' : ''].filter(Boolean).join(' - ')}))} placeholder="Type or search customer name..." />
          {value.customer_id && <p className="text-sm text-gray-600">{(() => {const c=customers.find(c => c.id === value.customer_id);return c && [c.street_address,c.city,c.state,c.zip_code].filter(Boolean).join(', ');})()}</p>}
        </> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input aria-label="Billing name" placeholder="Name" value={value.address?.name || ''} onChange={e => patch('name',e.target.value)} />
          <Input aria-label="Billing company" placeholder="Company (optional)" value={value.address?.company_name || ''} onChange={e => patch('company_name',e.target.value)} />
          <div className="sm:col-span-2"><AddressAutocomplete value={value.address?.street_address || ''} onChange={v => patch('street_address',v)} onResolve={a => change({...value,address:{...value.address,street_address:a.street,city:a.city,state:a.state,zip_code:a.zip}})} placeholder="Billing street address" /></div>
          {['city','state','zip_code','email','phone'].map(key => <Input key={key} aria-label={`Billing ${key}`} placeholder={key.replace('_',' ')} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={value.address?.[key] || ''} onChange={e => patch(key,e.target.value)} />)}
        </div>}
      </>}
    </fieldset>
    {save.isError && <p role="alert" className="text-sm text-red-600">{save.error.message}</p>}
    {isError && <p role="alert" className="text-sm text-red-600">Could not load customers. Refresh before saving.</p>}
    <div className="flex items-center gap-3"><Button className="bg-gray-950 hover:bg-gray-800" disabled={save.isPending || isPending || isError} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save address'}</Button>{saved && <span role="status" className="text-sm text-gray-600">Address saved</span>}</div>
  </div>;
}
