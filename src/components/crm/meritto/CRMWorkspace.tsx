import { createContext, lazy, Suspense, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Bell, Building2, CalendarDays, ChevronDown, ChevronLeft,
  ChevronRight, GitBranch, LayoutDashboard, LogOut, Menu, Moon, Search,
  Settings, ShieldCheck, Sun, UploadCloud, Users, X,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { crmApi } from './api';
import type { CRMMeta } from './types';

const DashboardPage = lazy(() => import('./DashboardPage'));
const LeadManagerPage = lazy(() => import('./LeadManagerPage'));
const PipelinePage = lazy(() => import('./PipelinePage'));
const TasksPage = lazy(() => import('./TasksPage'));
const ActivitiesPage = lazy(() => import('./ActivitiesPage'));
const ReportsPage = lazy(() => import('./ReportsPage'));
const UsersPage = lazy(() => import('./UsersPage'));
const AuditPage = lazy(() => import('./AuditPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));

interface CRMContextValue {
  meta: CRMMeta;
  can: (permission: string) => boolean;
  refreshMeta: () => Promise<unknown>;
}

const CRMContext = createContext<CRMContextValue | null>(null);

export function useCRM() {
  const value = useContext(CRMContext);
  if (!value) throw new Error('useCRM must be used inside CRMWorkspace');
  return value;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, route: '/crm/dashboard', permission: 'view_leads' },
  { id: 'lead-management', label: 'Lead Manager', icon: Users, route: '/crm/lead-management', permission: 'view_leads' },
  { id: 'pipeline', label: 'Opportunity Pipeline', icon: GitBranch, route: '/crm/pipeline', permission: 'view_leads' },
  { id: 'tasks', label: 'Calendar & Tasks', icon: CalendarDays, route: '/crm/tasks', permission: 'manage_tasks' },
  { id: 'activities', label: 'Dynamic Activity', icon: Activity, route: '/crm/activities', permission: 'view_leads' },
  { id: 'analytics', label: 'Reports & Analytics', icon: BarChart3, route: '/crm/analytics', permission: 'view_reports' },
  { id: 'users', label: 'User Access Control', icon: ShieldCheck, route: '/crm/users', admin: true },
  { id: 'audit', label: 'Audit Log', icon: Building2, route: '/crm/audit', admin: true },
  { id: 'settings', label: 'Settings', icon: Settings, route: '/crm/settings', admin: true },
];

const pageTitles: Record<string, string> = {
  dashboard: 'Admin Dashboard',
  'lead-management': 'Lead Manager',
  pipeline: 'Opportunity Pipeline',
  tasks: 'Calendar & Tasks',
  activities: 'Dynamic Activity',
  analytics: 'Reports & Analytics',
  users: 'User Access Control',
  audit: 'Audit Log',
  settings: 'CRM Settings',
};

function LoadingWorkspace() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>;
}

export default function CRMWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const active = location.pathname.split('/').filter(Boolean)[1] || 'dashboard';
  const metaQuery = useQuery({ queryKey: ['crm-meta'], queryFn: () => crmApi<CRMMeta>('/meta'), staleTime: 30_000 });

  const isAdmin = ['admin', 'super_admin'].includes(metaQuery.data?.actor.role || '');
  const permissions = metaQuery.data?.permissions;
  const can = (permission: string) => isAdmin || permissions?.includes(permission) === true;
  const visibleNav = useMemo(() => navItems.filter((item) => (!item.admin || isAdmin) && (!item.permission || isAdmin || permissions?.includes(item.permission))), [isAdmin, permissions]);
  if (metaQuery.isLoading) return <LoadingWorkspace />;
  if (metaQuery.error || !metaQuery.data) return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md border border-red-200 bg-white p-6 text-center"><h1 className="font-semibold text-slate-900">CRM could not load</h1><p className="mt-2 text-sm text-slate-600">{(metaQuery.error as Error)?.message || 'Please sign in again.'}</p><button className="mt-4 bg-blue-600 px-4 py-2 text-sm text-white" onClick={() => metaQuery.refetch()}>Retry</button></div></div>;

  const meta = metaQuery.data;
  const displayName = meta.actor.full_name || meta.actor.email.split('@')[0];
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const context = { meta, can, refreshMeta: metaQuery.refetch };

  let page: React.ReactNode;
  switch (active) {
    case 'dashboard': page = can('view_leads') ? <DashboardPage /> : <Navigate to="/lead-push/upload" replace />; break;
    case 'lead-management': page = can('view_leads') ? <LeadManagerPage /> : <Navigate to="/lead-push/upload" replace />; break;
    case 'pipeline': page = can('view_leads') ? <PipelinePage /> : <Navigate to="/lead-push/upload" replace />; break;
    case 'tasks': page = can('manage_tasks') ? <TasksPage /> : <Navigate to="/crm/lead-management" replace />; break;
    case 'activities': page = can('view_leads') ? <ActivitiesPage /> : <Navigate to="/crm/lead-management" replace />; break;
    case 'analytics': page = can('view_reports') ? <ReportsPage /> : <Navigate to="/crm/lead-management" replace />; break;
    case 'users': page = isAdmin ? <UsersPage /> : <Navigate to="/crm/lead-management" replace />; break;
    case 'audit': page = isAdmin ? <AuditPage /> : <Navigate to="/crm/lead-management" replace />; break;
    case 'settings': page = isAdmin ? <SettingsPage /> : <Navigate to="/crm/lead-management" replace />; break;
    default: page = <Navigate to="/crm/dashboard" replace />;
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-[#10264b] text-slate-100">
      <div className="flex h-16 items-center border-b border-white/10 px-4">
        <img src={logo} alt="DekhoCampus CRM" className={cn('h-9 w-auto brightness-0 invert', collapsed && 'mx-auto h-7')} />
      </div>
      {!collapsed && <div className="p-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Search menu" placeholder="Search menu" className="h-9 w-full border border-white/10 bg-white/10 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-blue-400" /></div></div>}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label="CRM navigation">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return <button key={item.id} title={collapsed ? item.label : undefined} onClick={() => { navigate(item.route); setMobileOpen(false); }} className={cn('flex h-11 w-full items-center gap-3 border-l-2 px-3 text-left text-sm transition-colors', selected ? 'border-blue-400 bg-white/10 text-white' : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')}><Icon className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="truncate">{item.label}</span>}</button>;
        })}
        <div className="my-2 border-t border-white/10" />
        <button onClick={() => { navigate('/lead-push/upload'); setMobileOpen(false); }} className={cn('flex h-11 w-full items-center gap-3 border-l-2 border-transparent px-3 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')} title={collapsed ? 'Lead Push' : undefined}><UploadCloud className="h-[18px] w-[18px]" />{!collapsed && <span>Lead Push</span>}</button>
      </nav>
      <button className="hidden h-11 items-center justify-center border-t border-white/10 text-slate-300 hover:bg-white/5 lg:flex" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span className="ml-2 text-xs">Collapse</span></>}</button>
    </div>
  );

  return (
    <CRMContext.Provider value={context}>
      <div className="min-h-screen bg-[#f4f6f9] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <aside className={cn('fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block', collapsed ? 'w-[68px]' : 'w-[236px]')}>{sidebar}</aside>
        {mobileOpen && <><button aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" onClick={() => setMobileOpen(false)} /><aside className="fixed inset-y-0 left-0 z-50 w-[280px] lg:hidden">{sidebar}<button className="absolute right-3 top-4 text-white" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button></aside></>}
        <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[68px]' : 'lg:pl-[236px]')}>
          <header className="sticky top-0 z-30 flex h-16 items-center border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-6">
            <button className="mr-3 text-slate-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1"><p className="truncate text-xs text-slate-500">Dekho Campus Pvt. Ltd.</p><h1 className="truncate text-base font-semibold">{pageTitles[active] || 'CRM'}</h1></div>
            <div className="flex items-center gap-1 sm:gap-2">
              <button className="relative grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Notifications"><Bell className="h-4 w-4" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-red-500" /></button>
              <button className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={toggleTheme} aria-label="Toggle theme">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <div className="relative">
                <button onClick={() => setProfileOpen((value) => !value)} className="ml-1 flex h-10 items-center gap-2 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-expanded={profileOpen}><span className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white">{initials}</span><span className="hidden max-w-36 truncate text-left text-sm md:block">{displayName}</span><ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" /></button>
                {profileOpen && <div className="absolute right-0 mt-2 w-64 border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800"><p className="truncate text-sm font-medium">{displayName}</p><p className="truncate text-xs text-slate-500">{meta.actor.email}</p><p className="mt-1 text-xs capitalize text-blue-600">{meta.actor.role.replace('_', ' ')}</p></div><button onClick={() => void signOut()} className="mt-1 flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><LogOut className="h-4 w-4" />Sign out</button></div>}
              </div>
            </div>
          </header>
          <main className="min-h-[calc(100vh-4rem)] overflow-x-hidden">
            <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>}>{page}</Suspense>
          </main>
        </div>
      </div>
    </CRMContext.Provider>
  );
}
