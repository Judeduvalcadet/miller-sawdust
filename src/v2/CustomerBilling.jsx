import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';
import { base44 } from '@/api/entities';
import { billingPayload } from '@/lib/invoiceBilling';
import { validateContactFields } from '@/lib/contactValidation';

export default function CustomerBilling({ customer, jobs, job: invoiceJob, initialPreference, exposeApi, disabled = false, onBusyChange }) {
  const cache = useQueryClient();
  const inputId = useId();
  const [savedValue, setSavedValue] = useState(initialPreference || customer.billing_preference || {mode:'shipping',customer_id:'',address:{}});
  const [value, setValue] = useState(savedValue);
  const [saved, setSaved] = useState(true);
  const { data: customers = [], isPending, isError } = useQuery({queryKey:['v2-customers'],queryFn:() => base44.entities.Customer.list('name')});
  const job = invoiceJob || jobs?.find(j => j.job_type === 'delivery' && j.status !== 'cancelled' && j.address);
  const shipping = job?.address || [customer.street_address,customer.city,customer.state,customer.zip_code].filter(Boolean).join(', ');
  const formatAddress = a => [a?.street_address,...(a?.street_extra || []),a?.city,a?.state,a?.zip_code].filter(Boolean).join(', ');
  const displayedShipping = value.unchanged && value.address ? formatAddress(value.address) : shipping;
  const change = next => { setValue({...next,unchanged:false}); setSaved(false); save.reset(); };
  const cancel = () => { setValue(savedValue); setSaved(true); save.reset(); };
  const patch = (key, val) => change({...value,address:{...value.address,[key]:val}});
  const getPayload = () => {
    if (isPending || isError) throw new Error('Wait for the billing details to load.');
    const payload = billingPayload(value,{...job,customer_id:customer.id,address:shipping},customers);
    if (value.mode === 'address' && !value.unchanged) validateContactFields(payload.billing_address);
    return payload;
  };
  const save = useMutation({
    mutationFn: async () => {
      const payload = getPayload();
      const preference = value.mode === 'shipping' ? {mode:'shipping'} : value.mode === 'customer' ? {mode:'customer',customer_id:value.customer_id} : {mode:'address',address:payload.billing_address};
      return base44.entities.Customer.update(customer.id,{billing_preference:preference});
    },
    onSuccess: async (updated) => { setSavedValue(updated.billing_preference); setValue(updated.billing_preference); await cache.invalidateQueries({queryKey:['v2-customers']}); setSaved(true); },
  });
  useEffect(() => { exposeApi?.({getPayload, useSnapshot:payload => {
    const snapshot = {mode:payload.billing_mode,customer_id:payload.billing_customer_id,address:payload.billing_address,unchanged:true};
    setValue(snapshot); setSavedValue(snapshot); setSaved(true);
  }, ready:!isPending && !isError, saveIfDirty:() => saved ? Promise.resolve() : save.mutateAsync()}); });
  useEffect(() => { onBusyChange?.(save.isPending); }, [save.isPending, onBusyChange]);
  return <div className="p-5 space-y-4">
    <fieldset disabled={disabled || save.isPending} className="space-y-4 min-w-0">
      <label htmlFor={`${inputId}-shipping`} className="flex items-center gap-3 text-sm font-medium text-gray-900 cursor-pointer">
        <Checkbox id={`${inputId}-shipping`} className="h-5 w-5 rounded-md border-gray-300 shadow-none focus-visible:ring-gray-400 data-[state=checked]:border-gray-950 data-[state=checked]:bg-gray-950 data-[state=checked]:text-white" checked={value.mode === 'shipping'} onCheckedChange={checked => change({...value,mode:checked === true ? 'shipping' : 'customer'})} />
        Same as shipping
      </label>
      {value.mode === 'shipping' ? <p className="text-sm text-gray-900 whitespace-pre-line">{displayedShipping || '-'}</p> : <>
        <RadioGroup aria-label="Billing address source" value={value.mode} onValueChange={mode => change({...value,mode})} disabled={disabled || save.isPending} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[['customer','Use Existing Customer'],['address','New Billing Address']].map(([mode,label]) => <label key={mode} htmlFor={`${inputId}-${mode}`} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-3 text-sm font-medium cursor-pointer transition-colors', value.mode === mode ? 'border-gray-950 bg-gray-50 text-gray-950' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
            <RadioGroupItem id={`${inputId}-${mode}`} value={mode} className="h-4 w-4 border-gray-400 text-gray-950 shadow-none focus-visible:ring-gray-400 data-[state=checked]:border-gray-950 [&_svg]:fill-gray-950 [&_svg]:h-2 [&_svg]:w-2" />
            {label}
          </label>)}
        </RadioGroup>
        {value.mode === 'customer' ? <>
          <SearchableSelect value={value.customer_id} onValueChange={id => change({...value,customer_id:id})} options={customers.map(c => ({value:c.id,label:[c.company_name,c.name,c.active === false ? '(past customer)' : ''].filter(Boolean).join(' - ')}))} placeholder="Type or search customer name..." />
          {value.customer_id && <p className="text-sm text-gray-600">{(() => {const c=customers.find(c => c.id === value.customer_id);return value.unchanged && value.address ? formatAddress(value.address) : formatAddress(c);})()}</p>}
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
    <div className="flex items-center gap-2">
    <Button className={cn('min-w-28', saved ? 'bg-gray-100 text-gray-400 disabled:opacity-100 shadow-none' : 'bg-gray-950 hover:bg-gray-800')} disabled={disabled || saved || save.isPending || isPending || isError} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : saved ? 'Saved' : 'Save Address'}</Button>
    {!saved && <Button variant="outline" disabled={disabled || save.isPending} onClick={cancel}>Cancel</Button>}
    </div>
  </div>;
}
