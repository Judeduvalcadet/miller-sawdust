import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
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
  }, []);

  const getDeviceId = () => {
    let deviceId = localStorage.getItem('miller_device_id');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now();
      localStorage.setItem('miller_device_id', deviceId);
    }
    return deviceId;
  };

  const checkExistingSession = async () => {
    const sessionId = localStorage.getItem('miller_session_id');
    const driverId = localStorage.getItem('miller_driver_id');
    
    if (sessionId && driverId) {
      try {
        const sessions = await base44.entities.DriverSession.filter({ id: sessionId });
        if (sessions.length > 0) {
          const session = sessions[0];
          const expiresAt = new Date(session.expires_at);
          
          if (expiresAt > new Date()) {
            // Session valid, update last_used_at
            const newExpires = new Date();
            newExpires.setDate(newExpires.getDate() + 30);
            await base44.entities.DriverSession.update(sessionId, {
              last_used_at: new Date().toISOString(),
              expires_at: newExpires.toISOString()
            });
            
            // Check if driver is still active
            const driverList = await base44.entities.Driver.filter({ id: driverId });
            if (driverList.length > 0 && driverList[0].active) {
              const existingDriver = driverList[0];
              localStorage.setItem('miller_driver_role', existingDriver.role);
              if (existingDriver.role === 'admin' || existingDriver.role === 'dispatcher') {
                window.location.href = createPageUrl('AdminDashboard');
              } else if (existingDriver.role === 'assistant') {
                window.location.href = createPageUrl('Invoicing');
              } else {
                window.location.href = createPageUrl('DriverDashboard');
              }
              return;
            }
          }
        }
      } catch (e) {
        console.log('Session check failed, requiring login');
      }
    }
    setIsLoading(false);
  };

  const loadDrivers = async (attempt = 1) => {
    try {
      const allDrivers = await base44.entities.Driver.filter({ active: true });
      setDrivers(allDrivers);
    } catch (e) {
      if (attempt < 4) {
        // Retry with exponential backoff (1s, 2s, 4s)
        setTimeout(() => loadDrivers(attempt + 1), attempt * 1000);
      } else {
        setError('Error loading drivers. Please refresh the page.');
      }
    }
  };

  const simpleHash = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);

    try {
      const driver = drivers.find(d => d.id === selectedDriverId);
      if (!driver) {
        setError('Please select a driver');
        setIsLoggingIn(false);
        return;
      }

      const pinHash = simpleHash(pin);
      if (driver.pin_hash !== pinHash) {
        setError('Incorrect PIN');
        setIsLoggingIn(false);
        return;
      }

      // Create session
      const deviceId = getDeviceId();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const session = await base44.entities.DriverSession.create({
        driver_id: driver.id,
        device_id: deviceId,
        last_used_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      });

      // Update driver last login
      await base44.entities.Driver.update(driver.id, {
        last_login_at: new Date().toISOString()
      });

      // Store session locally
      localStorage.setItem('miller_session_id', session.id);
      localStorage.setItem('miller_driver_id', driver.id);
      localStorage.setItem('miller_driver_name', driver.name);
      localStorage.setItem('miller_driver_role', driver.role);

      // Redirect based on role
      if (driver.role === 'admin' || driver.role === 'dispatcher') {
        window.location.href = createPageUrl('AdminDashboard');
      } else if (driver.role === 'assistant') {
        window.location.href = createPageUrl('Invoicing');
      } else {
        window.location.href = createPageUrl('DriverDashboard');
      }
    } catch (e) {
      setError('Login failed. Please try again.');
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
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6995e4aeb0c428c566fcd648/51f87db73_MSSSS-logo.jpg" 
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