import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';

export default function InvoiceBilling({ value, onChange, customers, shipping }) {
  const patch = (key, val) => onChange({ ...value, address: { ...value.address, [key]: val } });
  return <section className="mb-4 rounded-lg border border-gray-200 p-4 space-y-3">
    <p className="text-sm font-semibold">Billing address</p>
    <p className="text-xs text-gray-500">Ship to: {shipping || 'Job delivery address'}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.mode === 'shipping'} onChange={(e) => onChange({ ...value, mode: e.target.checked ? 'shipping' : 'customer' })} /> Same as shipping</label>
    {value.mode !== 'shipping' && <>
      <div className="flex gap-4 text-sm">
        <label><input type="radio" checked={value.mode === 'customer'} onChange={() => onChange({ ...value, mode: 'customer' })} /> Select existing customer</label>
        <label><input type="radio" checked={value.mode === 'address'} onChange={() => onChange({ ...value, mode: 'address' })} /> Add new billing address</label>
      </div>
      {value.mode === 'customer' ? <SearchableSelect value={value.customer_id} onValueChange={(id) => onChange({ ...value, customer_id: id })} options={customers.map(c => ({value:c.id,label:c.company_name || c.name}))} placeholder="Select billing customer..." /> :
        <div className="grid grid-cols-2 gap-3">
          <Input aria-label="Billing name" placeholder="Name" value={value.address?.name || ''} onChange={e => patch('name', e.target.value)} />
          <Input aria-label="Billing company" placeholder="Company (optional)" value={value.address?.company_name || ''} onChange={e => patch('company_name', e.target.value)} />
          <div className="col-span-2"><AddressAutocomplete value={value.address?.street_address || ''} onChange={v => patch('street_address', v)} onResolve={a => onChange({...value, address:{...value.address, street_address:a.street,city:a.city,state:a.state,zip_code:a.zip}})} placeholder="Billing street address" /></div>
          {['city','state','zip_code','email','phone'].map(key => <Input key={key} aria-label={`Billing ${key}`} placeholder={key.replace('_',' ')} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={value.address?.[key] || ''} onChange={e => patch(key,e.target.value)} />)}
        </div>}
    </>}
    {value.mode === 'shipping' && <p className="text-xs text-gray-500">Uses this job’s delivery address. Item prices remain saved to the delivery customer.</p>}
  </section>;
}
