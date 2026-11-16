import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Reports from '@/pages/Reports';
import PickupLocationsFullReport from '@/pages/PickupLocationsFullReport';
import CustomerDeliveriesFullReport from '@/pages/CustomerDeliveriesFullReport';
import './reports.css';

export default function V2Reports() {
  useEffect(() => { document.body.classList.add('v2-reports-open'); return () => document.body.classList.remove('v2-reports-open'); }, []);
  return <div className="v2-reports flex-1 min-h-0 overflow-y-auto">
    <Routes>
      <Route index element={<Reports v2 />} />
      <Route path="pickups" element={<PickupLocationsFullReport v2 />} />
      <Route path="customers" element={<CustomerDeliveriesFullReport v2 />} />
    </Routes>
  </div>;
}
