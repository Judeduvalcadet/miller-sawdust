import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Download } from 'lucide-react';

// The invoice template: US Letter (816 x 1056 px at 96dpi), Oswald for the
// company name, Lato for everything else. All text black; the only fills are
// the Amount-due band and hairline rules. Used by the preview dialog and the
// PDF saver (one page per invoice).

const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const INK = '#000000';
const BAND = '#dedede';
const RULE = '#cccccc';

// The logo asset is white-on-black. The template needs it black-on-white, and
// the PDF renderer (html2canvas) can't apply CSS filters, so it is inverted
// once through a canvas and served everywhere as a data URL.
let invertedLogoUrl = null;
let invertedLogoPromise = null;
export function ensureInvertedLogo() {
  if (invertedLogoUrl) return Promise.resolve(invertedLogoUrl);
  if (!invertedLogoPromise) {
    invertedLogoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.filter = 'invert(1)';
          ctx.drawImage(img, 0, 0);
          invertedLogoUrl = c.toDataURL('image/png');
        } catch {
          invertedLogoUrl = '/logo.jpg';
        }
        resolve(invertedLogoUrl);
      };
      img.onerror = () => { invertedLogoUrl = '/logo.jpg'; resolve(invertedLogoUrl); };
      img.src = '/logo.jpg';
    });
  }
  return invertedLogoPromise;
}
function useInvertedLogo() {
  const [url, setUrl] = useState(invertedLogoUrl);
  useEffect(() => {
    if (!url) ensureInvertedLogo().then(setUrl);
  }, [url]);
  return url;
}
const LATO = "'Lato', system-ui, -apple-system, 'Segoe UI', sans-serif";
const OSWALD = "'Oswald', 'Lato', sans-serif";

const label = { fontSize: 11, letterSpacing: '1.8px', textTransform: 'uppercase' };
const num = { textAlign: 'right' };
const itemGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 64px 104px 112px', gap: 16 };

