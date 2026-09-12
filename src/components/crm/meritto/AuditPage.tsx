import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Eye, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { crmApi } from './api';

interface AuditRecord {
  id: string;
  action: string;
  resource: string;
  resource_id?: string | null;
  before?: unknown;
  after?: unknown;
  ip_address?: string | null;
  created_at: string;
  actor?: { full_name?: string | null; email: string } | null;
}

interface AuditResponse {
  logs: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  actions: string[];
  resources: string[];
}

function displayAction(value: string) {
  return value.replace(/^crm\./, '').split('.').join(' / ').split('_').join(' ');
}

function summary(record: AuditRecord) {
  const value = (record.after || record.before) as Record<string, unknown> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '-';
  const preferred = ['name', 'full_name', 'email', 'title', 'reason', 'count'];
  const entries = preferred.flatMap((key) => value[key] === undefined || value[key] === null ? [] : [`${key.split('_').join(' ')}: ${String(value[key])}`]);
  return entries.slice(0, 2).join(' | ') || `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'} recorded`;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return `"${text.split('"').join('""')}"`;
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const params = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (search.trim()) query.set('search', search.trim());
    if (action) query.set('action', action);
    if (resource) query.set('resource', resource);
    return query.toString();
  }, [page, search, action, resource]);
  const query = useQuery({ queryKey: ['crm-audit', params], queryFn: () => crmApi<AuditResponse>(`/audit?${params}`), placeholderData: (previous) => previous });
  const data = query.data;

  const exportPage = () => {
    if (!data?.logs.length) return;
    const rows = [
      ['Time', 'User', 'Action', 'Resource', 'Record ID', 'IP Address', 'Summary'],
      ...data.logs.map((record) => [record.created_at, record.actor?.full_name || record.actor?.email || 'System', record.action, record.resource, record.resource_id || '', record.ip_address || '', summary(record)]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crm-audit-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => { setSearch(''); setAction(''); setResource(''); setPage(1); };
  return <div className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Audit Log</h2><p className="text-sm text-slate-500">A permanent history of CRM data, assignment, access, and configuration changes.</p></div>
      <div className="flex gap-2"><button onClick={() => query.refetch()} className="grid h-9 w-9 place-items-center border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900" aria-label="Refresh audit log"><RefreshCw className="h-4 w-4" /></button><button onClick={exportPage} disabled={!data?.logs.length} className="flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><Download className="h-4 w-4" />Export Page</button></div>
    </div>

    <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-10 w-full border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Search action, user, resource, or record ID" /></div>
        <select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} className="h-10 min-w-48 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">All actions</option>{data?.actions.map((item) => <option key={item} value={item}>{displayAction(item)}</option>)}</select>
        <select value={resource} onChange={(event) => { setResource(event.target.value); setPage(1); }} className="h-10 min-w-44 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">All resources</option>{data?.resources.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        {(search || action || resource) && <button onClick={clearFilters} className="h-10 border border-slate-300 px-3 text-sm text-slate-600 dark:border-slate-700">Clear</button>}
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-[#e8edf2] text-left text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-3">Date & Time</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Resource</th><th className="px-4 py-3">Change Summary</th><th className="px-4 py-3">IP Address</th><th className="w-14 px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{query.isLoading ? <tr><td colSpan={7} className="p-12 text-center text-slate-500">Loading audit history...</td></tr> : data?.logs.length ? data.logs.map((record) => <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="whitespace-nowrap px-4 py-3"><p>{format(new Date(record.created_at), 'dd MMM yyyy')}</p><p className="text-xs text-slate-500">{format(new Date(record.created_at), 'hh:mm:ss a')}</p></td><td className="px-4 py-3"><p className="font-medium">{record.actor?.full_name || 'System'}</p><p className="text-xs text-slate-500">{record.actor?.email || '-'}</p></td><td className="px-4 py-3 capitalize"><span className="inline-flex bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{displayAction(record.action)}</span></td><td className="px-4 py-3"><p>{record.resource}</p><p className="max-w-40 truncate font-mono text-xs text-slate-400">{record.resource_id || '-'}</p></td><td className="max-w-sm truncate px-4 py-3 text-slate-600 dark:text-slate-300">{summary(record)}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{record.ip_address || '-'}</td><td className="px-4 py-3"><button onClick={() => setSelected(record)} className="grid h-8 w-8 place-items-center border border-slate-300 text-slate-600 dark:border-slate-700" aria-label="View audit details"><Eye className="h-4 w-4" /></button></td></tr>) : <tr><td colSpan={7} className="p-12 text-center"><ShieldCheck className="mx-auto mb-3 h-7 w-7 text-slate-300" /><p className="text-sm text-slate-500">No audit records match these filters.</p></td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800"><p className="text-slate-500">{data ? `${data.total.toLocaleString()} records` : 'Loading...'}</p><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-8 w-8 place-items-center border border-slate-300 disabled:opacity-40 dark:border-slate-700" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span>Page {data?.page || page} of {data?.pages || 1}</span><button disabled={!data || page >= data.pages} onClick={() => setPage((value) => value + 1)} className="grid h-8 w-8 place-items-center border border-slate-300 disabled:opacity-40 dark:border-slate-700" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></div>
    </section>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Audit Details</DialogTitle><DialogDescription>{selected ? `${displayAction(selected.action)} on ${selected.resource}` : ''}</DialogDescription></DialogHeader>{selected && <div className="space-y-4"><dl className="grid gap-3 border border-slate-200 p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs uppercase text-slate-500">Actor</dt><dd className="mt-1 font-medium">{selected.actor?.full_name || selected.actor?.email || 'System'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Date</dt><dd className="mt-1 font-medium">{format(new Date(selected.created_at), 'dd MMM yyyy, hh:mm:ss a')}</dd></div><div><dt className="text-xs uppercase text-slate-500">Record ID</dt><dd className="mt-1 break-all font-mono text-xs">{selected.resource_id || '-'}</dd></div><div><dt className="text-xs uppercase text-slate-500">IP Address</dt><dd className="mt-1 font-mono text-xs">{selected.ip_address || '-'}</dd></div></dl><div className="grid gap-4 lg:grid-cols-2"><div><h3 className="mb-2 text-sm font-semibold">Before</h3><pre className="max-h-80 overflow-auto border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(selected.before ?? null, null, 2)}</pre></div><div><h3 className="mb-2 text-sm font-semibold">After</h3><pre className="max-h-80 overflow-auto border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(selected.after ?? null, null, 2)}</pre></div></div></div>}</DialogContent></Dialog>
  </div>;
}
