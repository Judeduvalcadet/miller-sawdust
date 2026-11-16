// Sender credentials stay server-side; the public company profile supplies branding.
export function emailIdentity(profile = {}, sender = '') {
  const name = String(profile.company_name || '').trim();
  const replyTo = String(profile.email || '').trim() || sender;
  return { name: name || sender, replyTo, from: name ? `${JSON.stringify(name)} <${sender}>` : sender };
}
