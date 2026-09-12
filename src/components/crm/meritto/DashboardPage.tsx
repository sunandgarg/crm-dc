import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { AlertCircle, ArrowRight, Clock3, PhoneCall, RefreshCw, UserPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { crmApi } from './api';
import type { CRMActivity, CRMStage, CRMTask } from './types';

interface DashboardResponse {
  stats: { total: number; newToday: number; untouched: number; overdue: number };
  stages: Array<Pick<CRMStage, 'id' | 'name' | 'color'> & { count: number }>;
  activities: CRMActivity[];
  tasks: CRMTask[];
  trend: Array<{ date: string; label: string; leads: number }>;
}

const statItems = [
  { key: 'total', label: 'Total Leads', hint: 'All accessible leads', icon: Users, color: 'text-blue-600' },
  { key: 'newToday', label: 'New Today', hint: 'Created since midnight', icon: UserPlus, color: 'text-emerald-600' },
  { key: 'untouched', label: 'Untouched', hint: 'No communication logged', icon: PhoneCall, color: 'text-amber-600' },
  { key: 'overdue', label: 'Overdue Follow-ups', hint: 'Needs attention now', icon: AlertCircle, color: 'text-red-600' },
] as const;

export default function DashboardPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['crm-dashboard'], queryFn: () => crmApi<DashboardResponse>('/dashboard'), refetchInterval: 60_000 });
  if (query.isLoading) return <div className="grid min-h-[55vh] place-items-center text-sm text-slate-500">Loading dashboard...</div>;
  if (!query.data) return <div className="m-6 border border-red-200 bg-white p-6 text-sm text-red-700">{(query.error as Error)?.message || 'Dashboard data is unavailable.'}</div>;
  const { stats, stages, activities, tasks, trend } = query.data;

  return <div className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Enrollment overview</h2><p className="text-sm text-slate-500">Live lead, follow-up, and team activity.</p></div>
      <button onClick={() => query.refetch()} className="flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"><RefreshCw className="h-4 w-4" />Refresh</button>
    </div>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Lead statistics">
      {statItems.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => navigate(item.key === 'overdue' ? '/crm/tasks' : '/crm/lead-management')} className="flex min-h-28 items-start justify-between border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-semibold">{stats[item.key].toLocaleString()}</p><p className="mt-1 text-xs text-slate-400">{item.hint}</p></div><Icon className={`h-5 w-5 ${item.color}`} /></button>; })}
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <div className="border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Lead acquisition</h3><p className="text-xs text-slate-500">Last seven days</p></div></div>
        <ResponsiveContainer width="100%" height={250}><AreaChart data={trend}><defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.25}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12}/><Tooltip/><Area type="monotone" dataKey="leads" stroke="#2563eb" strokeWidth={2} fill="url(#leadFill)" /></AreaChart></ResponsiveContainer>
      </div>
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Pipeline distribution</h3></div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">{stages.map((stage) => <button key={stage.id} onClick={() => navigate(`/crm/lead-management?stageId=${stage.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} /><span className="flex-1 text-left">{stage.name}</span><strong>{stage.count}</strong><ArrowRight className="h-4 w-4 text-slate-400" /></button>)}</div>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Upcoming work</h3><button onClick={() => navigate('/crm/tasks')} className="text-xs font-medium text-blue-600">View all</button></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{tasks.length ? tasks.map((task) => <div key={task.id} className="flex items-start gap-3 px-4 py-3"><Clock3 className="mt-0.5 h-4 w-4 text-amber-600"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="mt-0.5 text-xs text-slate-500">{task.contact?.name || 'General task'} {task.due_at ? `- ${format(new Date(task.due_at), 'dd MMM, hh:mm a')}` : ''}</p></div><span className="text-xs capitalize text-slate-500">{task.priority}</span></div>) : <p className="p-6 text-center text-sm text-slate-500">No pending tasks.</p>}</div></div>
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Recent activity</h3><button onClick={() => navigate('/crm/activities')} className="text-xs font-medium text-blue-600">View all</button></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{activities.length ? activities.slice(0, 6).map((activity) => <div key={activity.id} className="px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{activity.title}</p><p className="truncate text-xs text-slate-500">{activity.contact?.name} - {activity.created_by || activity.actor?.full_name || 'System'}</p></div><span className="shrink-0 text-xs text-slate-400">{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</span></div></div>) : <p className="p-6 text-center text-sm text-slate-500">No activity yet.</p>}</div></div>
    </section>
  </div>;
}
