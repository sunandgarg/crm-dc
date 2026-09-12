import { useState } from 'react';
import { Activity, BarChart3, ChevronDown, ListTodo, Settings, SlidersHorizontal, UploadCloud, Users, Workflow } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const sections = [
  { route: '/crm/lead-management', label: 'Lead Manager', icon: Users },
  { route: '/crm/pipeline', label: 'Pipeline', icon: Workflow },
  { route: '/crm/tasks', label: 'Tasks', icon: ListTodo },
  { route: '/crm/activities', label: 'Activities', icon: Activity },
  { route: '/crm/analytics', label: 'Analytics', icon: BarChart3 },
  { route: '/crm/team', label: 'Team', icon: SlidersHorizontal },
  { route: '/crm/settings', label: 'Setup', icon: Settings },
  { route: '/lead-push/upload', label: 'Lead Push', icon: UploadCloud },
];

export function TabNavigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const current = sections.find((section) => location.pathname.startsWith(section.route)) ?? sections[0];
  const CurrentIcon = current.icon;

  return (
    <nav className="border-b border-border bg-card" aria-label="CRM sections">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="hidden md:flex gap-1 overflow-x-auto scrollbar-hide">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = current.route === section.route;
            return (
              <button key={section.route} onClick={() => navigate(section.route)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap ${active ? 'border-primary bg-primary/5 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                <Icon className="h-4 w-4" />{section.label}
              </button>
            );
          })}
        </div>
        <div className="md:hidden">
          <button onClick={() => setMobileOpen((open) => !open)} className="flex w-full items-center justify-between py-3 text-sm font-medium" aria-expanded={mobileOpen}>
            <span className="flex items-center gap-2 text-primary"><CurrentIcon className="h-4 w-4" />{current.label}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileOpen ? 'rotate-180' : ''}`} />
          </button>
          {mobileOpen && <div className="grid grid-cols-2 gap-1 pb-3">{sections.map((section) => { const Icon = section.icon; return <button key={section.route} onClick={() => { navigate(section.route); setMobileOpen(false); }} className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><Icon className="h-4 w-4" />{section.label}</button>; })}</div>}
        </div>
      </div>
    </nav>
  );
}
