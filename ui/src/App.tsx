import { BrowserRouter as Router, Routes, Route, Outlet, Link, useLocation } from 'react-router-dom';
import { Home, History, Settings, ListTodo } from 'lucide-react';
import DesktopHome from './views/Desktop/Home';
import DesktopHistory from './views/Desktop/History';
import DesktopSettings from './views/Desktop/Settings';
import PublicReport from './views/Report/PublicReport';
import { SyncIndicator } from './components/SyncIndicator';
import { isDesktopEnv } from './api';

function HostedHome() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12 text-slate-900">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 md:p-12 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <ListTodo className="w-8 h-8 text-sky-500" />
            <h1 className="text-3xl font-semibold">TaskTracker</h1>
          </div>
          <p className="text-lg text-slate-600 leading-relaxed">Private work tracking runs through the Windows desktop client. This site hosts secure, read-only work reports shared from the reporting system.</p>
          <p className="mt-4 text-slate-500">Open the report link from your scheduled TaskTracker email to view a weekly or monthly report.</p>
        </div>
      </div>
    </div>
  );
}

// App Layout for Desktop
function AppLayout() {
  const location = useLocation();
  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/history', label: 'History', icon: History },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <div className="w-16 md:w-64 bg-slate-900 text-slate-100 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-4 flex items-center justify-center md:justify-start gap-3 border-b border-slate-800">
            <ListTodo className="w-6 h-6 text-sky-400 shrink-0" />
            <h1 className="font-semibold text-lg hidden md:block">TaskTracker</h1>
          </div>
          <nav className="mt-4 flex flex-col gap-1 px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 p-3 rounded-md transition-colors ${
                    isActive 
                      ? 'bg-slate-800 text-white' 
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                  title={item.label}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="hidden md:block text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-slate-800 flex justify-center md:justify-start">
          <SyncIndicator />
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={isDesktopEnv ? <DesktopHome /> : <HostedHome />} />
          <Route path="history" element={<DesktopHistory />} />
          <Route path="settings" element={<DesktopSettings />} />
        </Route>
        
        {/* Standalone Report Route */}
        <Route path="/report/:shareToken" element={<PublicReport />} />
      </Routes>
    </Router>
  );
}
