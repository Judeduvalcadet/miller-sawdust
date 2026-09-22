import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Star, Trash2, Plus, MapPin, Phone, FileText, Check } from 'lucide-react';
import { base44 } from '@/api/entities';
import { cn } from '@/lib/utils';

// V2 Customers — the customer's info plus their price book: what this
// customer usually gets and what they pay for it. Invoicing uses these
// prices; anything without a row falls back to the item's standard price.

export default function V2Customers() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['v2-customers'],
    queryFn: () => base44.entities.Customer.list('name', 5000),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers || [];
    if (!q) return list;
    return list.filter((c) =>
      `${c.name || ''} ${c.company_name || ''} ${c.city || ''}`.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const selected = (customers || []).find((c) => c.id === selectedId) || null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* List */}
      <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search customers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 px-1">{filtered.length} customers</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={cn(
                'w-full text-left px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50',
                selectedId === c.id && 'bg-gray-100 hover:bg-gray-100'
              )}
            >
              <p className="text-sm font-medium text-gray-900 truncate">{(c.company_name || c.name || '').trim() || '—'}</p>
              <p className="text-xs text-gray-400 truncate">{[c.city, c.qb_id ? null : null].filter(Boolean).join('') || c.street_address || ''}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? (
          <CustomerDetail key={selected.id} customer={selected} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 p-10">
            Select a customer to see their info and pricing.
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerDetail({ customer }) {
  return (
    <div className="p-6 max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{(customer.company_name || customer.name || '').trim()}</h2>
        {customer.company_name && customer.name && customer.name.trim() !== customer.company_name.trim() && (
          <p className="text-sm text-gray-500">{customer.name}</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2.5 text-sm">
        <div className="flex items-start gap-2.5">
          <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <span className="text-gray-800">
            {[customer.street_address, customer.city, [customer.state, customer.zip_code].filter(Boolean).join(' ')]
              .filter(Boolean).join(', ') || <span className="text-gray-400 italic">No address on file</span>}
          </span>
        </div>
        <div className="flex items-start gap-2.5">
          <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <span className="text-gray-800">{customer.phone || <span className="text-gray-400 italic">No phone</span>}</span>
        </div>
        {customer.delivery_instructions && (
          <div className="flex items-start gap-2.5">
            <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <span className="text-gray-800 whitespace-pre-wrap">{customer.delivery_instructions}</span>
          </div>
        )}
        {customer.qb_id && (
          <div className="pt-1">
            <span className="text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
              Linked to QuickBooks (#{customer.qb_id})
            </span>
          </div>
        )}
      </div>

      <PriceBook customer={customer} />
    </div>
  );
}

function PriceBook({ customer }) {
  const queryClient = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
  });
  const { data: prices, isLoading } = useQuery({
    queryKey: ['customer-prices', customer.id],
    queryFn: () => base44.entities.CustomerItemPrice.filter({ customer_id: customer.id }),
  });

  const [editPrice, setEditPrice] = useState({}); // row id -> string being typed
  const [savedRow, setSavedRow] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addPrice, setAddPrice] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customer-prices', customer.id] });
  const update = useMutation({
    mutationFn: ({ id, ...patch }) => base44.entities.CustomerItemPrice.update(id, patch),
    onSuccess: (_, vars) => { invalidate(); setSavedRow(vars.id); setTimeout(() => setSavedRow(null), 1500); },
  });
  const create = useMutation({
    mutationFn: (row) => base44.entities.CustomerItemPrice.create(row),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id) => base44.entities.CustomerItemPrice.delete(id),
    onSuccess: invalidate,
  });

  const itemById = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);
  const rows = useMemo(() => {
    const list = [...(prices || [])];
    list.sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      const ia = itemById.get(a.item_id), ib = itemById.get(b.item_id);
      return (ia?.sort_order ?? 999) - (ib?.sort_order ?? 999);
    });
    return list;
  }, [prices, itemById]);

  const usedItemIds = new Set(rows.map((r) => r.item_id));
  const addable = (items || []).filter((i) => i.active && !usedItemIds.has(i.id));

  const commitPrice = (row) => {
    const raw = editPrice[row.id];
    if (raw === undefined) return;
    const v = parseFloat(raw);
    setEditPrice((p) => { const n = { ...p }; delete n[row.id]; return n; });
    if (isNaN(v) || v < 0 || v === Number(row.price)) return;
    update.mutate({ id: row.id, price: v });
  };

  const setDefault = async (row) => {
    const current = rows.find((r) => r.is_default && r.id !== row.id);
    if (current) await base44.entities.CustomerItemPrice.update(current.id, { is_default: false });
    update.mutate({ id: row.id, is_default: true });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">Pricing</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          What this customer pays. The starred item is what they usually get. Anything not
          listed here is invoiced at the standard item price.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : (
        <div>
          {rows.length === 0 && (
            <p className="px-5 py-5 text-sm text-gray-400 italic">
              No custom pricing yet — invoices use standard item prices.
            </p>
          )}
          {rows.map((row) => {
            const item = itemById.get(row.item_id);
            const std = item?.unit_price != null ? Number(item.unit_price) : null;
            const differs = std != null && Math.abs(std - Number(row.price)) > 0.004;
            return (
              <div key={row.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-50">
                <button
                  onClick={() => !row.is_default && setDefault(row)}
                  title={row.is_default ? 'Their usual load' : 'Mark as their usual load'}
                  className={cn('shrink-0', row.is_default ? 'text-amber-500' : 'text-gray-200 hover:text-amber-400')}
                >
                  <Star className="w-4 h-4" fill={row.is_default ? 'currentColor' : 'none'} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item?.name || 'Unknown item'}</p>
                  {std != null && (
                    <p className="text-[11px] text-gray-400">
                      standard ${std.toLocaleString()}{differs ? ` — custom for this customer` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-sm">$</span>
                  <Input
                    type="number" step="0.01"
                    value={editPrice[row.id] !== undefined ? editPrice[row.id] : String(row.price)}
                    onChange={(e) => setEditPrice((p) => ({ ...p, [row.id]: e.target.value }))}
                    onBlur={() => commitPrice(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className={cn('h-8 w-24 text-sm text-right', differs && 'border-amber-300 bg-amber-50/50')}
                  />
                  {savedRow === row.id && <Check className="w-4 h-4 text-green-600" />}
                </div>
                <button
                  onClick={() => remove.mutate(row.id)}
                  className="text-gray-300 hover:text-red-500 shrink-0"
                  title="Remove — falls back to the standard price"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {/* Add row */}
          <div className="px-5 py-3">
            {adding ? (
              <div className="flex items-center gap-2">
                <select
                  value={addItemId}
                  onChange={(e) => {
                    setAddItemId(e.target.value);
                    const it = itemById.get(e.target.value);
                    if (it?.unit_price != null) setAddPrice(String(it.unit_price));
                  }}
                  className="h-9 text-sm border border-gray-200 rounded-md px-2 bg-white flex-1 min-w-0"
                >
                  <option value="">Choose an item…</option>
                  {addable.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}{i.unit_price != null ? ` — $${i.unit_price}` : ''}</option>
                  ))}
                </select>
                <span className="text-gray-400 text-sm">$</span>
                <Input type="number" step="0.01" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} className="h-9 w-24 text-sm text-right" />
                <Button
                  size="sm" className="bg-gray-950 hover:bg-gray-800"
                  disabled={!addItemId || addPrice === '' || create.isPending}
                  onClick={() => {
                    create.mutate({
                      customer_id: customer.id,
                      item_id: addItemId,
                      price: parseFloat(addPrice),
                      is_default: rows.length === 0 && !!itemById.get(addItemId)?.is_load_item,
                    });
                    setAdding(false); setAddItemId(''); setAddPrice('');
                  }}
                >Add</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddItemId(''); setAddPrice(''); }}>Cancel</Button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
                <Plus className="w-4 h-4" /> Add a custom price
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
