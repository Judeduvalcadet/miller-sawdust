const addressFields = ['name','company_name','street_address','city','state','zip_code','country','phone','email'];
export function snapshotAddress(customer) {
  return { ...Object.fromEntries(addressFields.map(key => [key, customer?.[key] || ''])), ...(Array.isArray(customer?.street_extra) ? {street_extra:[...customer.street_extra]} : {}) };
}
export function billingPayload(value, job, customers) {
  const delivery = customers.find(c => c.id === job.customer_id);
  if (value.unchanged && value.address) return {billing_mode:value.mode,billing_customer_id:value.mode === 'customer' ? value.customer_id : null,billing_address:snapshotAddress(value.address)};
  let address;
  if (value.mode === 'shipping') {
    address = snapshotAddress(delivery || {name:job.location_name});
    if (job.address) address = {...address,street_address:job.address,city:'',state:'',zip_code:'',country:'',street_extra:[]};
  } else if (value.mode === 'customer') {
    const customer = customers.find(c => c.id === value.customer_id);
    if (!customer) throw new Error('Select a billing customer.');
    address = snapshotAddress(customer);
  } else {
    address = snapshotAddress(value.address);
    if (!(address.name.trim() || address.company_name.trim()) || !address.street_address.trim()) throw new Error('Enter a billing name and street address.');
  }
  return {billing_mode:value.mode,billing_customer_id:value.mode === 'customer' ? value.customer_id : null,billing_address:address};
}
