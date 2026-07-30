import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { getAccessToken, login } from '@/api/authClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Truck, Loader2, AlertCircle } from "lucide-react";
import { createPageUrl } from "@/utils";

export default function DriverLogin() {
  const [drivers, setDrivers] = useState([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    checkExistingSession();
    loadDrivers();
    // Fail-safe: never leave the user staring at the session-check spinner —
    // if anything hangs, show the login form and let them log in normally.
    const failSafe = setTimeout(() => setIsLoading(false), 8000);
    return () => clearTimeout(failSafe);
  }, []);

  const redirectByRole = (role) => {
    if (role === 'admin' || role === 'dispatcher') {
      window.location.href = createPageUrl('AdminDashboard');
    } else if (role === 'assistant') {
      window.location.href = createPageUrl('Invoicing');
    } else if (role === 'wallboard') {
      window.location.href = createPageUrl('Wallboard');
    } else {
      window.location.href = createPageUrl('DriverDashboard');
    }
  };

  const checkExistingSession = async () => {
    try {
      // Refreshes silently, or exchanges a legacy (pre-JWT) session one time.
      let token = await getAccessToken();
      if (token && !localStorage.getItem('miller_driver_id')) {
        // Half-cleared device (old logout bug): token exists but identity is
        // gone — a redirect would loop. Force a refresh, which re-stores the
        // driver info alongside the new token.
        localStorage.removeItem('miller_jwt');
        token = await getAccessToken();
        if (token && !localStorage.getItem('miller_driver_id')) {
          // Still no identity — drop the broken tokens and show the form.
          localStorage.removeItem('miller_jwt');
          localStorage.removeItem('miller_refresh_token');
          localStorage.removeItem('miller_session_id');
          token = null;
        }
      }
      if (token) {
        redirectByRole(localStorage.getItem('miller_driver_role'));
        return;
      }
    } catch (e) {
      console.log('Session check failed, requiring login');
    }
    setIsLoading(false);
  };

  const loadDrivers = async (attempt = 1) => {
    try {
      // login_roster is the only anon-readable data after the RLS flip
      const { data, error: rpcError } = await supabase.rpc('login_roster');
      if (rpcError) throw rpcError;
      setDrivers(data || []);
    } catch {
      try {
        // Fallback for the window before migration 003 is applied
        const allDrivers = await base44.entities.Driver.filter({ active: true }, 'name');
        setDrivers(allDrivers);
      } catch (e) {
        if (attempt < 4) {
          // Retry with exponential backoff (1s, 2s, 4s)
          setTimeout(() => loadDrivers(attempt + 1), attempt * 1000);
        } else {
          setError('Error loading drivers. Please refresh the page.');
        }
      }
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);

    try {
      if (!selectedDriverId) {
        setError('Please select a driver');
        setIsLoggingIn(false);
        return;
      }

      const driver = await login(selectedDriverId, pin);
      redirectByRole(driver.role);
    } catch (e) {
      if (e.status === 401) {
        setError('Incorrect PIN');
      } else if (e.status === 429) {
        setError('Too many attempts. Please wait 15 minutes and try again.');
      } else {
        setError('Login failed. Please try again.');
      }
      setIsLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center px-4 sm:px-6 py-6 sm:py-8">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 mb-4">
            <img 
              src="/logo.jpg"
              alt="Miller Sawdust Logo" 
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Miller Sawdust</CardTitle>
          <CardDescription className="text-gray-600">User Login</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Select Driver</Label>
              <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Choose your name..." />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map(driver => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="Enter your PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="h-12 text-center text-2xl tracking-widest"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-lg bg-amber-600 hover:bg-amber-700"
              disabled={isLoggingIn || !selectedDriverId || pin.length < 4}
            >
              {isLoggingIn ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : null}
              Login
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              Add to Home Screen for quick access
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}