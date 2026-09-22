import { Dialog, DialogContent } from '@/components/ui/dialog';
import { X } from 'lucide-react';

// The invoice template. Fixed layout — only the variables change: date,
// customer, addresses, line items, pricing. Used to preview imported
// QuickBooks invoices now and app-created invoices in the invoicing build.

const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function InvoiceTemplate({ invoice, customer, company }) {
  const lines = invoice.lines || [];
  const paid = invoice.status === 'paid';
  return (
    <div className="bg-white text-gray-900 p-8 text-sm" style={{ fontFamily: 'Georgia, serif' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          {/* The logo asset is white-on-black; inverted it prints black on the white paper. */}
          <img
            src="/logo.jpg"
            alt=""
            className="w-16 h-16 shrink-0"
            style={{ filter: 'invert(1)' }}
          />
          <div>
          <p className="text-xl font-bold tracking-tight">{company?.company_name || 'Miller Sawdust'}</p>
          <p className="text-gray-600 mt-1 leading-snug">
            {company?.street_address}<br />
            {[company?.city, company?.state].filter(Boolean).join(', ')} {company?.zip}<br />
            {company?.phone}{company?.email ? <><br />{company.email}</> : null}
          </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-widest text-gray-800">INVOICE</p>
          <table className="ml-auto mt-2 text-xs text-gray-600">
            <tbody>
              <tr><td className="pr-3 text-gray-400">Invoice #</td><td className="text-right font-medium text-gray-900">{invoice.doc_number || '—'}</td></tr>
              <tr><td className="pr-3 text-gray-400">Date</td><td className="text-right font-medium text-gray-900">{fmtDate(invoice.txn_date)}</td></tr>
              {invoice.due_date && <tr><td className="pr-3 text-gray-400">Due</td><td className="text-right font-medium text-gray-900">{fmtDate(invoice.due_date)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill to */}
      <div className="mt-6">
        <p className="text-[10px] uppercase tracking-widest text-gray-400">Bill To</p>
        <p className="font-semibold mt-0.5">{(customer?.company_name || customer?.name || 'Customer').trim()}</p>
        {customer?.name && customer?.company_name && customer.name.trim() !== customer.company_name.trim() && (
          <p className="text-gray-600">{customer.name}</p>
        )}
        <p className="text-gray-600">
          {[customer?.street_address, [customer?.city, customer?.state].filter(Boolean).join(', '), customer?.zip_code].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Lines */}
      <table className="w-full mt-6 border-t-2 border-gray-800">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-200">
            <th className="text-left py-2 font-medium">Item</th>
            <th className="text-right py-2 font-medium w-14">Qty</th>
            <th className="text-right py-2 font-medium w-24">Rate</th>
            <th className="text-right py-2 font-medium w-28">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-100 align-top">
              <td className="py-2 pr-3">
                <p className="font-medium">{l.name || '—'}</p>
                {l.description && l.description !== l.name && <p className="text-xs text-gray-500">{l.description}</p>}
              </td>
              <td className="py-2 text-right">{l.qty ?? 1}</td>
              <td className="py-2 text-right">{money(l.unit_price)}</td>
              <td className="py-2 text-right font-medium">{money(l.amount)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td colSpan={4} className="py-4 text-center text-gray-400 italic">No line detail on this invoice</td></tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mt-4">
        <div className="w-56 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Total</span>
            <span className="font-bold">{money(invoice.total)}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-200 pt-1.5">
            <span className="text-gray-500">Balance due</span>
            <span className={paid ? 'font-bold text-green-700' : 'font-bold text-amber-700'}>{money(invoice.balance)}</span>
          </div>
        </div>
      </div>

      {paid && (
        <p className="mt-4 inline-block border-2 border-green-600 text-green-700 font-bold text-xs tracking-widest px-2 py-0.5 rounded rotate-[-3deg]">PAID</p>
      )}
      {invoice.source === 'quickbooks' && (
        <p className="mt-6 text-[10px] text-gray-400">Imported from QuickBooks{invoice.qb_id ? ` (QB #${invoice.qb_id})` : ''}</p>
      )}
    </div>
  );
}

export default function InvoicePreview({ open, onClose, invoice, customer, company }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 bg-white/90 border border-gray-200 rounded-full p-1.5 hover:bg-gray-100"
          aria-label="Close preview"
        >
          <X className="w-4 h-4 text-gray-600" />
        </button>
        {invoice && <InvoiceTemplate invoice={invoice} customer={customer} company={company} />}
      </DialogContent>
    </Dialog>
  );
}
