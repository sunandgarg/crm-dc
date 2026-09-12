import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarClock, CheckCircle2, Clock3, Mail, MessageSquare, Phone, Save, UserRoundCog } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { crmApi, jsonRequest } from './api';
import { useCRM } from './CRMWorkspace';
import type { CRMContact } from './types';

interface Props {
  contactId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const tabs = ['Overview', 'Activity', 'Tasks', 'Assignment'] as const;

function personName(person?: { full_name?: string | null; email?: string | null } | null) {
  return person?.full_name || person?.email || 'Unassigned';
}

export default function LeadDetailSheet({ contactId, onClose, onChanged }: Props) {
  const { meta, can } = useCRM();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview');
  const [editing, setEditing] = useState(false);
  const [activity, setActivity] = useState({ type: 'note', title: '', description: '', outcome: '', nextFollowUp: '', createTask: true });
  const query = useQuery({ queryKey: ['crm-contact-detail', contactId], queryFn: () => crmApi<{ contact: CRMContact }>(`/contacts/${contactId}`), enabled: Boolean(contactId) });
  const contact = query.data?.contact;
  const canUpdate = can('update_leads');
  const canAssign = can('assign_leads');

  const refresh = async () => {
    await query.refetch();
    await queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    onChanged();
  };
  const update = useMutation({
    mutationFn: (body: unknown) => crmApi(`/contacts/${contactId}`, jsonRequest('PATCH', body)),
    onSuccess: () => { toast({ title: 'Lead updated' }); void refresh(); },
    onError: (error: Error) => toast({ title: 'Update failed', description: error.message, variant: 'destructive' }),
  });
  const addActivity = useMutation({
    mutationFn: () => crmApi(`/contacts/${contactId}/activities`, jsonRequest('POST', { ...activity, nextFollowUp: activity.nextFollowUp ? new Date(activity.nextFollowUp).toISOString() : undefined })),
    onSuccess: () => { toast({ title: 'Activity logged' }); setActivity({ type: 'note', title: '', description: '', outcome: '', nextFollowUp: '', createTask: true }); void refresh(); },
    onError: (error: Error) => toast({ title: 'Could not log activity', description: error.message, variant: 'destructive' }),
  });

  return <Sheet open={Boolean(contactId)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
      {query.isLoading || !contact ? <div className="grid min-h-full place-items-center text-sm text-slate-500">Loading lead profile...</div> : <>
        <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0"><SheetTitle className="truncate text-xl">{contact.name}</SheetTitle><SheetDescription className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><span>{contact.email || 'No email'}</span><span>{contact.mobile}</span><span>Lead score: {contact.lead_score ?? 0}</span></SheetDescription></div>
            <span className="shrink-0 border px-2 py-1 text-xs font-medium" style={{ color: contact.pipeline_stage?.color, borderColor: `${contact.pipeline_stage?.color || '#94a3b8'}55`, backgroundColor: `${contact.pipeline_stage?.color || '#94a3b8'}12` }}>{contact.pipeline_stage?.name || 'Unassigned stage'}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-500">Lead Stage<select aria-label="Lead stage" disabled={!canUpdate} value={contact.stage_id || ''} onChange={(event) => update.mutate({ stageId: event.target.value || null })} className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-100"><option value="">Unassigned</option>{meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-500">Lead Owner<select aria-label="Lead owner" disabled={!canAssign} value={contact.owner_id || ''} onChange={(event) => update.mutate({ ownerId: event.target.value || null, reason: 'Changed from lead profile' })} className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-100"><option value="">Unassigned</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{personName(user)}</option>)}</select></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`tel:${contact.mobile}`} className="flex h-8 items-center gap-1.5 border border-slate-300 px-3 text-xs font-medium hover:bg-slate-50"><Phone className="h-3.5 w-3.5" />Call</a>
            <a href={`mailto:${contact.email || ''}`} className="flex h-8 items-center gap-1.5 border border-slate-300 px-3 text-xs font-medium hover:bg-slate-50"><Mail className="h-3.5 w-3.5" />Email</a>
            <a href={`https://wa.me/${contact.mobile.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 border border-emerald-300 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><MessageSquare className="h-3.5 w-3.5" />WhatsApp</a>
          </div>
        </SheetHeader>

        <div className="flex overflow-x-auto border-b border-slate-200 px-5">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`h-11 shrink-0 border-b-2 px-4 text-sm ${tab === item ? 'border-blue-600 font-medium text-blue-600' : 'border-transparent text-slate-500'}`}>{item}</button>)}</div>

        <div className="p-5">
          {tab === 'Overview' && <Overview key={contact.id} contact={contact} editable={canUpdate} editing={editing} onEdit={() => setEditing(true)} onCancel={() => setEditing(false)} onSave={(body) => update.mutate(body, { onSuccess: () => setEditing(false) })} saving={update.isPending} />}
          {tab === 'Activity' && <div className="space-y-5"><form onSubmit={(event) => { event.preventDefault(); addActivity.mutate(); }} className="border border-slate-200 bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Activity Type<select value={activity.type} onChange={(event) => setActivity((value) => ({ ...value, type: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option></select></label><label className="text-xs font-medium text-slate-600">Subject<input required value={activity.title} onChange={(event) => setActivity((value) => ({ ...value, title: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-3 text-sm" placeholder="What happened?" /></label></div><label className="mt-3 block text-xs font-medium text-slate-600">Details<textarea value={activity.description} onChange={(event) => setActivity((value) => ({ ...value, description: event.target.value }))} className="mt-1 min-h-20 w-full border border-slate-300 bg-white p-3 text-sm" placeholder="Conversation notes and outcome" /></label><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Outcome<input value={activity.outcome} onChange={(event) => setActivity((value) => ({ ...value, outcome: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-3 text-sm" /></label><label className="text-xs font-medium text-slate-600">Next Follow-up<input type="datetime-local" value={activity.nextFollowUp} onChange={(event) => setActivity((value) => ({ ...value, nextFollowUp: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-3 text-sm" /></label></div>{activity.nextFollowUp && <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={activity.createTask} onChange={(event) => setActivity((value) => ({ ...value, createTask: event.target.checked }))} />Create a follow-up task for me</label>}<button disabled={addActivity.isPending} className="mt-4 h-9 bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{addActivity.isPending ? 'Saving...' : 'Log Activity'}</button></form><Timeline activities={contact.activities || []} /></div>}
          {tab === 'Tasks' && <div className="divide-y divide-slate-200 border border-slate-200">{contact.tasks?.length ? contact.tasks.map((task) => <div key={task.id} className="flex items-start gap-3 p-4"><span className={`mt-0.5 grid h-6 w-6 place-items-center rounded-full ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{task.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="font-medium">{task.title}</p><p className="text-sm text-slate-500">{task.description || 'No description'}</p><p className="mt-1 text-xs text-slate-400">Due {task.due_at ? format(new Date(task.due_at), 'dd MMM yyyy, hh:mm a') : 'not set'} - {personName(task.assignee)}</p></div></div>) : <p className="p-8 text-center text-sm text-slate-500">No tasks for this lead.</p>}</div>}
          {tab === 'Assignment' && <div className="divide-y divide-slate-200 border border-slate-200">{contact.assignment_history?.length ? contact.assignment_history.map((item) => <div key={item.id} className="flex items-start gap-3 p-4"><UserRoundCog className="mt-0.5 h-5 w-5 text-blue-600" /><div><p className="text-sm"><strong>{personName(item.from_owner)}</strong> to <strong>{personName(item.to_owner)}</strong></p><p className="text-xs text-slate-500">{item.reason || 'No remark'} - by {personName(item.changed_by)}</p><p className="mt-1 text-xs text-slate-400">{format(new Date(item.created_at), 'dd MMM yyyy, hh:mm a')}</p></div></div>) : <p className="p-8 text-center text-sm text-slate-500">No assignment changes yet.</p>}</div>}
        </div>
      </>}
    </SheetContent>
  </Sheet>;
}

