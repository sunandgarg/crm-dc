import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Bookmark, ChevronLeft, ChevronRight, Columns3, Download, Filter, Mail, MessageSquare,
  MoreHorizontal, Phone, Plus, RefreshCw, Search, Star, Upload, UserRoundCog, X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { crmApi, jsonRequest } from './api';
import { useCRM } from './CRMWorkspace';
import LeadDetailSheet from './LeadDetailSheet';
import type { CRMContact } from './types';

interface ContactsResponse {
  contacts: CRMContact[];
  total: number;
  page: number;
  pageSize: number;
  stageCounts: Record<string, number>;
}

const columns = [
  { id: 'name', label: 'Registered Name' }, { id: 'course', label: 'Course Interested' },
  { id: 'email', label: 'Registered Email' }, { id: 'stage', label: 'Lead Stage' },
  { id: 'score', label: 'Lead Score' }, { id: 'owner', label: 'Lead Owner' },
  { id: 'mobile', label: 'Registered Mobile' }, { id: 'source', label: 'Campaign Source' },
  { id: 'state', label: 'State' }, { id: 'city', label: 'City' },
  { id: 'notes', label: 'Notes Count' }, { id: 'created', label: 'Registered On' },
] as const;

type ColumnId = (typeof columns)[number]['id'];

const defaultColumns = new Set<ColumnId>(['name', 'course', 'email', 'stage', 'score', 'owner', 'mobile', 'source', 'city', 'notes']);

