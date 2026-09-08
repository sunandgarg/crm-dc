import { lazy, memo, Suspense, useMemo, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { appCache } from '@/hooks/useAppCache';

const LeadManagementModule = lazy(() => import('./modules/LeadManagementModule').then((module) => ({ default: module.LeadManagementModule })));
const CRMConfigSettings = lazy(() => import('./modules/CRMConfigSettings').then((module) => ({ default: module.CRMConfigSettings })));
const PipelineView = lazy(() => import('./pipeline/PipelineView').then((module) => ({ default: module.PipelineView })));
const TasksView = lazy(() => import('./tasks/TasksView').then((module) => ({ default: module.TasksView })));
const ActivitiesView = lazy(() => import('./activities/ActivitiesView').then((module) => ({ default: module.ActivitiesView })));
const CRMDashboard = lazy(() => import('./dashboard/CRMDashboard').then((module) => ({ default: module.CRMDashboard })));
const TeamManagement = lazy(() => import('./team/TeamManagement').then((module) => ({ default: module.TeamManagement })));

interface CRMModuleProps {
  universities: any[];
}

export function CRMModule({ universities }: CRMModuleProps) {
  const location = useLocation();
  
  const activeModule = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'crm' ? parts[1] || 'lead-management' : 'lead-management';
  }, [location.pathname]);

  // Persist the CRM sub-tab to cache
  useEffect(() => {
    appCache.setCrmSubTab(activeModule);
  }, [activeModule]);

  let module: React.ReactNode;
  switch (activeModule) {
    case 'lead-management':
      module = <LeadManagementModule universities={universities} />;
      break;
    case 'pipeline':
      module = <div className="container mx-auto px-4 py-6"><PipelineView universities={universities} /></div>;
      break;
    case 'tasks':
      module = <div className="container mx-auto px-4 py-6"><TasksView /></div>;
      break;
    case 'activities':
      module = <div className="container mx-auto px-4 py-6"><ActivitiesView /></div>;
      break;
    case 'analytics':
      module = <div className="container mx-auto px-4 py-6"><CRMDashboard universities={universities} /></div>;
      break;
    case 'team':
      module = <div className="container mx-auto px-4 py-6"><TeamManagement /></div>;
      break;
    case 'settings':
      module = <CRMConfigSettings />;
      break;
    default:
      module = <Navigate to="/crm/lead-management" replace />;
  }
  return <Suspense fallback={<div className="flex min-h-[45vh] items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>{module}</Suspense>;
}

export default memo(CRMModule);