function Overview({ contact, editable, editing, onEdit, onCancel, onSave, saving }: { contact: CRMContact; editable: boolean; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: (body: unknown) => void; saving: boolean }) {
  const [form, setForm] = useState({ name: contact.name, email: contact.email || '', mobile: contact.mobile, alternateMobile: contact.alternate_mobile || '', course: contact.course || '', specialization: contact.specialization || '', state: contact.state || '', city: contact.city || '', source: contact.source || '', medium: contact.medium || '', campaignName: contact.campaign_name || '', priority: contact.priority || 'Medium', leadScore: contact.lead_score ?? 50, nextFollowUp: contact.next_follow_up ? contact.next_follow_up.slice(0, 16) : '', notes: contact.notes || '' });
  const rows = [['Registered Email', contact.email || '-'], ['Registered Mobile', contact.mobile], ['Alternate Mobile', contact.alternate_mobile || '-'], ['Course Interested', contact.course || '-'], ['Specialization', contact.specialization || '-'], ['State / City', [contact.state, contact.city].filter(Boolean).join(' / ') || '-'], ['Campaign Source', contact.source || '-'], ['Campaign / Medium', [contact.campaign_name, contact.medium].filter(Boolean).join(' / ') || '-'], ['Priority', contact.priority || 'Medium'], ['Created', format(new Date(contact.created_at), 'dd MMM yyyy, hh:mm a')], ['Last Contacted', contact.last_contacted_at ? format(new Date(contact.last_contacted_at), 'dd MMM yyyy, hh:mm a') : 'Untouched'], ['Next Follow-up', contact.next_follow_up ? format(new Date(contact.next_follow_up), 'dd MMM yyyy, hh:mm a') : '-']];
  if (!editing) return <>{editable && <div className="mb-3 flex justify-end"><button onClick={onEdit} className="h-9 border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">Edit Details</button></div>}<dl className="grid border border-slate-200 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="border-b border-slate-100 p-3 sm:border-r"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>{contact.notes && <div className="mt-4 border border-slate-200 p-4"><p className="text-xs font-medium text-slate-500">Internal Notes</p><p className="mt-2 whitespace-pre-wrap text-sm">{contact.notes}</p></div>}</>;
  const field = (key: keyof typeof form, label: string, type = 'text') => <label className="text-xs font-medium text-slate-600">{label}<input type={type} value={String(form[key])} onChange={(event) => setForm((value) => ({ ...value, [key]: type === 'number' ? Number(event.target.value) : event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 px-3 text-sm" /></label>;
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, email: form.email || null, nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null }); }}><div className="grid gap-3 sm:grid-cols-2">{field('name', 'Name')}{field('email', 'Email', 'email')}{field('mobile', 'Mobile')}{field('alternateMobile', 'Alternate Mobile')}{field('course', 'Course')}{field('specialization', 'Specialization')}{field('state', 'State')}{field('city', 'City')}{field('source', 'Source')}{field('campaignName', 'Campaign')}{field('medium', 'Medium')}{field('leadScore', 'Lead Score', 'number')}<label className="text-xs font-medium text-slate-600">Priority<select value={form.priority} onChange={(event) => setForm((value) => ({ ...value, priority: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label>{field('nextFollowUp', 'Next Follow-up', 'datetime-local')}</div><label className="mt-3 block text-xs font-medium text-slate-600">Internal Notes<textarea value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} className="mt-1 min-h-24 w-full border border-slate-300 p-3 text-sm" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="h-9 border border-slate-300 px-4 text-sm">Cancel</button><button disabled={saving} className="flex h-9 items-center gap-2 bg-blue-600 px-4 text-sm font-medium text-white"><Save className="h-4 w-4" />Save Details</button></div></form>;
}

function Timeline({ activities }: { activities: NonNullable<CRMContact['activities']> }) {
  if (!activities.length) return <p className="border border-slate-200 p-8 text-center text-sm text-slate-500">No activity yet.</p>;
  const icons: Record<string, typeof Phone> = { call: Phone, email: Mail, whatsapp: MessageSquare, meeting: CalendarClock, note: MessageSquare };
  return <div className="space-y-0 border border-slate-200">{activities.map((item) => { const Icon = icons[item.type] || Clock3; return <div key={item.id} className="flex gap-3 border-b border-slate-100 p-4 last:border-0"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{item.title}</p><span className="text-xs text-slate-400">{format(new Date(item.created_at), 'dd MMM, hh:mm a')}</span></div>{item.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.description}</p>}<p className="mt-1 text-xs text-slate-400">{item.outcome || item.type} - {item.created_by || 'System'}</p></div></div>; })}</div>;
}
