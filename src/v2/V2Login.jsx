import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft } from 'lucide-react';
import { loginWithEmail } from '@/api/authClient';

// Office login for V2 (owner / secretary): email + password. Driver PIN
// login stays on the V1 login page, untouched.
export default function V2Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const user = await loginWithEmail(email.trim(), password);
      if (!['admin', 'assistant'].includes(user?.role)) {
        setError('This login is for office accounts only.');
        setLoading(false);
        return;
      }
      navigate('/v2');
    } catch (err) {
      setError(err?.message === 'too_many_attempts'
        ? 'Too many attempts — wait 15 minutes and try again.'
        : 'Email or password is incorrect.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.jpg" alt="Miller Sawdust" className="w-16 h-16 rounded-2xl object-cover" />
          <h1 className="mt-4 text-xl font-bold text-white">Miller Sawdust</h1>
          <p className="text-sm text-gray-400">Office · V2</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl p-6 space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@millersawdust.app"
              className="text-base sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="text-base sm:text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading || !email.trim() || !password} className="w-full bg-gray-950 hover:bg-gray-800">
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Sign in
          </Button>
          <button
            type="button"
            onClick={() => navigate('/DriverLogin')}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 pt-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Driver login (V1)
          </button>
        </form>
      </div>
    </div>
  );
}
