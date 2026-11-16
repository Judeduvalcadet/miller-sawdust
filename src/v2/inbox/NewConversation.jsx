import { Input } from '@/components/ui/input';
import { validContact } from '@/lib/contactValidation';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { messaging } from "./api";

export default function NewConversation({ onClose, onCreated }) {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("sms");
  const [to, setTo] = useState("");
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: customers = [], isError } = useQuery({
    queryKey: ["inbox-customer-search", search],
    queryFn: async () => {
      const q = search.replace(/[%_(),]/g, "").trim();
      let query = supabase
        .from("customers")
        .select("id,name,company_name,phone,email")
        .order("name")
        .limit(30);
      if (q)
        query = query.or(
          `name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`,
        );
      const { data, error: err } = await query;
      if (err) throw err;
      return data;
    },
  });
  async function start(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await messaging("start", {
        channel,
        to,
        customer_id: customer?.id,
      });
      onCreated(result.conversation);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={() => !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
        </DialogHeader>
        <form onSubmit={start} className="space-y-3">
          <label className="block text-xs font-medium">
            Channel
            <select
              className="block mt-1 border rounded-lg w-full p-2 text-sm"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setTo(
                  customer?.[e.target.value === "email" ? "email" : "phone"] ||
                    "",
                );
              }}
            >
              <option value="sms">Text / MMS</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label className="block text-xs font-medium">
            Find a customer
            <input
              className="block mt-1 border rounded-lg w-full p-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, company, phone or email"
            />
          </label>
          {isError && (
            <p className="text-xs text-red-700">
              Customers could not be loaded.
            </p>
          )}
          <div className="max-h-44 overflow-y-auto border rounded-lg">
            {customers.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`block w-full text-left p-2.5 text-sm border-b last:border-0 hover:bg-gray-50 ${customer?.id === c.id ? "bg-blue-50" : ""}`}
                onClick={() => {
                  setCustomer(c);
                  setTo(c[channel === "email" ? "email" : "phone"] || "");
                }}
              >
                <span className="font-medium">{c.company_name || c.name}</span>
                <span className="block text-xs text-gray-500">
                  {c[channel === "email" ? "email" : "phone"] ||
                    "No contact detail"}
                </span>
              </button>
            ))}
          </div>
          <label className="block text-xs font-medium">
            {channel === "email" ? "Email address" : "Phone number"}
            <Input
              type={channel === "email" ? "email" : "tel"}
              required
              className="block mt-1 border rounded-lg w-full p-2 text-sm"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setCustomer(null);
              }}
              placeholder={
                channel === "email" ? "customer@example.com" : "(555) 123-4567"
              }
            />
          </label>
          <p className="text-xs text-gray-500">
            Choose a customer or enter a recipient directly. Creating a
            conversation sends nothing.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy || !validContact(channel === 'email' ? 'email' : 'tel', to)}
            className="w-full bg-gray-950 text-white rounded-lg p-2 text-sm disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open conversation"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
