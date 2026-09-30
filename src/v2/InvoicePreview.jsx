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
          ctx.drawImage(img, 0, 0);
          // Invert pixel by pixel: ctx.filter = 'invert(1)' is silently
          // ignored by some browsers (Safari), which left the raw
          // white-on-black logo showing.
          const d = ctx.getImageData(0, 0, c.width, c.height);
          const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            px[i] = 255 - px[i];
            px[i + 1] = 255 - px[i + 1];
            px[i + 2] = 255 - px[i + 2];
          }
          ctx.putImageData(d, 0, 0);
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

// The small solid-green PAID badge that sits above the INVOICE label.
function PaidBadge({ scale = 1 }) {
  return (
    <span style={{
      display: 'inline-block',
      background: '#16a34a',
      border: `${Math.max(4 * scale, 3.5)}px solid #16a34a`,
      borderRadius: 8 * scale,
      color: '#ffffff',
      padding: `${5 * scale}px ${18 * scale}px`,
      fontFamily: OSWALD,
      fontWeight: 700,
      fontSize: 34 * scale,
      lineHeight: 1,
      letterSpacing: 4 * scale,
    }}>
      PAID
    </span>
  );
}

// The QuickBooks-style template supplied by the office: slate bars, one
// BILL TO block placed for a window envelope (do not move it), dated line
// items, floating TOTAL DUE bar. Mirrors invoicePdf.js pixel-for-pixel on an
// 816 x 1056 canvas.
const SLATE = '#7889a1';
const HELV = "Arial, Helvetica, sans-serif";

const fmt2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const slashDate = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
};

