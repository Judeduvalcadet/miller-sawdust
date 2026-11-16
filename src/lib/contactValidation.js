import { normalizeAddress } from '../../supabase/functions/_shared/messaging-core.ts';

export function contactError(type, value, required = false) {
  if (!String(value ?? '').trim()) return required ? `Enter ${type === 'email' ? 'an email address' : 'a phone number'}.` : '';
  try { normalizeAddress(type === 'email' ? 'email' : 'sms', value); return ''; }
  catch (error) { return error.message; }
}
export function validContact(type, value) { return !contactError(type, value, true); }
export function validateContactFields(record) {
  for (const [field, type] of [['phone', 'tel'], ['email', 'email']]) {
    if (field in record) {
      const error = contactError(type, record[field]);
      if (error) throw new Error(`${field === 'phone' ? 'Phone' : 'Email'}: ${error}`);
    }
  }
  if (record.company_profile) validateContactFields(record.company_profile);
}
