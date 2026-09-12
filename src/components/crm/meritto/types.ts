export type CRMRole = 'super_admin' | 'admin' | 'team_lead' | 'counsellor';

export interface CRMUser {
  id: string;
  email: string;
  full_name: string | null;
  role: CRMRole;
  team_id?: string | null;
  team?: string | null;
  is_active?: boolean;
  is_approved?: boolean;
  last_sign_in_at?: string | null;
  created_at?: string;
  permissions?: string[];
  crm_team?: { id: string; name: string } | null;
}

export interface CRMStage {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_default?: boolean;
}

export interface CRMTeam {
  id: string;
  name: string;
  description?: string | null;
  manager_id?: string | null;
  is_active: boolean;
  manager?: Pick<CRMUser, 'id' | 'full_name' | 'email'> | null;
  members?: CRMUser[];
  _count?: { members: number };
}

export interface CRMContact {
  id: string;
  name: string;
  email?: string | null;
  mobile: string;
  alternate_mobile?: string | null;
  state?: string | null;
  city?: string | null;
  course?: string | null;
  specialization?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign_name?: string | null;
  priority?: string | null;
  tags: string[];
  lead_score?: number | null;
  owner_id?: string | null;
  stage_id?: string | null;
  assigned_to?: string | null;
  notes?: string | null;
  notes_count: number;
  is_favourite: boolean;
  status_reason?: string | null;
  last_contacted_at?: string | null;
  first_contacted_at?: string | null;
  last_activity_at?: string | null;
  next_follow_up?: string | null;
  expected_enrollment_date?: string | null;
  created_at: string;
  updated_at: string;
  pipeline_stage?: CRMStage | null;
  owner?: Pick<CRMUser, 'id' | 'full_name' | 'email' | 'role'> | null;
  university?: { id: string; name: string } | null;
  activities?: CRMActivity[];
  tasks?: CRMTask[];
  assignment_history?: CRMAssignment[];
}

export interface CRMActivity {
  id: string;
  contact_id: string;
  type: string;
  title: string;
  description?: string | null;
  outcome?: string | null;
  duration_minutes?: number | null;
  scheduled_at?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  created_at: string;
  contact?: Pick<CRMContact, 'id' | 'name'>;
  actor?: Pick<CRMUser, 'id' | 'full_name' | 'email'> | null;
}

export interface CRMTask {
  id: string;
  contact_id?: string | null;
  title: string;
  description?: string | null;
  status: 'pending' | 'completed';
  priority: string;
  assignee_id?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  contact?: Pick<CRMContact, 'id' | 'name' | 'mobile'> | null;
  assignee?: Pick<CRMUser, 'id' | 'full_name' | 'email'> | null;
}

export interface CRMAssignment {
  id: string;
  reason?: string | null;
  created_at: string;
  from_owner?: Pick<CRMUser, 'full_name' | 'email'> | null;
  to_owner?: Pick<CRMUser, 'full_name' | 'email'> | null;
  changed_by?: Pick<CRMUser, 'full_name' | 'email'> | null;
}

export interface CRMSavedView {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  is_default: boolean;
}

export interface CRMMeta {
  actor: CRMUser;
  stages: CRMStage[];
  users: CRMUser[];
  teams: CRMTeam[];
  sources: string[];
  savedViews: CRMSavedView[];
  permissions: string[];
  total: number;
}