export function InvoiceTemplate({ invoice, customer, company }) {
  const logo = useInvertedLogo();
  const lines = invoice.lines || [];
  const paid = invoice.status === 'paid';
  const balance = paid ? 0 : (invoice.balance ?? invoice.total);
  const termsDays = invoice.txn_date && invoice.due_date
    ? Math.round((new Date(invoice.due_date) - new Date(invoice.txn_date)) / 86400000)
    : null;
  const coName = company?.company_name || 'Miller Sawdust';
  const custName = (customer?.company_name || customer?.name || 'Customer').trim();
  const custCityLine = [[customer?.city, customer?.state].filter(Boolean).join(', '), customer?.zip_code]
    .filter(Boolean).join('\u2002');
  const rows = lines.length ? lines : [{ name: 'No line detail on this invoice', qty: null, unit_price: null, amount: null }];

  const barStyle = (top, height) => ({
    position: 'absolute', left: 494, width: 297, top, height,
    background: SLATE, color: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 9, boxSizing: 'border-box',
  });

  return (
    <div
      style={{
        width: 816, height: 1056, background: '#fff', color: '#000',
        fontFamily: HELV, fontSize: 13.5, position: 'relative',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      }}
    >
      {/* Big diagonal PAID stamp */}
      {paid && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{
            transform: 'rotate(-30deg)', border: '10px solid #16a34a', borderRadius: 16,
            color: '#16a34a', padding: '10px 56px', fontFamily: OSWALD, fontWeight: 700,
            fontSize: 150, lineHeight: 1, letterSpacing: 12, opacity: 0.35,
          }}>
            PAID
          </div>
        </div>
      )}

      {/* Company block */}
      <div style={{ position: 'absolute', left: 65, top: 48, lineHeight: '18px' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{coName}</div>
        {company?.street_address && <div>{company.street_address}</div>}
        {(company?.city || company?.zip) && (
          <div>{[company?.city, company?.state].filter(Boolean).join(', ')}{'\u2002'}{company?.zip}</div>
        )}
        {company?.phone && <div>{company.phone}</div>}
        {company?.email && <div>{company.email}</div>}
      </div>

      {/* Logo + wordmark */}
      {logo && <img src={logo} alt="" style={{ position: 'absolute', left: 562, top: 50, width: 101, height: 101 }} />}
      <div style={{ position: 'absolute', left: 612, top: 156, transform: 'translateX(-50%)', fontFamily: OSWALD, fontWeight: 700, fontSize: 17, letterSpacing: 1, whiteSpace: 'nowrap' }}>
        MILLER SAWDUST
      </div>

      {/* BILL TO — window-envelope position */}
      <div style={{ position: 'absolute', left: 65, top: 218, lineHeight: '18.5px' }}>
        <div style={{ fontWeight: 700 }}>BILL TO</div>
        <div>{custName}</div>
        {customer?.street_address && <div>{customer.street_address}</div>}
        {custCityLine && <div>{custCityLine}</div>}
      </div>

      {/* Right info bars */}
      <div style={barStyle(208, 38)}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>INVOICE {invoice.doc_number || ''}</span>
      </div>
      <div style={{ ...barStyle(260, 36), fontSize: 12.5 }}>
        <span style={{ fontWeight: 700 }}>DATE</span>
        <span style={{ marginLeft: 5 }}>{slashDate(invoice.txn_date)}</span>
        {termsDays > 0 && (
          <span style={{ position: 'absolute', left: 124 }}>
            <span style={{ fontWeight: 700 }}>TERMS</span>
            <span style={{ marginLeft: 5 }}>Net {termsDays}</span>
          </span>
        )}
      </div>
      <div style={{ ...barStyle(309, 35), fontSize: 12.5 }}>
        <span style={{ fontWeight: 700 }}>DUE DATE</span>
        <span style={{ marginLeft: 5 }}>{slashDate(invoice.due_date)}</span>
      </div>

      {/* Left divider bar */}
      <div style={{ position: 'absolute', left: 24, top: 336, width: 460, height: 8, background: SLATE }} />

      {paid && (
        <div style={{ position: 'absolute', left: 742, top: 174, transform: 'translateX(-50%)' }}>
          <PaidBadge scale={0.45} />
        </div>
      )}

      {/* Items + totals flow */}
      <div style={{ position: 'absolute', left: 24, top: 409, width: 767 }}>
        {/* table header */}
        <div style={{ background: SLATE, height: 29, display: 'grid', gridTemplateColumns: '41px 216px 145px 114px 129px 89px 1fr', alignItems: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>
          <span />
          <span>DATE</span>
          <span>DESCRIPTION</span>
          <span style={{ textAlign: 'right' }}>QTY</span>
          <span style={{ textAlign: 'right' }}>RATE</span>
          <span style={{ textAlign: 'right' }}>AMOUNT</span>
          <span />
        </div>
        {rows.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'grid', gridTemplateColumns: '41px 216px 145px 114px 129px 89px 1fr',
              padding: '9px 0', lineHeight: '16.3px',
              borderBottom: i < rows.length - 1 ? '1px solid #d9dce1' : 'none',
            }}
          >
            <span />
            <span>{!/surcharge/i.test(l.name || '') ? slashDate(invoice.txn_date) : ''}</span>
            <span style={{ maxWidth: 112 }}>{l.description && l.description !== l.name ? l.description : (l.name || '\u2014')}</span>
            <span style={{ textAlign: 'right' }}>{l.qty ?? ''}</span>
            <span style={{ textAlign: 'right' }}>{l.unit_price != null ? fmt2(l.unit_price) : ''}</span>
            <span style={{ textAlign: 'right' }}>{l.amount != null ? fmt2(l.amount) : ''}</span>
            <span />
          </div>
        ))}
        {/* total area */}
        <div style={{ position: 'relative', marginTop: 23, height: 40 }}>
          <div style={{ position: 'absolute', left: 7, top: 2, width: 400, lineHeight: '17px' }}>
            We appreciate your business and look forward to serving you again soon.
          </div>
          <div style={{ position: 'absolute', left: 420, right: 0, top: 0, height: 38, background: SLATE, color: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 13, boxSizing: 'border-box' }}>
            <span>TOTAL DUE</span>
            <span style={{ position: 'absolute', right: 23, fontWeight: 700, fontSize: 19 }}>${fmt2(balance)}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 994, textAlign: 'center', fontSize: 11.5 }}>
        Please add the invoice number on the check, Thank You.
      </div>
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
