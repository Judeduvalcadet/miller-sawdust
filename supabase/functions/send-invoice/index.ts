// Send an invoice to the customer by email (Resend) or SMS (Twilio).
// Office sessions only (admin/assistant signed in with email+password).
//
// The client renders the letterhead PDF and posts it here as base64; this
// function stores the exact copy that was sent in the private `invoices`
// bucket, sends it out, and stamps the invoice row.
//
// Env:
//   RESEND_API_KEY, INVOICE_FROM_EMAIL       — email sending
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_FROM_NUMBER                       — SMS sending
//   INVOICE_SEND_DRY_RUN=true                — sandbox: do everything except
//                                              the external send
import { service, json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 30 // 30 days

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  const claims = await verifyAccessToken(req)
  if (!claims) return json(401, { error: 'unauthorized' })
  if (!['admin', 'assistant'].includes(String(claims.app_role)) || claims.amr !== 'password') {
    return json(403, { error: 'office_only' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_json' })
  }
  const invoiceId = String(body.invoice_id ?? '')
  const mode = String(body.mode ?? '')
  const to = String(body.to ?? '').trim()
  const pdfB64 = String(body.pdf_base64 ?? '')
  const filename = String(body.filename ?? 'invoice.pdf').replace(/[^\w .()-]/g, '')
  if (!invoiceId || !['email', 'sms'].includes(mode) || !to || !pdfB64) {
    return json(400, { error: 'missing_fields' })
  }
  if (mode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json(400, { error: 'bad_email' })
  }
  const phone = to.replace(/[^\d+]/g, '')
  if (mode === 'sms' && !/^\+?\d{10,15}$/.test(phone)) {
    return json(400, { error: 'bad_phone' })
  }

  const { data: invoice, error: invErr } = await service
    .from('invoices').select('id, doc_number, total, balance, status, customer_id')
    .eq('id', invoiceId).single()
  if (invErr || !invoice) return json(404, { error: 'invoice_not_found' })

  const { data: settingsRows } = await service.from('settings').select('company_profile').limit(1)
  const company = settingsRows?.[0]?.company_profile ?? {}
  const coName = company.company_name || 'Miller Sawdust'
  const coPhone = company.phone || ''
  const money = (v: unknown) =>
    Number(v ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  // Keep the exact PDF that went out, and a link the customer can open.
  const path = `${invoice.id}/${Date.now()}-${filename}`
  const { error: upErr } = await service.storage.from('invoices')
    .upload(path, b64ToBytes(pdfB64), { contentType: 'application/pdf', upsert: true })
  if (upErr) return json(500, { error: 'storage_upload_failed', detail: upErr.message })
  const { data: signed, error: signErr } = await service.storage.from('invoices')
    .createSignedUrl(path, SIGNED_URL_SECONDS)
  if (signErr || !signed?.signedUrl) return json(500, { error: 'sign_url_failed' })
  const link = signed.signedUrl

  const dryRun = Deno.env.get('INVOICE_SEND_DRY_RUN') === 'true'
  const docLabel = invoice.doc_number ? `#${invoice.doc_number}` : ''

  if (mode === 'email') {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('INVOICE_FROM_EMAIL')
    if (!dryRun && (!apiKey || !from)) {
      return json(501, { error: 'not_configured', missing: ['RESEND_API_KEY', 'INVOICE_FROM_EMAIL'].filter((k) => !Deno.env.get(k)) })
    }
    if (!dryRun) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${coName} <${from}>`,
          to: [to],
          reply_to: company.email || undefined,
          subject: `Invoice ${docLabel} from ${coName}`.replace('  ', ' '),
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
              <p>Hello,</p>
              <p>Your invoice ${docLabel} from ${coName} is attached${invoice.status === 'paid' ? ' (paid in full — thank you!)' : ` — amount due ${money(invoice.balance ?? invoice.total)}`}.</p>
              <p>You can also view it here: <a href="${link}">open invoice</a> (link valid 30 days).</p>
              <p>Questions? ${coPhone ? `Call ${coPhone}.` : 'Just reply to this email.'}</p>
              <p>Thank you for your business,<br/>${coName}</p>
            </div>`,
          attachments: [{ filename, content: pdfB64 }],
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        return json(502, { error: 'email_send_failed', detail: detail.slice(0, 400) })
      }
    }
    const now = new Date().toISOString()
    await service.from('invoices').update({ emailed_at: now, sent_at: now }).eq('id', invoice.id)
    return json(200, { ok: true, dry_run: dryRun, link })
  }

  // SMS
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER')
  if (!dryRun && (!sid || !token || !fromNumber)) {
    return json(501, { error: 'not_configured', missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'].filter((k) => !Deno.env.get(k)) })
  }
  const smsBody =
    `${coName}: invoice ${docLabel} — ` +
    (invoice.status === 'paid'
      ? 'paid in full, thank you!'
      : `amount due ${money(invoice.balance ?? invoice.total)}.`) +
    ` View: ${link}` +
    (coPhone ? ` Questions? ${coPhone}` : '')
  if (!dryRun) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: fromNumber!, To: phone.startsWith('+') ? phone : `+1${phone}`, Body: smsBody }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return json(502, { error: 'sms_send_failed', detail: detail.slice(0, 400) })
    }
  }
  const now = new Date().toISOString()
  await service.from('invoices').update({ texted_at: now, sent_at: now }).eq('id', invoice.id)
  return json(200, { ok: true, dry_run: dryRun, link })
})
