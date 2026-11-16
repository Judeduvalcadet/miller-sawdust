export const EMAIL_VARIABLES = ['company_name', 'customer_name', 'invoice_number', 'invoice_date', 'due_date', 'invoice_total', 'invoice_balance', 'company_email', 'company_address', 'company_phone'] as const;
export const DEFAULT_EMAIL_TEMPLATE = {
  subject: '{{company_name}}: Invoice #{{invoice_number}}',
  body: 'Hello {{customer_name}},\n\nYour invoice #{{invoice_number}} for {{invoice_total}} is attached as a PDF.\n\nThank you for your business.\n{{company_name}}\n{{company_address}}\n{{company_phone}}\n{{company_email}}',
};
export function validateEmailTemplate(template: { subject: string; body: string }) {
  if (!template || typeof template.subject !== 'string' || typeof template.body !== 'string') throw new Error('Enter a subject and message.');
  if (!template.subject.trim() || !template.body.trim()) throw new Error('Subject and message cannot be empty.');
  if (template.subject.length > 200 || template.body.length > 10000) throw new Error('Keep the subject under 200 characters and the message under 10,000 characters.');
  if (/[\r\n]/.test(template.subject)) throw new Error('The subject must be one line.');
  for (const value of [template.subject, template.body]) {
    const remaining = value.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key) => {
      if (!(EMAIL_VARIABLES as readonly string[]).includes(key)) throw new Error(`Unknown variable: ${key}`);
      return '';
    });
    if (remaining.includes('{{') || remaining.includes('}}')) throw new Error('Check the variable brackets. Use {{variable_name}}.');
  }
  return { subject: template.subject.trim(), body: template.body.trim() };
}
export function renderEmailTemplate(template: { subject: string; body: string }, values: Record<string, string>) {
  const checked = validateEmailTemplate(template);
  const fill = (value: string) => value.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key) => values[key] ?? '');
  return { subject: fill(checked.subject).replace(/[\r\n]+/g, ' '), body: fill(checked.body) };
}

export function companyEmailValues(company: Record<string, string> = {}) {
  return {
    company_name: company.company_name || 'Miller Sawdust',
    company_email: company.email || '',
    company_phone: company.phone || '',
    company_address: [company.street_address, [[company.city, company.state].filter(Boolean).join(', '), company.zip].filter(Boolean).join(' ')].filter(Boolean).join('\n'),
  };
}