export function InvoiceTemplate({ invoice, customer, company }) {
  const logo = useInvertedLogo();
  const lines = invoice.lines || [];
  const paid = invoice.status === 'paid';
  const subtotal = lines.length
    ? lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    : Number(invoice.total) || 0;
  const balance = paid ? 0 : (invoice.balance ?? invoice.total);
  const termsDays = invoice.txn_date && invoice.due_date
    ? Math.round((new Date(invoice.due_date) - new Date(invoice.txn_date)) / 86400000)
    : null;

  const coName = company?.company_name || 'Miller Sawdust';
  const custName = (customer?.company_name || customer?.name || 'Customer').trim();
  const custPerson = customer?.name && customer?.company_name && customer.name.trim() !== customer.company_name.trim()
    ? customer.name.trim() : null;
  const custCityLine = [[customer?.city, customer?.state].filter(Boolean).join(', '), customer?.zip_code]
    .filter(Boolean).join(' ');

  const addressBlock = (
    <div>
      <div style={{ fontSize: 15, marginBottom: 2 }}>{custName}</div>
      {custPerson && <div>{custPerson}</div>}
      {customer?.street_address && <div>{customer.street_address}</div>}
      {custCityLine && <div>{custCityLine}</div>}
    </div>
  );

  return (
    <div
      style={{
        width: 816,
        height: 1056,
        padding: '44px 52px 40px',
        background: '#ffffff',
        color: INK,
        fontFamily: LATO,
        fontWeight: 400,
        fontVariantNumeric: 'tabular-nums lining-nums',
        display: 'flex',
        flexDirection: 'column',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {logo
            ? <img src={logo} alt="" style={{ width: 132, height: 132, display: 'block' }} />
            : <div style={{ width: 132, height: 132 }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h1 style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: '0.4px', margin: 0 }}>
              {coName}
            </h1>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              {company?.street_address && <div>{company.street_address}</div>}
              {(company?.city || company?.zip) && (
                <div>{[company?.city, company?.state].filter(Boolean).join(', ')} {company?.zip}</div>
              )}
              {company?.phone && <div>{company.phone}</div>}
              {company?.email && <div>{company.email}</div>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', paddingBottom: 2 }}>
          <div style={{ fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase' }}>Invoice</div>
          <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: '0.5px' }}>No. {invoice.doc_number || '—'}</div>
        </div>
      </header>

      <div style={{ height: 1, background: RULE, margin: '24px 0 22px' }} />

      {/* Bill to / Ship to / Details */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 28, fontSize: 13.5, lineHeight: 1.55 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={label}>Bill to</div>
          {addressBlock}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={label}>Ship to</div>
          {addressBlock}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={label}>Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Issued</span><span>{fmtDate(invoice.txn_date)}</span></div>
            {invoice.due_date && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Due</span><span>{fmtDate(invoice.due_date)}</span></div>
            )}
            {termsDays > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Terms</span><span>Net {termsDays}</span></div>
            )}
          </div>
        </div>
      </section>

      {/* Amount due band */}
      <section style={{ marginTop: 26, padding: '18px 24px', background: BAND, borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={label}>Amount due</div>
          <div style={{ fontSize: 13.5 }}>
            {paid ? 'Paid in full' : invoice.due_date ? `Payable by ${fmtDate(invoice.due_date)}` : 'Due on receipt'}
          </div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: '0.3px', lineHeight: 1, alignSelf: 'center' }}>{money(balance)}</div>
      </section>

      {/* Line items */}
      <section style={{ marginTop: 28, display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...itemGrid, paddingBottom: 10, borderBottom: `1px solid ${INK}`, ...label }}>
          <div>Description</div>
          <div style={num}>Qty</div>
          <div style={num}>Rate</div>
          <div style={num}>Amount</div>
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{ ...itemGrid, padding: '14px 0', borderBottom: `1px solid ${RULE}`, fontSize: 14, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div>{l.name || '—'}</div>
              {l.description && l.description !== l.name && <div style={{ fontSize: 12.5 }}>{l.description}</div>}
            </div>
            <div style={num}>{l.qty ?? 1}</div>
            <div style={num}>{money(l.unit_price)}</div>
            <div style={num}>{money(l.amount)}</div>
          </div>
        ))}
        {lines.length === 0 && (
          <div style={{ padding: '14px 0', borderBottom: `1px solid ${RULE}`, fontSize: 14 }}>
            No line detail on this invoice
          </div>
        )}
      </section>

      {/* Note + totals */}
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 28 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 380 }}>
          {invoice.note && (
            <>
              <div style={{ ...label, marginBottom: 4 }}>Note</div>
              <div>{invoice.note}</div>
            </>
          )}
        </div>
        <div style={{ width: 296, display: 'flex', flexDirection: 'column', fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
            <span>Subtotal</span><span>{money(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
            <span>Total</span><span>{money(invoice.total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 0', marginTop: 6, borderTop: `1px solid ${INK}` }}>
            <span>Balance due</span><span style={{ fontSize: 20 }}>{money(balance)}</span>
          </div>
        </div>
      </div>

      <div style={{ flexGrow: 1 }} />

      {/* Footer */}
      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 20, borderTop: `1px solid ${RULE}`, fontSize: 12.5, lineHeight: 1.6 }}>
        <div>
          <div style={{ fontSize: 13.5 }}>Thank you for your business.</div>
          {company?.phone && <div>Questions about this invoice? Call {company.phone}.</div>}
          {invoice.source === 'quickbooks' && (
            <div style={{ fontSize: 10.5, color: '#666' }}>Imported from QuickBooks{invoice.qb_id ? ` (QB #${invoice.qb_id})` : ''}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>Invoice {invoice.doc_number || '—'} · Page 1 of 1</div>
      </footer>
    </div>
  );
}

export default function InvoicePreview({ open, onClose, invoice, customer, company, onPrint }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[864px] p-0 overflow-hidden max-h-[92vh] overflow-y-auto bg-gray-100">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 bg-white/90 border border-gray-200 rounded-full p-1.5 hover:bg-gray-100"
          aria-label="Close preview"
        >
          <X className="w-4 h-4 text-gray-600" />
        </button>
        <div className="p-6 flex justify-center">
          <div className="shadow-lg" style={{ width: 816 }}>
            {invoice && <InvoiceTemplate invoice={invoice} customer={customer} company={company} />}
          </div>
        </div>
        {onPrint && invoice && (
          <div className="sticky bottom-0 border-t border-gray-200 px-5 py-3 flex justify-end bg-white">
            <Button size="sm" className="bg-gray-950 hover:bg-gray-800" onClick={onPrint}>
              <Download className="w-4 h-4 mr-2" /> Save PDF
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
