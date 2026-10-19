import { Link, useLocation } from 'react-router-dom';

const PAGES = [
  ['/AdminDashboard', '/v2'], ['/Invoicing', '/v2/invoices'],
  ['/CustomerManager', '/v2/customers'], ['/PickupLocationManager', '/v2/pickups'],
  ['/DropOffLocationManager', '/v2/dropoffs'], ['/AppSettings', '/v2/settings'],
  ['/Wallboard', '/v2/wallboard'], ['/DriverLogin', '/v2/login'],
];
export default function VersionSwitch({ dark = false, onNavigate }) {
  const { pathname } = useLocation();
  const v2 = pathname === '/v2' || pathname.startsWith('/v2/');
  const pair = PAGES.find(([oldPath, newPath]) => pathname.toLowerCase() === (v2 ? newPath : oldPath).toLowerCase()) || PAGES[0];
  return <div role="group" aria-label="Interface version" className={`flex rounded-lg p-1 mb-2 ${dark ? 'bg-white/10' : 'bg-gray-100'}`}>
    {['V1', 'V2'].map((label, index) => <Link key={label} to={pair[index]} onClick={onNavigate} aria-current={v2 === !!index ? 'page' : undefined} className={`flex-1 text-center rounded-md px-4 py-2 text-sm font-medium ${v2 === !!index ? 'bg-white text-gray-950 shadow-sm' : dark ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{label}</Link>)}
  </div>;
}