function displayName(person?: { full_name?: string | null; email?: string | null } | null) {
  return person?.full_name || person?.email || 'Unassigned';
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').split('"').join('""')}"`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

export default function LeadManagerPage() {
  const { meta, can, refreshMeta } = useCRM();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importInput = useRef<HTMLInputElement>(null);
  const initialStage = new URLSearchParams(location.search).get('stageId') || '';
  const initialOwner = new URLSearchParams(location.search).get('ownerId') || '';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [stageId, setStageId] = useState(initialStage);
  const [ownerId, setOwnerId] = useState(initialOwner);
  const [source, setSource] = useState('');
  const [priority, setPriority] = useState('');
  const [quickView, setQuickView] = useState('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(defaultColumns);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState<'owner' | 'stage' | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkStage, setBulkStage] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [newLead, setNewLead] = useState({ name: '', email: '', mobile: '', course: '', city: '', state: '', source: '', campaignName: '', stageId: '', ownerId: '', priority: 'Medium' });

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (search.trim()) params.set('search', search.trim());
    if (stageId) params.set('stageId', stageId);
    if (ownerId) params.set('ownerId', ownerId);
    if (source) params.set('source', source);
    if (priority) params.set('priority', priority);
    if (quickView === 'untouched') params.set('untouched', 'true');
    if (quickView === 'mine') params.set('ownerId', 'mine');
    if (quickView === 'followups') params.set('followUp', 'true');
    if (quickView === 'favourites') params.set('favourite', 'true');
    return params.toString();
  }, [page, search, stageId, ownerId, source, priority, quickView]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [search, stageId, ownerId, source, priority, quickView]);
  const contactsQuery = useQuery({ queryKey: ['crm-contacts', queryString], queryFn: () => crmApi<ContactsResponse>(`/contacts?${queryString}`), placeholderData: (previous) => previous });
  const contacts = contactsQuery.data?.contacts || [];
  const total = contactsQuery.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const isAdmin = ['admin', 'super_admin'].includes(meta.actor.role);
  const canUpdate = can('update_leads');
  const canAssign = can('assign_leads');
  const canBulk = canUpdate || canAssign;

  const refresh = async () => {
    await contactsQuery.refetch();
    await queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    await refreshMeta();
  };
  const updateLead = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => crmApi(`/contacts/${id}`, jsonRequest('PATCH', body)),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toast({ title: 'Lead update failed', description: error.message, variant: 'destructive' }),
  });
  const createLead = useMutation({
    mutationFn: () => crmApi('/contacts', jsonRequest('POST', { ...newLead, email: newLead.email || null, stageId: newLead.stageId || null, ownerId: newLead.ownerId || null })),
    onSuccess: () => { toast({ title: 'Lead created successfully' }); setAddOpen(false); setNewLead({ name: '', email: '', mobile: '', course: '', city: '', state: '', source: '', campaignName: '', stageId: '', ownerId: '', priority: 'Medium' }); void refresh(); },
    onError: (error: Error) => toast({ title: 'Could not create lead', description: error.message, variant: 'destructive' }),
  });
  const bulkUpdate = useMutation({
    mutationFn: () => crmApi('/contacts/bulk', jsonRequest('POST', { ids: [...selected], ...(bulkOpen === 'owner' ? { ownerId: bulkOwner || null } : { stageId: bulkStage || null }), reason: bulkReason || undefined })),
    onSuccess: () => { toast({ title: `${selected.size} leads updated` }); setSelected(new Set()); setBulkOpen(null); setBulkOwner(''); setBulkStage(''); setBulkReason(''); void refresh(); },
    onError: (error: Error) => toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' }),
  });
  const saveView = useMutation({
    mutationFn: () => crmApi('/saved-views', jsonRequest('POST', { name: viewName, filters: { search, stageId, ownerId, source, priority, quickView }, columns: [...visibleColumns] })),
    onSuccess: () => { toast({ title: 'View saved' }); setSaveViewOpen(false); setViewName(''); void refreshMeta(); },
    onError: (error: Error) => toast({ title: 'Could not save view', description: error.message, variant: 'destructive' }),
  });

  const applySavedView = (viewId: string) => {
    const view = meta.savedViews.find((item) => item.id === viewId);
    if (!view) return;
    const filters = view.filters as Record<string, string>;
    setSearch(filters.search || ''); setStageId(filters.stageId || ''); setOwnerId(filters.ownerId || ''); setSource(filters.source || ''); setPriority(filters.priority || ''); setQuickView(filters.quickView || 'all');
    if (view.columns?.length) setVisibleColumns(new Set(view.columns as ColumnId[]));
  };
  const toggleSelected = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allSelected = contacts.length > 0 && contacts.every((contact) => selected.has(contact.id));
  const togglePage = () => setSelected((current) => { const next = new Set(current); if (allSelected) contacts.forEach((contact) => next.delete(contact.id)); else contacts.forEach((contact) => next.add(contact.id)); return next; });

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Mobile', 'Course', 'Stage', 'Owner', 'Source', 'State', 'City', 'Lead Score', 'Created'];
    const body = contacts.map((contact) => [contact.name, contact.email, contact.mobile, contact.course, contact.pipeline_stage?.name, displayName(contact.owner), contact.source, contact.state, contact.city, contact.lead_score, contact.created_at].map(csvCell).join(','));
    const blob = new Blob([[header.map(csvCell).join(','), ...body].join('\n')], { type: 'text/csv' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `crm-leads-${format(new Date(), 'yyyy-MM-dd')}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const importCsv = async (file: File) => {
    try {
      const parsed = parseCsv(await file.text());
      const rows = parsed.map((row) => ({ name: row.name || row.registered_name, email: row.email || row.registered_email || null, mobile: row.mobile || row.registered_mobile, course: row.course || row.course_interested || null, city: row.city || null, state: row.state || null, source: row.source || row.campaign_source || 'CSV Import', campaignName: row.campaign || null, priority: ['Low', 'Medium', 'High', 'Urgent'].includes(row.priority) ? row.priority : 'Medium' })).filter((row) => row.name && row.mobile);
      if (!rows.length) throw new Error('CSV needs at least Name and Mobile columns');
      const result = await crmApi<{ inserted: number; skipped: number }>('/contacts/import', jsonRequest('POST', { rows }));
      toast({ title: `${result.inserted} leads imported`, description: `${result.skipped} duplicate or invalid rows skipped.` }); void refresh();
    } catch (error) { toast({ title: 'Import failed', description: (error as Error).message, variant: 'destructive' }); }
    if (importInput.current) importInput.current.value = '';
  };

  return <div className="flex min-h-[calc(100vh-4rem)] flex-col">
    <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><select aria-label="Saved view" onChange={(event) => applySavedView(event.target.value)} className="h-9 max-w-48 border border-slate-300 bg-white px-2 text-sm"><option value="">New view</option>{meta.savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select><button onClick={() => setSaveViewOpen(true)} className="flex h-9 items-center gap-1.5 border border-slate-300 bg-white px-3 text-sm text-blue-600"><Bookmark className="h-4 w-4" />Save View</button><button onClick={() => contactsQuery.refetch()} className="grid h-9 w-9 place-items-center border border-slate-300 bg-white text-slate-500" aria-label="Refresh leads"><RefreshCw className={cn('h-4 w-4', contactsQuery.isFetching && 'animate-spin')} /></button></div>
        <div className="flex flex-wrap gap-2">{can('import_leads') && <><input ref={importInput} className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); }} /><button onClick={() => importInput.current?.click()} className="flex h-9 items-center gap-1.5 border border-slate-300 bg-white px-3 text-sm"><Upload className="h-4 w-4" />Import</button></>}{can('download_leads') && <button onClick={exportCsv} className="flex h-9 items-center gap-1.5 border border-slate-300 bg-white px-3 text-sm"><Download className="h-4 w-4" />Export</button>}{can('add_leads') && <button onClick={() => setAddOpen(true)} className="flex h-9 items-center gap-1.5 bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Add Lead</button>}</div>
      </div>
    </div>

    <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1 xl:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, mobile, course" className="h-10 w-full border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
        <select aria-label="Lead stage filter" value={stageId} onChange={(event) => setStageId(event.target.value)} className="h-10 min-w-40 border border-slate-300 bg-white px-2 text-sm"><option value="">All Lead Stages</option>{meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>
        <select aria-label="Lead owner filter" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="h-10 min-w-44 border border-slate-300 bg-white px-2 text-sm"><option value="">All Owners / Teams</option><option value="unassigned">Unassigned</option><option value="mine">My Leads</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select>
        <select aria-label="Source filter" value={source} onChange={(event) => setSource(event.target.value)} className="h-10 min-w-36 border border-slate-300 bg-white px-2 text-sm"><option value="">All Sources</option>{meta.sources.map((item) => <option key={item}>{item}</option>)}</select>
        <button onClick={() => setAdvancedOpen((value) => !value)} className={cn('flex h-10 items-center gap-1.5 border px-3 text-sm', advancedOpen ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white')}><Filter className="h-4 w-4" />Advanced</button>
        {(search || stageId || ownerId || source || priority || quickView !== 'all') && <button onClick={() => { setSearch(''); setStageId(''); setOwnerId(''); setSource(''); setPriority(''); setQuickView('all'); }} className="grid h-10 w-10 place-items-center border border-slate-300 bg-white text-slate-500" aria-label="Clear filters"><X className="h-4 w-4" /></button>}
      </div>
      {advancedOpen && <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"><label className="text-xs text-slate-500">Priority<select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1 block h-9 min-w-36 border border-slate-300 bg-white px-2 text-sm"><option value="">Any Priority</option><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label><p className="pb-2 text-xs text-slate-400">More filters are available through saved views as your data model grows.</p></div>}
    </div>

    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 sm:px-6" role="tablist" aria-label="Quick lead views">{[
      ['all', 'All Leads', total], ['untouched', 'Untouched', undefined], ['mine', 'My Leads', undefined], ['followups', 'Follow-ups', undefined], ['favourites', 'Favourites', undefined],
    ].map(([id, label, count]) => <button key={String(id)} role="tab" aria-selected={quickView === id} onClick={() => setQuickView(String(id))} className={cn('h-11 shrink-0 border-b-2 px-3 text-sm', quickView === id ? 'border-blue-600 font-medium text-blue-600' : 'border-transparent text-slate-600')}>{label}{count !== undefined && <span className="ml-1.5 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{count}</span>}</button>)}</div>

    {selected.size > 0 && canBulk && <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 sm:px-6"><strong className="mr-2 text-sm text-blue-900">{selected.size} selected</strong>{canAssign && <button onClick={() => setBulkOpen('owner')} className="flex h-8 items-center gap-1.5 border border-blue-300 bg-white px-3 text-xs font-medium text-blue-700"><UserRoundCog className="h-3.5 w-3.5" />Reassign</button>}{canUpdate && <button onClick={() => setBulkOpen('stage')} className="h-8 border border-blue-300 bg-white px-3 text-xs font-medium text-blue-700">Update Stage</button>}<button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-600">Clear selection</button></div>}

    <div className="flex-1 overflow-auto bg-white dark:bg-slate-900">
      <table className="min-w-[1260px] w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-[#e8edf2] text-left text-xs font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Select page" checked={allSelected} disabled={!canBulk} onChange={togglePage} /></th>{columns.filter((column) => visibleColumns.has(column.id)).map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-3">{column.label}</th>)}<th className="w-12 px-3 py-3"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label="Choose columns"><Columns3 className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">{columns.map((column) => <DropdownMenuCheckboxItem key={column.id} checked={visibleColumns.has(column.id)} onCheckedChange={(checked) => setVisibleColumns((current) => { const next = new Set(current); if (checked) next.add(column.id); else next.delete(column.id); return next; })}>{column.label}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu></th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{contactsQuery.isLoading ? <tr><td colSpan={14} className="p-12 text-center text-slate-500">Loading leads...</td></tr> : contacts.length ? contacts.map((contact) => <tr key={contact.id} className={cn('group hover:bg-blue-50/40 dark:hover:bg-slate-800/60', selected.has(contact.id) && 'bg-blue-50 dark:bg-blue-950/20')}><td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${contact.name}`} checked={selected.has(contact.id)} disabled={!canBulk} onChange={() => toggleSelected(contact.id)} /></td>{visibleColumns.has('name') && <td className="px-3 py-2.5"><div className="flex min-w-44 items-center gap-2"><button disabled={!canUpdate} onClick={() => updateLead.mutate({ id: contact.id, body: { favourite: !contact.is_favourite } })} aria-label={`${contact.is_favourite ? 'Remove' : 'Add'} favourite ${contact.name}`}><Star className={cn('h-4 w-4', contact.is_favourite ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} /></button><button onClick={() => setDetailId(contact.id)} className="max-w-48 truncate font-medium text-blue-700 hover:underline">{contact.name}</button><button onClick={() => setDetailId(contact.id)} className="ml-auto opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></button></div></td>}{visibleColumns.has('course') && <td className="max-w-48 truncate px-3 py-2.5">{contact.course || '-'}</td>}{visibleColumns.has('email') && <td className="max-w-56 truncate px-3 py-2.5">{contact.email || '-'}</td>}{visibleColumns.has('stage') && <td className="px-3 py-2"><select aria-label={`Stage for ${contact.name}`} value={contact.stage_id || ''} disabled={!canUpdate} onChange={(event) => updateLead.mutate({ id: contact.id, body: { stageId: event.target.value || null } })} className="h-8 max-w-40 border px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-70" style={{ color: contact.pipeline_stage?.color, borderColor: `${contact.pipeline_stage?.color || '#cbd5e1'}66`, background: `${contact.pipeline_stage?.color || '#94a3b8'}0d` }}><option value="">No stage</option>{meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></td>}{visibleColumns.has('score') && <td className="px-3 py-2.5 font-semibold">{contact.lead_score ?? 0}</td>}{visibleColumns.has('owner') && <td className="px-3 py-2"><select aria-label={`Owner for ${contact.name}`} value={contact.owner_id || ''} disabled={!canAssign} onChange={(event) => updateLead.mutate({ id: contact.id, body: { ownerId: event.target.value || null, reason: 'Inline reassignment' } })} className="h-8 max-w-44 border border-transparent bg-transparent px-1 text-xs hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-70"><option value="">Unassigned</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select></td>}{visibleColumns.has('mobile') && <td className="px-3 py-2.5"><div className="flex items-center gap-2 whitespace-nowrap"><span>{contact.mobile}</span><a href={`https://wa.me/${contact.mobile.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-emerald-600" aria-label={`WhatsApp ${contact.name}`}><MessageSquare className="h-3.5 w-3.5" /></a><a href={`tel:${contact.mobile}`} className="text-blue-600" aria-label={`Call ${contact.name}`}><Phone className="h-3.5 w-3.5" /></a>{contact.email && <a href={`mailto:${contact.email}`} className="text-slate-500" aria-label={`Email ${contact.name}`}><Mail className="h-3.5 w-3.5" /></a>}</div></td>}{visibleColumns.has('source') && <td className="px-3 py-2.5">{contact.source || '-'}</td>}{visibleColumns.has('state') && <td className="px-3 py-2.5">{contact.state || '-'}</td>}{visibleColumns.has('city') && <td className="px-3 py-2.5">{contact.city || '-'}</td>}{visibleColumns.has('notes') && <td className="px-3 py-2.5 text-center">{contact.notes_count || 0}</td>}{visibleColumns.has('created') && <td className="whitespace-nowrap px-3 py-2.5"><p>{format(new Date(contact.created_at), 'dd MMM yyyy')}</p><p className="text-xs text-slate-400">{formatDistanceToNow(new Date(contact.created_at), { addSuffix: true })}</p></td>}<td className="px-3 py-2.5"><button onClick={() => setDetailId(contact.id)} aria-label={`Open ${contact.name}`}><ChevronRight className="h-4 w-4 text-slate-400" /></button></td></tr>) : <tr><td colSpan={14} className="p-12 text-center"><p className="font-medium">No leads match this view</p><p className="mt-1 text-sm text-slate-500">Change filters or add your first lead.</p></td></tr>}</tbody>
      </table>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900 sm:px-6"><p className="text-slate-500">Showing {total ? (page - 1) * 50 + 1 : 0}-{Math.min(page * 50, total)} of {total.toLocaleString()} leads</p><div className="flex items-center gap-2"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="grid h-8 w-8 place-items-center border border-slate-300 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span className="px-2 text-xs">Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="grid h-8 w-8 place-items-center border border-slate-300 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></div>

    <LeadDetailSheet contactId={detailId} onClose={() => setDetailId(null)} onChanged={() => void contactsQuery.refetch()} />
    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Add Lead</DialogTitle><DialogDescription>Create a new admissions lead and optionally assign it immediately.</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); createLead.mutate(); }} className="grid gap-4 sm:grid-cols-2"><LeadField label="Registered Name" required value={newLead.name} onChange={(value) => setNewLead((lead) => ({ ...lead, name: value }))} /><LeadField label="Registered Mobile" required value={newLead.mobile} onChange={(value) => setNewLead((lead) => ({ ...lead, mobile: value }))} /><LeadField label="Registered Email" type="email" value={newLead.email} onChange={(value) => setNewLead((lead) => ({ ...lead, email: value }))} /><LeadField label="Course Interested" value={newLead.course} onChange={(value) => setNewLead((lead) => ({ ...lead, course: value }))} /><LeadField label="State" value={newLead.state} onChange={(value) => setNewLead((lead) => ({ ...lead, state: value }))} /><LeadField label="City" value={newLead.city} onChange={(value) => setNewLead((lead) => ({ ...lead, city: value }))} /><LeadField label="Campaign Source" value={newLead.source} onChange={(value) => setNewLead((lead) => ({ ...lead, source: value }))} /><LeadField label="Campaign Name" value={newLead.campaignName} onChange={(value) => setNewLead((lead) => ({ ...lead, campaignName: value }))} /><label className="text-sm font-medium">Lead Stage<select value={newLead.stageId} onChange={(event) => setNewLead((lead) => ({ ...lead, stageId: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3"><option value="">Default Stage</option>{meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="text-sm font-medium">Lead Owner<select value={canAssign ? newLead.ownerId : meta.actor.id} disabled={!canAssign} onChange={(event) => setNewLead((lead) => ({ ...lead, ownerId: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 disabled:bg-slate-100"><option value={canAssign ? '' : meta.actor.id}>{isAdmin ? 'Unassigned' : 'Assign to me'}</option>{canAssign && meta.users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select></label><label className="text-sm font-medium">Priority<select value={newLead.priority} onChange={(event) => setNewLead((lead) => ({ ...lead, priority: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label><div className="flex items-end justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setAddOpen(false)} className="h-10 border border-slate-300 px-4">Cancel</button><button disabled={createLead.isPending} className="h-10 bg-blue-600 px-5 font-medium text-white disabled:opacity-50">{createLead.isPending ? 'Creating...' : 'Create Lead'}</button></div></form></DialogContent></Dialog>
    <Dialog open={Boolean(bulkOpen)} onOpenChange={(open) => { if (!open) setBulkOpen(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{bulkOpen === 'owner' ? 'Reassign Leads' : 'Update Lead Stage'}</DialogTitle><DialogDescription>Apply this change to {selected.size} selected leads. Every change is logged.</DialogDescription></DialogHeader>{bulkOpen === 'owner' ? <label className="text-sm font-medium">New Owner<select value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3"><option value="">Unassigned</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select></label> : <label className="text-sm font-medium">New Stage<select value={bulkStage} onChange={(event) => setBulkStage(event.target.value)} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3"><option value="">Select stage</option>{meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>}<label className="text-sm font-medium">Remark<textarea value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} className="mt-1 min-h-20 w-full border border-slate-300 p-3" placeholder="Reason for this change" /></label><div className="flex justify-end gap-2"><button onClick={() => setBulkOpen(null)} className="h-9 border border-slate-300 px-4 text-sm">Cancel</button><button disabled={bulkUpdate.isPending || (bulkOpen === 'stage' && !bulkStage)} onClick={() => bulkUpdate.mutate()} className="h-9 bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">Apply Change</button></div></DialogContent></Dialog>
    <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Save Current View</DialogTitle><DialogDescription>Save filters and visible columns for quick reuse.</DialogDescription></DialogHeader><LeadField label="View Name" required value={viewName} onChange={setViewName} /><div className="flex justify-end gap-2"><button onClick={() => setSaveViewOpen(false)} className="h-9 border border-slate-300 px-4 text-sm">Cancel</button><button disabled={!viewName.trim() || saveView.isPending} onClick={() => saveView.mutate()} className="h-9 bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">Save View</button></div></DialogContent></Dialog>
  </div>;
}

function LeadField({ label, value, onChange, required, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  return <label className="text-sm font-medium">{label}{required && <span className="text-red-600"> *</span>}<input type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 outline-none focus:border-blue-500" /></label>;
}
