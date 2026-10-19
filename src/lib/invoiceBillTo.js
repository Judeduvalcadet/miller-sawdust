// A mapped invoice retains the billing address saved in QuickBooks. Drafts
// without a saved accounting address use the current customer record.
export function invoiceBillTo(invoice,customer) {
  return invoice?.qb_bill_to ?? customer;
}
