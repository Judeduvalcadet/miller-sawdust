/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AdminDashboard from './pages/AdminDashboard';
import AppSettings from './pages/AppSettings';
import AdminLogs from './pages/AdminLogs';
import CustomerManager from './pages/CustomerManager';
import DriverDashboard from './pages/DriverDashboard';
import DriverLogin from './pages/DriverLogin';
import DriverManager from './pages/DriverManager';
import DropOffLocationManager from './pages/DropOffLocationManager';
import Home from './pages/Home';
import Invoicing from './pages/Invoicing';
import PickupLocationManager from './pages/PickupLocationManager';
import Reports from './pages/Reports';
import Wallboard from './pages/Wallboard';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "AdminLogs": AdminLogs,
    "AppSettings": AppSettings,
    "CustomerManager": CustomerManager,
    "DriverDashboard": DriverDashboard,
    "DriverLogin": DriverLogin,
    "DriverManager": DriverManager,
    "DropOffLocationManager": DropOffLocationManager,
    "Home": Home,
    "Invoicing": Invoicing,
    "PickupLocationManager": PickupLocationManager,
    "Reports": Reports,
    "Wallboard": Wallboard,
}

export const pagesConfig = {
    mainPage: "DriverLogin",
    Pages: PAGES,
    Layout: __Layout,
};