import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { 
  Truck, LayoutDashboard, Users, Building2, 
  Factory, Monitor, Menu, X, BarChart2, FileText, MapPinned, LogOut, ScrollText, Settings, Database
} from 'lucide-react';
import ErrorBoundary from '@/components/admin/ErrorBoundary';
import { logout, ensureAuthenticated } from '@/api/authClient';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export default function Layout({ children, currentPageName }) {
  // Pages without layout (full screen)
  const noLayoutPages = ['DriverLogin', 'DriverDashboard', 'Wallboard'];

  // Redirect to login when no renewable session exists (guarded pages only —
  // the full-screen pages handle their own auth)
  useEffect(() => {
    if (!noLayoutPages.includes(currentPageName)) ensureAuthenticated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageName]);

  if (noLayoutPages.includes(currentPageName)) {
    return <>{children}</>;
  }

  const driverRole = localStorage.getItem('miller_driver_role');
  const driverName = localStorage.getItem('miller_driver_name');
  const isAssistant = driverRole === 'assistant';
  const isLoggedIn = !!localStorage.getItem('miller_session_id');

  const handleLogout = async () => {
    await logout(); // revokes the session server-side and clears local tokens
    window.location.href = createPageUrl('DriverLogin');
  };

  const allNavItems = [
    { name: 'Dispatch Board', page: 'AdminDashboard', icon: LayoutDashboard },
    { name: 'Wallboard', page: 'Wallboard', icon: Monitor },
    { name: 'Invoicing', page: 'Invoicing', icon: FileText },
    { name: 'Reports', page: 'Reports', icon: BarChart2 },
    { name: 'Users', page: 'DriverManager', icon: Users },
    { name: 'Customers', page: 'CustomerManager', icon: Building2 },
    { name: 'Pickup Locations', page: 'PickupLocationManager', icon: Factory },
    { name: 'Drop-Off Locations', page: 'DropOffLocationManager', icon: MapPinned },
    { name: 'Settings', page: 'AppSettings', icon: Settings },
    { name: 'Backup', page: 'BackupRestore', icon: Database },
  ];

  const assistantNavItems = [
    { name: 'Invoicing', page: 'Invoicing', icon: FileText },
    { name: 'Reports', page: 'Reports', icon: BarChart2 },
  ];

  const navItems = isAssistant ? assistantNavItems : allNavItems;

  const [sheetOpen, setSheetOpen] = React.useState(false);

  const NavContent = ({ onItemClick }) => (
    <>
      {navItems.map(item => (
        <Link
          key={item.page}
          to={createPageUrl(item.page)}
          onClick={onItemClick}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            currentPageName === item.page 
              ? 'bg-amber-100 text-amber-700' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <item.icon className="w-5 h-5" />
          <span className="font-medium">{item.name}</span>
        </Link>
      ))}
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex lg:flex-col bg-white border-r">
        <div className="flex items-center gap-3 px-6 py-5 border-b">
          <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-gray-900">Miller Sawdust</h1>
            <p className="text-xs text-gray-500">Dispatch System</p>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <NavContent />
        </nav>

        <div className="p-4 border-t space-y-1">
          {isLoggedIn ? (
            <>
              {driverName && (
                <p className="text-xs text-gray-400 px-4 pb-1 truncate">Logged in as <span className="font-semibold text-gray-600">{driverName}</span></p>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 bg-gray-100 hover:bg-gray-200 w-full"
              >
                <LogOut className="w-5 h-5 text-black" />
                <span className="font-medium text-black">Log Out</span>
              </button>
            </>
          ) : (
            <Link
              to={createPageUrl('DriverLogin')}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <Truck className="w-5 h-5" />
              <span className="font-medium">User Login</span>
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden sticky top-0 z-50 bg-white border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-600 rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-gray-900">Miller Sawdust</span>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex items-center gap-3 px-6 py-5 border-b">
                <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
                  <Truck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-lg">Miller Sawdust</h1>
                  <p className="text-xs text-gray-500">Dispatch System</p>
                </div>
              </div>
              <nav className="p-4 space-y-1">
                <NavContent onItemClick={() => setSheetOpen(false)} />
              </nav>
              <div className="p-4 border-t space-y-1">
                {isLoggedIn ? (
                  <>
                    {driverName && (
                      <p className="text-xs text-gray-400 px-4 pb-1 truncate">Logged in as <span className="font-semibold text-gray-600">{driverName}</span></p>
                    )}
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 bg-gray-100 hover:bg-gray-200 w-full"
                    >
                      <LogOut className="w-5 h-5 text-black" />
                      <span className="font-medium text-black">Log Out</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to={createPageUrl('DriverLogin')}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100"
                  >
                    <Truck className="w-5 h-5" />
                    <span className="font-medium">User Login</span>
                  </Link>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:ml-64">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
    </div>
  );
}