import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Shield, Truck } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center px-4 sm:px-6 py-6 sm:py-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto w-20 h-20 mb-6">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6995e4aeb0c428c566fcd648/51f87db73_MSSSS-logo.jpg" 
            alt="Miller Sawdust Logo" 
            className="w-full h-full object-contain rounded-lg"
          />
        </div>
        
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Miller Sawdust</h1>
        <p className="text-gray-600 mb-12">Dispatch System</p>

        <div className="space-y-4">
          <Link to={createPageUrl('DriverLogin')}>
            <Button className="w-full h-16 text-xl font-semibold bg-amber-600 hover:bg-amber-700 shadow-lg">
              <Shield className="w-6 h-6 mr-3" />
              Admin
            </Button>
          </Link>

          <Link to={createPageUrl('DriverLogin')}>
            <Button className="w-full h-16 text-xl font-semibold bg-blue-600 hover:bg-blue-700 shadow-lg">
              <Truck className="w-6 h-6 mr-3" />
              Driver
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}