export async function fetchInvoicePage(client, { search = '', status = 'all', from = '', to = '', page = 1, pageSize = 50 }, signal) {
  const query = client.rpc('invoice_list_page', {
    p_search: search.trim(), p_status: status,
    p_from: from || null, p_to: to || null,
    p_page: page, p_page_size: pageSize,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  if (!data || !Array.isArray(data.rows) || !Number.isFinite(data.total)) throw new Error('Could not load invoice page.');
  return data;
}

export async function fetchSelectedInvoices(client, ids) {
  const records = new Map();
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await client.from('invoices').select('*,customer:customers(*)')
      .in('id', ids.slice(start, start + 100)).or('qb_archived.eq.false,qb_archived.is.null');
    if (error) throw error;
    for (const row of data || []) records.set(row.id, row);
  }
  if (records.size !== ids.length) throw new Error('Some selected invoices are no longer available. Clear your selection and try again.');
  return ids.map(id => records.get(id));
}
