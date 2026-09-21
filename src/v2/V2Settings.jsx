import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Link2, Unlink, CheckCircle2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/entities';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// V2 Settings — QuickBooks connection management (owner / secretary only;
// the server enforces it too).
export default function V2Settings() {
  const [qb, setQb] = useState({ loading: true });
  const [working, setWorking] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await base44.functions.invoke('qb-auth', { action: 'status' });
      setQb({ loading: false, ...data });
    } catch {
      setQb({ loading: false, error: true });
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const connect = async () => {
    setWorking(true);
    setError('');
    try {
      const { data } = await base44.functions.invoke('qb-auth', { action: 'auth-url' });
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setError("Couldn't start the QuickBooks connection — try again.");
    } catch {
      setError("Couldn't start the QuickBooks connection — try again.");
    }
    setWorking(false);
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await base44.functions.invoke('qb-auth', { action: 'disconnect' });
      await loadStatus();
    } catch {
      setError("Couldn't disconnect — try again.");
    }
    setWorking(false);
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {/* QuickBooks */}
      <section className="mt-6 bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <span className="text-green-700 font-black text-lg">qb</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">QuickBooks Online</h2>
            <p className="text-sm text-gray-500">Customer, pricing, and invoice sync</p>
          </div>
        </div>

        <div className="mt-4">
          {qb.loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking connection...
            </div>
          ) : qb.connected ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                {qb.tokenExpired ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                )}
                <div className="text-sm">
                  <p className="font-medium text-gray-900">
                    {qb.tokenExpired ? 'Connection expired' : 'Connected'} — {qb.companyName || 'QuickBooks company'}
                  </p>
                  <p className="text-gray-500">
                    {qb.tokenExpired
                      ? 'QuickBooks needs to be reconnected (this happens after ~100 days of inactivity).'
                      : `Connected ${qb.connectedAt ? new Date(qb.connectedAt).toLocaleDateString() : ''}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {qb.tokenExpired && (
                  <Button onClick={connect} disabled={working} className="bg-gray-950 hover:bg-gray-800">
                    {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                    Reconnect
                  </Button>
                )}
                <Button variant="outline" onClick={() => setConfirmDisconnect(true)} disabled={working}>
                  <Unlink className="w-4 h-4 mr-2" /> Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Not connected. Connecting requires signing in to Intuit with the account
                that administers the Miller Sawdust QuickBooks company.
              </p>
              <Button onClick={connect} disabled={working} className="bg-gray-950 hover:bg-gray-800">
                {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                Connect to QuickBooks
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </section>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              Syncing stops until it's reconnected. Nothing already in QuickBooks or in this system is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect} className="bg-red-600 hover:bg-red-700">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
