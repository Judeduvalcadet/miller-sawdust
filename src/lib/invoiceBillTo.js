// App invoices retain their selected billing snapshot. Legacy invoices retain
// their QuickBooks address, falling back to the customer only without a snapshot.
export function invoiceBillTo(invoice,customer) {
  return invoice?.billing_address ?? invoice?.qb_bill_to ?? customer;
}
