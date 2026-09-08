import { memo, useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Plus, Search, Download, Upload, LayoutGrid, List,
  Phone, Mail, MessageSquare, Star, ChevronDown, SlidersHorizontal, Users, Loader2,
  Clock3, CalendarClock, UserRoundCog, FileSpreadsheet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const SOURCES = ['Google Ads', 'Meta Ads', 'Organic', 'Walk-in', 'Referral', 'Website', 'WhatsApp'];

const ALL_COLUMNS = [
  { key: 'name', label: 'Name', default: true },
  { key: 'mobile', label: 'Mobile', default: true },
  { key: 'email', label: 'Email', default: true },
  { key: 'source', label: 'Source', default: true },
  { key: 'stage', label: 'Stage', default: true },
  { key: 'score', label: 'Score', default: true },
  { key: 'course', label: 'Course', default: false },
  { key: 'city', label: 'City', default: false },
  { key: 'counselor', label: 'Counselor', default: true },
  { key: 'createdAt', label: 'Created', default: false },
];

const stageColors: Record<string, string> = {
  'Inquiry': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Follow-up': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Application': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'Enrolled': 'bg-green-500/10 text-green-600 border-green-500/20',
  'Lost': 'bg-red-500/10 text-red-600 border-red-500/20',
};

interface LeadManagementModuleProps {
  universities?: any[];
}

export function LeadManagementModule({ universities }: LeadManagementModuleProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key)));
  const [showAddLead, setShowAddLead] = useState(false);
  const [showLeadDetail, setShowLeadDetail] = useState<string | null>(null);
  const [savedView, setSavedView] = useState('All Leads');
  const [activityType, setActivityType] = useState('note');
  const [activityNote, setActivityNote] = useState('');
  const [draggedLead, setDraggedLead] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // New lead form state
  const [newLead, setNewLead] = useState({ name: '', mobile: '', email: '', source: '', course: '', city: '' });

  // Fetch pipeline stages
  const { data: stages = [] } = useQuery({
    queryKey: ['pipeline-stages-lead-mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipeline_stages').select('*').order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const stageNames = useMemo(() => stages.map(s => s.name), [stages]);
  const stageMap = useMemo(() => Object.fromEntries(stages.map(s => [s.id, s.name])), [stages]);

  // Fetch contacts from DB
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['crm-leads-management'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('*, pipeline_stages(name)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  // Lead freshness helper (2026 SLA feature)
  const getLeadFreshness = (createdAt: string) => {
    const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    if (hours < 1) return { label: 'Hot', color: 'bg-red-500/10 text-red-600 border-red-500/20' };
    if (hours < 24) return { label: 'Fresh', color: 'bg-green-500/10 text-green-600 border-green-500/20' };
    if (hours < 72) return { label: 'Warm', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
    return { label: 'Aging', color: 'bg-muted text-muted-foreground' };
  };

  // Map contacts to lead format
  const leads = useMemo(() => contacts.map(c => ({
    id: c.id,
    name: c.name,
    email: c.email || '',
    mobile: c.mobile,
    source: c.source || 'Unknown',
    stage: (c as any).pipeline_stages?.name || 'Inquiry',
    stageId: c.stage_id,
    score: c.lead_score || 0,
    course: c.course || '',
    city: c.city || '',
    counselor: c.assigned_to ? 'Assigned' : 'Unassigned',
    createdAt: c.created_at ? new Date(c.created_at).toLocaleDateString() : '',
    rawCreatedAt: c.created_at || '',
    freshness: getLeadFreshness(c.created_at || new Date().toISOString()),
    priority: c.priority || 'Medium',
    favourite: Boolean(c.custom_fields?.favourite),
    lastContactedAt: c.last_contacted_at || null,
    nextFollowUp: c.next_follow_up || null,
    notes: c.notes || '',
    raw: c,
  })), [contacts]);

  const filteredLeads = useMemo(() => leads.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(searchTerm.toLowerCase()) || l.email.toLowerCase().includes(searchTerm.toLowerCase()) || l.mobile.includes(searchTerm);
    const matchView = savedView === 'All Leads'
      || (savedView === 'Untouched' && !l.lastContactedAt)
      || (savedView === 'My Follow-ups' && Boolean(l.nextFollowUp))
      || (savedView === 'Applications' && l.stage === 'Application')
      || (savedView === 'Favourites' && l.favourite);
    return matchSearch && matchView && (sourceFilter === 'all' || l.source === sourceFilter) && (stageFilter === 'all' || l.stage === stageFilter);
  }), [leads, searchTerm, sourceFilter, stageFilter, savedView]);

  const activeLead = useMemo(() => leads.find(lead => lead.id === showLeadDetail) || null, [leads, showLeadDetail]);

  const { data: activeActivities = [] } = useQuery({
    queryKey: ['crm-lead-activities', showLeadDetail],
    enabled: Boolean(showLeadDetail),
    queryFn: async () => {
      const { data, error } = await supabase.from('crm_activities').select('*').eq('contact_id', showLeadDetail).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Add lead mutation
  const addLeadMutation = useMutation({
    mutationFn: async () => {
      if (!newLead.name.trim() || !newLead.mobile.trim()) throw new Error('Name and mobile required');
      const defaultStage = stages.find(s => s.name === 'Inquiry') || stages[0];
      const { error } = await supabase.from('crm_contacts').insert({
        name: newLead.name,
        mobile: newLead.mobile,
        email: newLead.email || null,
        source: newLead.source || null,
        course: newLead.course || null,
        city: newLead.city || null,
        stage_id: defaultStage?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-leads-management'] });
      toast({ title: 'Lead Added', description: 'New lead created successfully' });
      setShowAddLead(false);
      setNewLead({ name: '', mobile: '', email: '', source: '', course: '', city: '' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  // Kanban stage change
  const handleKanbanDrop = useCallback(async (leadId: string, newStageName: string) => {
    const stage = stages.find(s => s.name === newStageName);
    if (!stage) return;
    const { error } = await supabase.from('crm_contacts').update({ stage_id: stage.id }).eq('id', leadId);
    if (!error) queryClient.invalidateQueries({ queryKey: ['crm-leads-management'] });
    setDraggedLead(null);
  }, [stages, queryClient]);

  const updateContacts = async (ids: string[], values: Record<string, unknown>) => {
    const { error } = await supabase.from('crm_contacts').update(values).in('id', ids);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ['crm-leads-management'] });
  };

  const assignSelectedToMe = async () => {
    await updateContacts([...selectedLeads], { assigned_to: (user?.user_metadata as any)?.full_name || user?.email || 'Current user' });
    toast({ title: 'Leads assigned', description: `${selectedLeads.size} leads are now assigned to you.` });
    setSelectedLeads(new Set());
  };

  const moveSelectedToStage = async (stageId: string) => {
    await updateContacts([...selectedLeads], { stage_id: stageId });
    toast({ title: 'Stage updated', description: `${selectedLeads.size} leads moved successfully.` });
    setSelectedLeads(new Set());
  };

  const exportCsv = (items = filteredLeads) => {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Mobile', 'Email', 'Source', 'Stage', 'Score', 'Course', 'City', 'Owner'], ...items.map(lead => [lead.name, lead.mobile, lead.email, lead.source, lead.stage, lead.score, lead.course, lead.city, lead.raw.assigned_to || ''])];
    const blob = new Blob([rows.map(row => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file?: File) => {
    if (!file) return;
    const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
    const cells = (line: string) => line.split(',').map(value => value.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    const headers = cells(lines.shift() || '').map(value => value.toLowerCase());
    const defaultStage = stages.find(stage => stage.name === 'Inquiry') || stages[0];
    const records = lines.map(line => {
      const values = cells(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
      return { name: row.name || row['full name'], mobile: row.mobile || row.phone, email: row.email || null, source: row.source || 'CSV Import', course: row.course || null, city: row.city || null, stage_id: defaultStage?.id || null };
    }).filter(row => row.name && row.mobile);
    if (!records.length) return toast({ title: 'No valid rows', description: 'CSV needs Name and Mobile columns.', variant: 'destructive' });
    const { error } = await supabase.from('crm_contacts').insert(records);
    if (error) return toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    await queryClient.invalidateQueries({ queryKey: ['crm-leads-management'] });
    toast({ title: 'Import complete', description: `${records.length} leads added.` });
  };

  const toggleFavourite = async (lead: any) => {
    await updateContacts([lead.id], { custom_fields: { ...(lead.raw.custom_fields || {}), favourite: !lead.favourite } });
  };

  const addActivity = async () => {
    if (!activeLead || !activityNote.trim()) return;
    const { error } = await supabase.from('crm_activities').insert({ contact_id: activeLead.id, type: activityType, title: activityType === 'note' ? 'Counsellor note' : `${activityType[0].toUpperCase()}${activityType.slice(1)} interaction`, description: activityNote.trim(), created_by: user?.email || null, completed_at: new Date().toISOString() });
    if (error) return toast({ title: 'Activity not saved', description: error.message, variant: 'destructive' });
    setActivityNote('');
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['crm-lead-activities', activeLead.id] }), updateContacts([activeLead.id], { last_contacted_at: new Date().toISOString() })]);
    toast({ title: 'Activity recorded' });
  };

  const toggleColumn = (key: string) => setVisibleColumns(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleSelectLead = (id: string) => setSelectedLeads(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = () => setSelectedLeads(prev => prev.size === filteredLeads.length ? new Set() : new Set(filteredLeads.map(l => l.id)));
  const getScoreColor = (score: number) => score >= 70 ? 'text-green-500' : score >= 40 ? 'text-amber-500' : 'text-red-500';

  const displayStages = stageNames.length > 0 ? stageNames : ['Inquiry', 'Follow-up', 'Application', 'Enrolled', 'Lost'];

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6 text-blue-500" /> Smart Lead Manager</h1>
            <p className="text-muted-foreground">Manage, score, and track all leads in one place</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowAddLead(true)} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add Lead</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {displayStages.slice(0, 5).map(stage => (
          <Card key={stage}><CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{stage}</p>
            <p className="text-xl font-bold">{leads.filter(l => l.stage === stage).length}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b" role="tablist" aria-label="Saved lead views">
        {['All Leads', 'Untouched', 'My Follow-ups', 'Applications', 'Favourites'].map(view => (
          <button key={view} role="tab" aria-selected={savedView === view} onClick={() => setSavedView(view)} className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', savedView === view ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {view}{view === 'Untouched' && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{leads.filter(lead => !lead.lastContactedAt).length}</span>}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, or mobile..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Sources</SelectItem>{SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Stages</SelectItem>{displayStages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1"><SlidersHorizontal className="h-3.5 w-3.5" /> Columns <ChevronDown className="h-3 w-3" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {ALL_COLUMNS.map(col => <DropdownMenuCheckboxItem key={col.key} checked={visibleColumns.has(col.key)} onCheckedChange={() => toggleColumn(col.key)}>{col.label}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => { void importCsv(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} className="gap-1"><Upload className="h-3.5 w-3.5" /> Import</Button>
        <Button variant="outline" size="sm" onClick={() => exportCsv()} className="gap-1"><Download className="h-3.5 w-3.5" /> Export</Button>
        <div className="flex border rounded-lg overflow-hidden">
          <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" className="rounded-none" onClick={() => setViewMode('table')}><List className="h-4 w-4" /></Button>
          <Button variant={viewMode === 'kanban' ? 'default' : 'ghost'} size="sm" className="rounded-none" onClick={() => setViewMode('kanban')}><LayoutGrid className="h-4 w-4" /></Button>
        </div>
      </div>

      {selectedLeads.size > 0 && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">{selectedLeads.size} leads selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void assignSelectedToMe()} className="gap-1"><UserRoundCog className="h-3.5 w-3.5" /> Assign to me</Button>
            <Select onValueChange={value => void moveSelectedToStage(value)}><SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Change stage" /></SelectTrigger><SelectContent>{stages.map(stage => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent></Select>
            <Button size="sm" variant="outline" onClick={() => exportCsv(leads.filter(lead => selectedLeads.has(lead.id)))}><Download className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === 'table' ? (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="p-3 w-10"><Checkbox checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0} onCheckedChange={toggleSelectAll} /></th>
                {ALL_COLUMNS.filter(c => visibleColumns.has(c.key)).map(col => <th key={col.key} className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">{col.label}</th>)}
                <th className="text-right p-3 font-medium text-muted-foreground">Quick Actions</th>
              </tr></thead>
              <tbody>
                {filteredLeads.slice(0, 50).map(lead => (
                  <tr key={lead.id} className="border-b hover:bg-muted/20">
                    <td className="p-3"><Checkbox checked={selectedLeads.has(lead.id)} onCheckedChange={() => toggleSelectLead(lead.id)} /></td>
                    {visibleColumns.has('name') && <td className="p-3"><div className="flex items-center gap-2"><button title="Favourite" aria-label={`Favourite ${lead.name}`} onClick={() => void toggleFavourite(lead)} className={cn('text-muted-foreground hover:text-amber-500', lead.favourite && 'text-amber-500')}><Star className="h-4 w-4" fill={lead.favourite ? 'currentColor' : 'none'} /></button><button onClick={() => setShowLeadDetail(lead.id)} className="font-medium text-left hover:text-primary hover:underline">{lead.name}</button><Badge className={cn("text-[10px] px-1.5 py-0", lead.freshness.color)}>{lead.freshness.label}</Badge></div></td>}
                    {visibleColumns.has('mobile') && <td className="p-3 font-mono text-xs">{lead.mobile}</td>}
                    {visibleColumns.has('email') && <td className="p-3 text-xs">{lead.email}</td>}
                    {visibleColumns.has('source') && <td className="p-3"><Badge variant="secondary" className="text-xs">{lead.source}</Badge></td>}
                    {visibleColumns.has('stage') && <td className="p-3"><Badge className={cn("text-xs", stageColors[lead.stage] || 'bg-muted text-muted-foreground')}>{lead.stage}</Badge></td>}
                    {visibleColumns.has('score') && <td className="p-3"><span className={cn("font-bold", getScoreColor(lead.score))}>{lead.score}</span></td>}
                    {visibleColumns.has('course') && <td className="p-3 text-xs">{lead.course}</td>}
                    {visibleColumns.has('city') && <td className="p-3 text-xs">{lead.city}</td>}
                    {visibleColumns.has('counselor') && <td className="p-3 text-xs">{lead.counselor}</td>}
                    {visibleColumns.has('createdAt') && <td className="p-3 text-xs">{lead.createdAt}</td>}
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button title="WhatsApp" variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(`https://wa.me/${lead.mobile.replace(/\D/g, '')}`, '_blank')}><MessageSquare className="h-3.5 w-3.5 text-green-500" /></Button>
                        <Button title="Email" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { window.location.href = `mailto:${lead.email}`; }}><Mail className="h-3.5 w-3.5 text-blue-500" /></Button>
                        <Button title="Call" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { window.location.href = `tel:${lead.mobile}`; }}><Phone className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 text-xs text-muted-foreground border-t">Showing {Math.min(50, filteredLeads.length)} of {filteredLeads.length} leads</div>
        </CardContent></Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {displayStages.map(stage => {
            const stageLeads = filteredLeads.filter(l => l.stage === stage);
            return (
              <div key={stage} className="min-w-[280px] flex-1" onDragOver={e => e.preventDefault()} onDrop={() => draggedLead && handleKanbanDrop(draggedLead, stage)}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge className={cn("text-xs", stageColors[stage] || 'bg-muted text-muted-foreground')}>{stage}</Badge>
                  <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
                </div>
                <div className="space-y-2 min-h-[200px] bg-muted/20 rounded-lg p-2">
                  {stageLeads.slice(0, 10).map(lead => (
                    <Card key={lead.id} className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow" draggable onDragStart={() => setDraggedLead(lead.id)}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-sm">{lead.name}</p>
                            <p className="text-xs text-muted-foreground">{lead.course} • {lead.city}</p>
                          </div>
                          <span className={cn("text-xs font-bold", getScoreColor(lead.score))}>{lead.score}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="text-[10px]">{lead.source}</Badge>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6"><MessageSquare className="h-3 w-3 text-green-500" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6"><Mail className="h-3 w-3 text-blue-500" /></Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {stageLeads.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No leads</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={showAddLead} onOpenChange={setShowAddLead}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Add New Lead</SheetTitle>
            <SheetDescription>Enter lead details to add to the pipeline</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Full Name *</Label><Input placeholder="Enter name" value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Mobile *</Label><Input placeholder="+91 9876543210" value={newLead.mobile} onChange={e => setNewLead(p => ({ ...p, mobile: e.target.value }))} /></div>
            <div><Label>Email</Label><Input placeholder="email@example.com" type="email" value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>Source</Label>
              <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Course</Label><Input placeholder="MBA, B.Tech, etc." value={newLead.course} onChange={e => setNewLead(p => ({ ...p, course: e.target.value }))} /></div>
            <div><Label>City</Label><Input placeholder="City name" value={newLead.city} onChange={e => setNewLead(p => ({ ...p, city: e.target.value }))} /></div>
            <Button className="w-full mt-4" onClick={() => addLeadMutation.mutate()} disabled={addLeadMutation.isPending}>
              {addLeadMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding...</> : 'Add Lead'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(activeLead)} onOpenChange={open => !open && setShowLeadDetail(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          {activeLead && <>
            <SheetHeader><SheetTitle className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{activeLead.name.split(' ').map((part: string) => part[0]).slice(0, 2).join('')}</span><span>{activeLead.name}</span></SheetTitle><SheetDescription>{activeLead.mobile} · {activeLead.email || 'No email'}</SheetDescription></SheetHeader>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div><Label>Stage</Label><Select value={activeLead.stageId || ''} onValueChange={value => void updateContacts([activeLead.id], { stage_id: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{stages.map(stage => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Priority</Label><Select value={activeLead.priority} onValueChange={value => void updateContacts([activeLead.id], { priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Low', 'Medium', 'High', 'Urgent'].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2"><Label>Owner</Label><Input value={activeLead.raw.assigned_to || ''} placeholder="Assign counsellor" onChange={event => { activeLead.raw.assigned_to = event.target.value; }} onBlur={event => void updateContacts([activeLead.id], { assigned_to: event.target.value || null })} /></div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 rounded-md border p-4 text-sm"><div><span className="text-muted-foreground">Course</span><p className="font-medium">{activeLead.course || 'Not selected'}</p></div><div><span className="text-muted-foreground">Source</span><p className="font-medium">{activeLead.source}</p></div><div><span className="text-muted-foreground">City</span><p className="font-medium">{activeLead.city || 'Not provided'}</p></div><div><span className="text-muted-foreground">Lead score</span><p className={cn('font-semibold', getScoreColor(activeLead.score))}>{activeLead.score}</p></div></div>
            <div className="mt-7"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Activity timeline</h3><Badge variant="outline">{activeActivities.length}</Badge></div><div className="mb-4 rounded-md border p-3"><div className="mb-3 flex gap-1">{['note', 'call', 'whatsapp', 'email'].map(type => <Button key={type} size="sm" variant={activityType === type ? 'default' : 'ghost'} onClick={() => setActivityType(type)} className="capitalize">{type}</Button>)}</div><textarea value={activityNote} onChange={event => setActivityNote(event.target.value)} className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Add interaction details" /><div className="mt-2 flex justify-end"><Button size="sm" onClick={() => void addActivity()} disabled={!activityNote.trim()}>Save activity</Button></div></div><div className="space-y-3">{activeActivities.map((activity: any) => <div key={activity.id} className="flex gap-3 border-l-2 border-primary/30 pl-4"><span className="mt-0.5 rounded bg-muted p-1.5">{activity.type === 'call' ? <Phone className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}</span><div><p className="text-sm font-medium">{activity.title}</p><p className="text-sm text-muted-foreground">{activity.description}</p><time className="text-xs text-muted-foreground">{new Date(activity.created_at).toLocaleString()}</time></div></div>)}{!activeActivities.length && <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-muted-foreground"><CalendarClock className="h-5 w-5" /><p className="text-sm">No activity recorded yet</p></div>}</div></div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default memo(LeadManagementModule);
