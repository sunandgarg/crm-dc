import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { Activity, CheckCircle2, Download, RefreshCw, Target, UserCheck, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { crmApi } from './api';

interface ReportResponse {
  range: { from: string; to: string };
  stats: { total: number; assigned: number; contacted: number; enrolled: number; conversionRate: number; taskCompletionRate: number };
  stages: Array<{ id: string; name: string; color: string; count: number }>;
  sources: Array<{ name: string; count: number }>;
  owners: Array<{ id: string; name: string; count: number }>;
  activities: Array<{ type: string; count: number }>;
}

const sourceColors = ['#2563eb', '#0f766e', '#ca8a04', '#dc2626', '#7c3aed', '#0891b2', '#4f46e5', '#65a30d'];

function escapeCsv(value: unknown) {
  return `"${String(value ?? '').split('"').join('""')}"`;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const query = useQuery({ queryKey: ['crm-reports', from, to], queryFn: () => crmApi<ReportResponse>(`/reports?from=${from}&to=${to}`), enabled: Boolean(from && to) });
  const data = query.data;
  const statItems = data ? [
    { label: 'Leads Added', value: data.stats.total, icon: Users, suffix: '' },
    { label: 'Assigned', value: data.stats.assigned, icon: UserCheck, suffix: '' },
    { label: 'Contacted', value: data.stats.contacted, icon: Activity, suffix: '' },
    { label: 'Enrollment Conversion', value: data.stats.conversionRate, icon: Target, suffix: '%' },
    { label: 'Task Completion', value: data.stats.taskCompletionRate, icon: CheckCircle2, suffix: '%' },
  ] : [];

  const exportReport = () => {
    if (!data) return;
    const rows: unknown[][] = [
      ['CRM Performance Report', `${from} to ${to}`],
      [],
      ['Metric', 'Value'],
      ['Leads Added', data.stats.total], ['Assigned', data.stats.assigned], ['Contacted', data.stats.contacted], ['Enrolled', data.stats.enrolled], ['Conversion Rate', `${data.stats.conversionRate}%`], ['Task Completion Rate', `${data.stats.taskCompletionRate}%`],
      [], ['Pipeline Stage', 'Leads'], ...data.stages.map((item) => [item.name, item.count]),
      [], ['Lead Source', 'Leads'], ...data.sources.map((item) => [item.name, item.count]),
      [], ['Owner', 'Leads'], ...data.owners.map((item) => [item.name, item.count]),
      [], ['Activity Type', 'Count'], ...data.activities.map((item) => [item.type, item.count]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crm-performance-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Reports & Analytics</h2><p className="text-sm text-slate-500">Lead acquisition, engagement, ownership, and conversion performance.</p></div><div className="flex gap-2"><button onClick={() => query.refetch()} className="grid h-9 w-9 place-items-center border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900" aria-label="Refresh reports"><RefreshCw className="h-4 w-4" /></button><button onClick={exportReport} disabled={!data} className="flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><Download className="h-4 w-4" />Export</button></div></div>
    <div className="flex flex-wrap items-end gap-3 border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><label className="text-xs font-medium text-slate-600 dark:text-slate-300">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block h-9 border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><label className="text-xs font-medium text-slate-600 dark:text-slate-300">To<input type="date" value={to} min={from} max={format(new Date(), 'yyyy-MM-dd')} onChange={(event) => setTo(event.target.value)} className="mt-1 block h-9 border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><span className="pb-2 text-xs text-slate-500">Maximum range: 366 days</span></div>

    {query.isLoading ? <div className="grid min-h-[45vh] place-items-center text-sm text-slate-500">Preparing report...</div> : query.error ? <div className="border border-red-200 bg-white p-6 text-sm text-red-700">{(query.error as Error).message}</div> : data && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{statItems.map((item) => <div key={item.label} className="flex min-h-24 items-start justify-between border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><p className="text-xs text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-semibold">{item.value.toLocaleString()}{item.suffix}</p></div><item.icon className="h-5 w-5 text-blue-600" /></div>)}</section>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Pipeline Performance</h3><p className="text-xs text-slate-500">Lead count by current stage</p></div><div className="p-4"><ResponsiveContainer width="100%" height={300}><BarChart data={data.stages} layout="vertical" margin={{ left: 12, right: 16 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="name" width={112} tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey="count" radius={[0, 2, 2, 0]}>{data.stages.map((item) => <Cell key={item.id} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></div></div>
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Lead Sources</h3><p className="text-xs text-slate-500">Top acquisition sources in this period</p></div><div className="p-4"><ResponsiveContainer width="100%" height={300}><BarChart data={data.sources}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} interval={0} angle={data.sources.length > 6 ? -25 : 0} textAnchor={data.sources.length > 6 ? 'end' : 'middle'} height={55} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="count" radius={[2, 2, 0, 0]}>{data.sources.map((item, index) => <Cell key={item.name} fill={sourceColors[index % sourceColors.length]} />)}</Bar></BarChart></ResponsiveContainer></div></div>
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Lead Ownership</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Leads</th><th className="px-4 py-3">Share</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{data.owners.length ? data.owners.map((owner) => <tr key={owner.id}><td className="px-4 py-3 font-medium">{owner.name}</td><td className="px-4 py-3">{owner.count}</td><td className="px-4 py-3">{data.stats.total ? ((owner.count / data.stats.total) * 100).toFixed(1) : '0.0'}%</td><td className="px-4 py-3 text-right">{owner.id !== 'unassigned' && <button onClick={() => navigate(`/crm/lead-management?ownerId=${owner.id}`)} className="text-xs font-medium text-blue-600">View leads</button>}</td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No ownership data in this period.</td></tr>}</tbody></table></div></div>
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="font-semibold">Communication Activity</h3></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{data.activities.length ? data.activities.map((item) => <div key={item.type} className="flex items-center justify-between px-4 py-3"><span className="capitalize">{item.type.split('_').join(' ')}</span><strong>{item.count.toLocaleString()}</strong></div>) : <p className="p-8 text-center text-sm text-slate-500">No activity logged in this period.</p>}</div></div>
      </section>
    </>}
  </div>;
}
