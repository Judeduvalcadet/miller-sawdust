import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/entities';
import { getTokenClaim } from '@/api/authClient';
import { Button } from '@/components/ui/button';

// Intuit redirects here after the user authorizes the app
// (?code=...&realmId=...). Requires the office session that initiated the
// connect from V2 Settings; the code is exchanged server-side.
export default function QBCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [state, setState] = useState({ phase: 'working' });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const realmId = params.get('realmId');

    if (!code || !realmId) {
      setState({ phase: 'error', message: 'The QuickBooks sign-in was cancelled or incomplete.' });
      return;
    }
    if (getTokenClaim('amr') !== 'password') {
      setState({ phase: 'error', message: 'Your office session expired — sign in at V2 and connect again.' });
      return;
    }

    base44.functions.invoke('qb-auth', { action: 'callback', code, realmId })
      .then(({ data }) => {
        if (data?.success) {
          setState({ phase: 'done', company: data.companyName });
          setTimeout(() => navigate('/v2/settings'), 2500);
        } else {
          setState({ phase: 'error', message: 'QuickBooks rejected the connection — try again from Settings.' });
        }
      })
      .catch(() => setState({ phase: 'error', message: 'The connection could not be completed — try again from Settings.' }));
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        {state.phase === 'working' && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-gray-700 mx-auto" />
            <p className="mt-4 font-medium text-gray-900">Finishing the QuickBooks connection...</p>
          </>
        )}
        {state.phase === 'done' && (
          <>
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <p className="mt-4 font-semibold text-gray-900">Connected{state.company ? ` to ${state.company}` : ''}</p>
            <p className="mt-1 text-sm text-gray-500">Taking you back to Settings...</p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <p className="mt-4 font-semibold text-gray-900">Connection not completed</p>
            <p className="mt-1 text-sm text-gray-600">{state.message}</p>
            <Button className="mt-4 bg-gray-950 hover:bg-gray-800" onClick={() => navigate('/v2/settings')}>
              Back to Settings
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
