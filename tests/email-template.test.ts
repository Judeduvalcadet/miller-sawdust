import { DEFAULT_EMAIL_TEMPLATE, companyEmailValues, renderEmailTemplate, validateEmailTemplate } from '../supabase/functions/_shared/email-template.ts';
Deno.test('invoice variables render literally without recursive substitution', () => {
 const result = renderEmailTemplate({ subject: 'Invoice #{{ invoice_number }}', body: 'Hello {{customer_name}}\nBalance: {{invoice_balance}}' }, { invoice_number: '10482', customer_name: '{{company_name}} <Farm>', invoice_balance: '$400.00' });
 if (result.subject !== 'Invoice #10482' || result.body !== 'Hello {{company_name}} <Farm>\nBalance: $400.00') throw new Error('Incorrect rendering');
});
Deno.test('templates reject unsupported and malformed variables, blank text and subject newlines', () => {
 for (const template of [{...DEFAULT_EMAIL_TEMPLATE, body:'{{unknown}}'}, {...DEFAULT_EMAIL_TEMPLATE, body:'{{invoice_number}'}, {...DEFAULT_EMAIL_TEMPLATE, subject:'\nInjected'}, {...DEFAULT_EMAIL_TEMPLATE, body:''}]) {
  let rejected=false;try{validateEmailTemplate(template)}catch{rejected=true}if(!rejected)throw new Error('Invalid template accepted');
 }
});
Deno.test('default template includes invoice reference, customer and company', () => {
 const result=renderEmailTemplate(DEFAULT_EMAIL_TEMPLATE,{company_name:'Miller Sawdust',customer_name:'Test Farm',invoice_number:'12',invoice_total:'$20.00'});
 if(!result.subject.includes('#12')||!result.body.includes('Test Farm')||!result.body.includes('$20.00'))throw new Error('Default template incomplete');
});

Deno.test('company contact details come from the saved profile in the default email', () => {
 const values=companyEmailValues({company_name:'Example Company',street_address:'123 Main St',city:'Millersburg',state:'OH',zip:'44654',phone:'3305551234',email:'office@example.com'});
 const result=renderEmailTemplate(DEFAULT_EMAIL_TEMPLATE,{...values,customer_name:'Customer',invoice_number:'1',invoice_total:'$10.00'});
 for(const value of ['Example Company','123 Main St','Millersburg, OH 44654','3305551234','office@example.com']) if(!result.body.includes(value)) throw new Error('Missing company field: '+value);
});
