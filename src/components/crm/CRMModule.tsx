import { lazy, memo, Suspense, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appCache } from '@/hooks/useAppCache';

const CRMModuleHub = lazy(() => import('./CRMModuleHub').then((module) => ({ default: module.CRMModuleHub })));
const LeadManagementModule = lazy(() => import('./modules/LeadManagementModule').then((module) => ({ default: module.LeadManagementModule })));
const MarketingAutomationModule = lazy(() => import('./modules/MarketingAutomationModule').then((module) => ({ default: module.MarketingAutomationModule })));
const WorkflowAutomationModule = lazy(() => import('./modules/WorkflowAutomationModule').then((module) => ({ default: module.WorkflowAutomationModule })));
const ApplicationManagementModule = lazy(() => import('./modules/ApplicationManagementModule').then((module) => ({ default: module.ApplicationManagementModule })));
const AIFeaturesModule = lazy(() => import('./modules/AIFeaturesModule').then((module) => ({ default: module.AIFeaturesModule })));
const AnalyticsReportingModule = lazy(() => import('./modules/AnalyticsReportingModule').then((module) => ({ default: module.AnalyticsReportingModule })));
const PaymentBillingModule = lazy(() => import('./modules/PaymentBillingModule').then((module) => ({ default: module.PaymentBillingModule })));
const OmnichannelCampaignHub = lazy(() => import('./modules/OmnichannelCampaignHub').then((module) => ({ default: module.OmnichannelCampaignHub })));
const CRMConfigSettings = lazy(() => import('./modules/CRMConfigSettings').then((module) => ({ default: module.CRMConfigSettings })));
const FunnelCampaignModule = lazy(() => import('./funnel/FunnelCampaignModule').then((module) => ({ default: module.FunnelCampaignModule })));

interface CRMModuleProps {
  universities: any[];
}

export function CRMModule({ universities }: CRMModuleProps) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const { activeModule, subTab, detailId } = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'crm') {
      return {
        activeModule: parts[1] || 'hub',
        subTab: parts[2] || null,
        detailId: parts[3] || null,
      };
    }
    return { activeModule: 'hub', subTab: null, detailId: null };
  }, [location.pathname]);

  // Persist the CRM sub-tab to cache
  useEffect(() => {
    if (activeModule !== 'hub') {
      appCache.setCrmSubTab(activeModule);
    }
  }, [activeModule]);

  let module: React.ReactNode;
  switch (activeModule) {
    case 'lead-management':
      module = <LeadManagementModule universities={universities} />;
      break;
    case 'marketing-automation':
      module = <MarketingAutomationModule />;
      break;
    case 'workflow-automation':
      module = <WorkflowAutomationModule />;
      break;
    case 'application-management':
      module = <ApplicationManagementModule />;
      break;
    case 'ai-features':
      module = <AIFeaturesModule />;
      break;
    case 'analytics-reporting':
      module = <AnalyticsReportingModule />;
      break;
    case 'payment-billing':
      module = <PaymentBillingModule />;
      break;
    case 'omnichannel':
      module = <OmnichannelCampaignHub />;
      break;
    case 'funnel-campaigns':
      module = <FunnelCampaignModule />;
      break;
    case 'crm-settings':
      module = <CRMConfigSettings />;
      break;
    case 'hub':
    default:
      module = <CRMModuleHub universities={universities} />;
  }
  return <Suspense fallback={<div className="flex min-h-[45vh] items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>{module}</Suspense>;
}

export default memo(CRMModule);
