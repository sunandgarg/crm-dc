import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Settings2, Trash2, UserRoundCog, UsersRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { crmApi, jsonRequest } from './api';
import { useCRM } from './CRMWorkspace';
import type { CRMStage, CRMTeam } from './types';

type SettingsTab = 'stages' | 'teams';
type StageForm = { name: string; color: string; isDefault: boolean };
type TeamForm = { name: string; description: string; managerId: string };

const blankStage: StageForm = { name: '', color: '#2563eb', isDefault: false };
const blankTeam: TeamForm = { name: '', description: '', managerId: '' };

export default function SettingsPage() {
  const { meta, refreshMeta } = useCRM();
  const { toast } = useToast();
  const [tab, setTab] = useState<SettingsTab>('stages');
  const [stageDialog, setStageDialog] = useState<CRMStage | 'new' | null>(null);
  const [stageForm, setStageForm] = useState<StageForm>(blankStage);
  const [teamDialog, setTeamDialog] = useState<CRMTeam | 'new' | null>(null);
  const [teamForm, setTeamForm] = useState<TeamForm>(blankTeam);
  const teamsQuery = useQuery({ queryKey: ['crm-teams-settings'], queryFn: () => crmApi<{ teams: CRMTeam[] }>('/teams') });
  const activeTeams = useMemo(() => (teamsQuery.data?.teams || []).filter((team) => team.is_active).length, [teamsQuery.data]);
  const refresh = () => { void refreshMeta(); void teamsQuery.refetch(); };

  const saveStage = useMutation({
    mutationFn: () => stageDialog === 'new'
      ? crmApi('/stages', jsonRequest('POST', stageForm))
      : crmApi(`/stages/${stageDialog?.id}`, jsonRequest('PATCH', { name: stageForm.name, color: stageForm.color, isDefault: stageForm.isDefault || undefined })),
    onSuccess: () => { toast({ title: stageDialog === 'new' ? 'Lead stage created' : 'Lead stage updated' }); setStageDialog(null); setStageForm(blankStage); refresh(); },
    onError: (error: Error) => toast({ title: 'Could not save lead stage', description: error.message, variant: 'destructive' }),
  });
  const deleteStage = useMutation({
    mutationFn: (stage: CRMStage) => crmApi(`/stages/${stage.id}`, jsonRequest('DELETE')),
    onSuccess: () => { toast({ title: 'Lead stage deleted' }); refresh(); },
    onError: (error: Error) => toast({ title: 'Could not delete lead stage', description: error.message, variant: 'destructive' }),
  });
  const updateStage = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => crmApi(`/stages/${id}`, jsonRequest('PATCH', body)),
    onSuccess: () => refresh(),
    onError: (error: Error) => toast({ title: 'Could not update stage order', description: error.message, variant: 'destructive' }),
  });
  const saveTeam = useMutation({
    mutationFn: () => teamDialog === 'new'
      ? crmApi('/teams', jsonRequest('POST', { ...teamForm, managerId: teamForm.managerId || null }))
      : crmApi(`/teams/${teamDialog?.id}`, jsonRequest('PATCH', { ...teamForm, managerId: teamForm.managerId || null })),
    onSuccess: () => { toast({ title: teamDialog === 'new' ? 'Team created' : 'Team updated' }); setTeamDialog(null); setTeamForm(blankTeam); refresh(); },
    onError: (error: Error) => toast({ title: 'Could not save team', description: error.message, variant: 'destructive' }),
  });
  const toggleTeam = useMutation({
    mutationFn: (team: CRMTeam) => crmApi(`/teams/${team.id}`, jsonRequest('PATCH', { isActive: !team.is_active })),
    onSuccess: () => { toast({ title: 'Team status updated' }); refresh(); },
    onError: (error: Error) => toast({ title: 'Could not update team', description: error.message, variant: 'destructive' }),
  });

  const openStage = (stage: CRMStage | 'new') => {
    setStageDialog(stage);
    setStageForm(stage === 'new' ? blankStage : { name: stage.name, color: stage.color, isDefault: Boolean(stage.is_default) });
  };
  const openTeam = (team: CRMTeam | 'new') => {
    setTeamDialog(team);
    setTeamForm(team === 'new' ? blankTeam : { name: team.name, description: team.description || '', managerId: team.manager_id || '' });
  };
  const moveStage = (index: number, direction: -1 | 1) => {
    const current = meta.stages[index];
    const target = meta.stages[index + direction];
    if (!current || !target) return;
    void Promise.all([
      updateStage.mutateAsync({ id: current.id, body: { sortOrder: target.sort_order } }),
      updateStage.mutateAsync({ id: target.id, body: { sortOrder: current.sort_order } }),
    ]).then(() => toast({ title: 'Stage order updated' }));
  };

  return <div className="space-y-5 p-4 sm:p-6">
    <div><h2 className="text-xl font-semibold">CRM Settings</h2><p className="text-sm text-slate-500">Configure the pipeline and ownership structure used across lead operations.</p></div>
    <div className="flex w-full overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">{[
      { id: 'stages' as const, label: 'Lead Stages', icon: Settings2 },
      { id: 'teams' as const, label: 'Teams & Assignment', icon: UsersRound },
    ].map((item) => <button key={item.id} onClick={() => setTab(item.id)} role="tab" aria-selected={tab === item.id} className={cn('flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm', tab === item.id ? 'border-blue-600 font-medium text-blue-600' : 'border-transparent text-slate-500')}><item.icon className="h-4 w-4" />{item.label}</button>)}</div>

    {tab === 'stages' && <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800"><div><h3 className="font-semibold">Lead Stage Configuration</h3><p className="text-xs text-slate-500">{meta.stages.length} stages in the active pipeline</p></div><button onClick={() => openStage('new')} className="flex h-9 items-center gap-2 bg-blue-600 px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" />Create Stage</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-[#e8edf2] text-left text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="w-24 px-4 py-3">Order</th><th className="px-4 py-3">Stage Name</th><th className="px-4 py-3">Color</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Lead Count</th><th className="w-32 px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{meta.stages.map((stage, index) => <tr key={stage.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="px-4 py-3"><div className="flex gap-1"><button disabled={index === 0 || updateStage.isPending} onClick={() => moveStage(index, -1)} className="grid h-7 w-7 place-items-center border border-slate-300 disabled:opacity-30 dark:border-slate-700" title="Move stage up"><ArrowUp className="h-3.5 w-3.5" /></button><button disabled={index === meta.stages.length - 1 || updateStage.isPending} onClick={() => moveStage(index, 1)} className="grid h-7 w-7 place-items-center border border-slate-300 disabled:opacity-30 dark:border-slate-700" title="Move stage down"><ArrowDown className="h-3.5 w-3.5" /></button></div></td><td className="px-4 py-3 font-medium">{stage.name}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 border border-black/10" style={{ backgroundColor: stage.color }} />{stage.color}</span></td><td className="px-4 py-3">{stage.is_default ? <span className="inline-flex items-center gap-1 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><Check className="h-3.5 w-3.5" />Default</span> : <button onClick={() => updateStage.mutate({ id: stage.id, body: { isDefault: true } })} className="text-xs font-medium text-blue-600">Set default</button>}</td><td className="px-4 py-3 text-slate-500">Available in Lead Manager</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button onClick={() => openStage(stage)} className="grid h-8 w-8 place-items-center border border-slate-300 text-slate-600 dark:border-slate-700" aria-label={`Edit ${stage.name}`}><Pencil className="h-4 w-4" /></button><button disabled={Boolean(stage.is_default) || deleteStage.isPending} onClick={() => { if (window.confirm(`Delete the ${stage.name} stage?`)) deleteStage.mutate(stage); }} className="grid h-8 w-8 place-items-center border border-red-200 text-red-600 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Delete ${stage.name}`} title={stage.is_default ? 'The default stage cannot be deleted' : 'Delete stage'}><Trash2 className="h-4 w-4" /></button></div></td></tr>)}</tbody></table></div>
    </section>}

    {tab === 'teams' && <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800"><div><h3 className="font-semibold">Teams & Ownership</h3><p className="text-xs text-slate-500">{activeTeams} active teams, {(teamsQuery.data?.teams || []).reduce((sum, team) => sum + (team._count?.members || 0), 0)} assigned users</p></div><button onClick={() => openTeam('new')} className="flex h-9 items-center gap-2 bg-blue-600 px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" />Create Team</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-[#e8edf2] text-left text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-3">Team Name</th><th className="px-4 py-3">Manager</th><th className="px-4 py-3">Members</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Status</th><th className="w-36 px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{teamsQuery.isLoading ? <tr><td colSpan={6} className="p-10 text-center text-slate-500">Loading teams...</td></tr> : teamsQuery.data?.teams.length ? teamsQuery.data.teams.map((team) => <tr key={team.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="px-4 py-3 font-medium text-blue-700">{team.name}</td><td className="px-4 py-3"><span className="flex items-center gap-2"><UserRoundCog className="h-4 w-4 text-slate-400" />{team.manager?.full_name || team.manager?.email || '-'}</span></td><td className="px-4 py-3">{team._count?.members || 0}</td><td className="max-w-sm truncate px-4 py-3 text-slate-500">{team.description || '-'}</td><td className="px-4 py-3"><span className={cn('px-2 py-1 text-xs font-medium', team.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800')}>{team.is_active ? 'Active' : 'Inactive'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button onClick={() => openTeam(team)} className="h-8 border border-slate-300 px-3 text-xs font-medium dark:border-slate-700">Edit</button><button onClick={() => toggleTeam.mutate(team)} className={cn('h-8 border px-3 text-xs font-medium', team.is_active ? 'border-red-200 text-red-600' : 'border-emerald-200 text-emerald-700')}>{team.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>) : <tr><td colSpan={6} className="p-10 text-center text-slate-500">No teams configured.</td></tr>}</tbody></table></div>
    </section>}

    <Dialog open={Boolean(stageDialog)} onOpenChange={(open) => { if (!open) setStageDialog(null); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{stageDialog === 'new' ? 'Create Lead Stage' : 'Edit Lead Stage'}</DialogTitle><DialogDescription>Set the stage label and the color used across the lead table and opportunity pipeline.</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); saveStage.mutate(); }} className="space-y-4"><label className="block text-sm font-medium">Stage Name<input required minLength={2} value={stageForm.name} onChange={(event) => setStageForm((value) => ({ ...value, name: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 px-3 dark:border-slate-700 dark:bg-slate-950" /></label><label className="block text-sm font-medium">Stage Color<span className="mt-1 flex h-10 items-center gap-3 border border-slate-300 px-3 dark:border-slate-700"><input type="color" value={stageForm.color} onChange={(event) => setStageForm((value) => ({ ...value, color: event.target.value }))} className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-xs">{stageForm.color}</span></span></label>{!(stageDialog !== 'new' && stageDialog?.is_default) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stageForm.isDefault} onChange={(event) => setStageForm((value) => ({ ...value, isDefault: event.target.checked }))} />Use as the default stage for new leads</label>}<button disabled={saveStage.isPending} className="h-9 w-full bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{saveStage.isPending ? 'Saving...' : 'Save Stage'}</button></form></DialogContent></Dialog>
    <Dialog open={Boolean(teamDialog)} onOpenChange={(open) => { if (!open) setTeamDialog(null); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{teamDialog === 'new' ? 'Create Team' : 'Edit Team'}</DialogTitle><DialogDescription>Group counsellors under a team lead for scoped lead visibility and assignment.</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); saveTeam.mutate(); }} className="space-y-4"><label className="block text-sm font-medium">Team Name<input required minLength={2} value={teamForm.name} onChange={(event) => setTeamForm((value) => ({ ...value, name: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 px-3 dark:border-slate-700 dark:bg-slate-950" /></label><label className="block text-sm font-medium">Team Manager<select value={teamForm.managerId} onChange={(event) => setTeamForm((value) => ({ ...value, managerId: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"><option value="">No manager</option>{meta.users.filter((user) => ['team_lead', 'admin', 'super_admin'].includes(user.role)).map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}</select></label><label className="block text-sm font-medium">Description<textarea rows={3} maxLength={500} value={teamForm.description} onChange={(event) => setTeamForm((value) => ({ ...value, description: event.target.value }))} className="mt-1 w-full resize-none border border-slate-300 p-3 dark:border-slate-700 dark:bg-slate-950" /></label><button disabled={saveTeam.isPending} className="h-9 w-full bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{saveTeam.isPending ? 'Saving...' : 'Save Team'}</button></form></DialogContent></Dialog>
  </div>;
}
