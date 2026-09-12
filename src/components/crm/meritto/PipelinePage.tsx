import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Mail, Phone, RefreshCw, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { crmApi, jsonRequest } from './api';
import { useCRM } from './CRMWorkspace';
import LeadDetailSheet from './LeadDetailSheet';
import type { CRMContact } from './types';

interface Response { contacts: CRMContact[]; total: number }

export default function PipelinePage() {
  const { meta, can } = useCRM();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['crm-pipeline'], queryFn: () => crmApi<Response>('/contacts?pageSize=200&sortBy=updated_at&sortDirection=desc') });
  const move = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string | null }) => crmApi(`/contacts/${id}`, jsonRequest('PATCH', { stageId, reason: 'Moved on opportunity pipeline' })),
    onSuccess: () => { void query.refetch(); void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] }); },
    onError: (error: Error) => toast({ title: 'Could not move lead', description: error.message, variant: 'destructive' }),
  });
  const contacts = query.data?.contacts || [];
  const stages = [{ id: '', name: 'Unassigned', color: '#64748b', sort_order: -1 }, ...meta.stages];
  const editable = can('update_leads');

  return <div className="flex min-h-[calc(100vh-4rem)] flex-col p-4 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Opportunity Pipeline</h2><p className="text-sm text-slate-500">Drag leads between stages. Stage changes are written to the activity timeline.</p></div><button onClick={() => query.refetch()} className="flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-sm"><RefreshCw className="h-4 w-4" />Refresh</button></div>
    <div className="flex flex-1 gap-3 overflow-x-auto pb-3">
      {stages.map((stage) => {
        const stageContacts = contacts.filter((contact) => (contact.stage_id || '') === stage.id);
        return <section key={stage.id || 'unassigned'} onDragOver={(event) => { if (editable) event.preventDefault(); }} onDrop={() => { if (editable && dragging) move.mutate({ id: dragging, stageId: stage.id || null }); setDragging(null); }} className="flex w-[300px] min-w-[300px] flex-col border border-slate-200 bg-[#eef1f5] dark:border-slate-800 dark:bg-slate-900/60">
          <header className="flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} /><h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{stage.name}</h3><span className="bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">{stageContacts.length}</span></header>
          <div className="min-h-36 flex-1 space-y-2 overflow-y-auto p-2">{stageContacts.map((contact) => <article key={contact.id} draggable={editable} onDragStart={() => { if (editable) setDragging(contact.id); }} onDragEnd={() => setDragging(null)} className="border border-slate-200 bg-white p-3 shadow-sm hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900"><div className="flex items-start gap-2"><GripVertical className={editable ? 'mt-0.5 h-4 w-4 cursor-grab text-slate-300' : 'mt-0.5 h-4 w-4 text-slate-200'} /><button onClick={() => setDetailId(contact.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold text-blue-700">{contact.name}</p><p className="mt-0.5 truncate text-xs text-slate-500">{contact.course || 'Course not specified'}</p></button><span className="text-xs font-semibold text-slate-600">{contact.lead_score ?? 0}</span></div><div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500"><span className="flex min-w-0 items-center gap-1 truncate"><User className="h-3.5 w-3.5" />{contact.owner?.full_name || contact.owner?.email || 'Unassigned'}</span><div className="flex gap-2"><a href={`tel:${contact.mobile}`} aria-label={`Call ${contact.name}`}><Phone className="h-3.5 w-3.5" /></a>{contact.email && <a href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}><Mail className="h-3.5 w-3.5" /></a>}</div></div></article>)}{!stageContacts.length && <div className="grid min-h-24 place-items-center border border-dashed border-slate-300 text-xs text-slate-400">{editable ? 'Drop leads here' : 'No leads'}</div>}</div>
        </section>;
      })}
    </div>
    {query.data && query.data.total > 200 && <p className="mt-2 text-xs text-amber-700">Showing the 200 most recently updated leads. Use Lead Manager for the complete list.</p>}
    <LeadDetailSheet contactId={detailId} onClose={() => setDetailId(null)} onChanged={() => void query.refetch()} />
  </div>;
}
