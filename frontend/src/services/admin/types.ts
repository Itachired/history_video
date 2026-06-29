export interface Permission {
  id?: number;
  code: string;
  name: string;
  resource: string;
  action: string;
}

export interface Role {
  id: number;
  code: string;
  name: string;
  description?: string;
  is_system: boolean;
  permission_codes: string[];
  permissions?: Permission[];
}

export interface Tenant {
  id?: number;
  tenant_id: string;
  name: string;
  display_name?: string;
  status: string;
  billing_mode?: string;
  billing_currency?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  user_count?: number;
  workspace_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Workspace {
  id?: number;
  workspace_id: string;
  tenant_id: string;
  name: string;
  display_name?: string;
  description?: string;
  status: string;
  billing_mode?: string;
  monthly_budget_limit?: number;
  tenant_name?: string;
  tenant_display_name?: string;
  user_count?: number;
  project_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  phone?: string;
  status: 'active' | 'disabled';
  is_super_admin: boolean;
  roles: Role[];
  permissions: string[];
  default_tenant_id?: string;
  default_workspace_id?: string;
  default_tenant?: Tenant;
  default_workspace?: Workspace;
  tenants?: Tenant[];
  workspaces?: Workspace[];
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AdminProject {
  project_id: string;
  name?: string;
  project_dir: string;
  manifest_path: string;
  owner_user_id?: number | null;
  owner_username?: string;
  owner_display_name?: string;
  tenant_id?: string;
  workspace_id?: string;
  tenant_name?: string;
  workspace_name?: string;
  ownership_status?: 'assigned' | 'unassigned';
  created_by_user_id?: number | null;
  created_by_username?: string;
  status?: string;
  visibility?: string;
  created_at?: string;
  updated_at?: string;
  asset_count: number;
  ready_asset_count: number;
  phase_counts: Record<string, Record<string, number>>;
  film_ready: boolean;
  task_count?: number;
  last_task_id?: string;
  last_task_status?: string;
  disk_usage?: {
    bytes: number;
    display: string;
  };
}

export interface AdminAsset {
  asset_id: string;
  phase: string;
  index?: number;
  filename?: string;
  relative_path?: string;
  source_url?: string;
  download_url?: string;
  status: string;
  size?: number;
  updated_at?: string;
  message?: string;
  preview_type?: 'image' | 'video' | 'audio' | 'file';
  metadata?: Record<string, any>;
  video_gen_task_id?: string;
}

export interface AdminProjectDetail {
  project: AdminProject | null;
  manifest: Record<string, any>;
  assets: AdminAsset[];
  tasks: AdminTask[];
  phase_counts: Record<string, Record<string, number>>;
  disk_usage: {
    bytes: number;
    display: string;
  };
}

export interface AdminTaskEvent {
  event_id: string;
  phase: string;
  asset_id?: string;
  status: string;
  message?: string;
  error_code?: string;
  error_type?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdminTask {
  task_id: string;
  project_id: string;
  tenant_id?: string;
  workspace_id?: string;
  creator_user_id?: number | null;
  creator_username?: string;
  task_type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';
  phase: string;
  phase_label?: string;
  progress: number;
  asset_count: number;
  ready_asset_count: number;
  failed_asset_count: number;
  created_at?: string;
  started_at?: string;
  updated_at?: string;
  finished_at?: string;
  duration_seconds?: number;
  error_code?: string;
  error_type?: string;
  error_message?: string;
  error_detail?: string;
  provider?: string;
  retryable?: boolean;
  assets?: AdminAsset[];
  events?: AdminTaskEvent[];
}

export interface AdminDashboard {
  summary: {
    project_count: number;
    asset_count: number;
    ready_asset_count: number;
    task_count: number;
    succeeded_task_count: number;
    failed_task_count: number;
    running_task_count: number;
    pending_task_count: number;
    disk_usage_bytes: number;
    disk_usage_display: string;
  };
  task_status: Array<{ status: string; count: number }>;
  phase_stats: Array<{
    phase: string;
    phase_label?: string;
    total: number;
    succeeded?: number;
    failed?: number;
    running?: number;
    unknown?: number;
  }>;
  recent_failures: AdminTask[];
  project_rankings: AdminProject[];
}

export interface BillingSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  input_cost: number;
  output_cost: number;
  cached_input_cost: number;
  reasoning_cost: number;
  total_cost: number;
  project_count: number;
  task_count: number;
  user_count: number;
  currency: string;
}

export interface BillingProjectSummary {
  project_id: string;
  tenant_id?: string;
  workspace_id?: string;
  tenant_name?: string;
  tenant_display_name?: string;
  workspace_name?: string;
  workspace_display_name?: string;
  owner_user_id?: number | null;
  owner_username?: string;
  owner_display_name?: string;
  task_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  input_cost: number;
  output_cost: number;
  cached_input_cost: number;
  reasoning_cost: number;
  total_cost: number;
  updated_at?: string;
}

export interface BillingTaskSummary {
  task_id: string;
  project_id: string;
  tenant_id?: string;
  workspace_id?: string;
  tenant_name?: string;
  tenant_display_name?: string;
  workspace_name?: string;
  workspace_display_name?: string;
  user_id?: number | null;
  username?: string;
  phase?: string;
  status?: string;
  event_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  input_cost: number;
  output_cost: number;
  cached_input_cost: number;
  reasoning_cost: number;
  total_cost: number;
  updated_at?: string;
}

export interface BillingUsageEvent {
  id: number;
  event_id: string;
  user_id?: number | null;
  username?: string;
  project_id?: string;
  tenant_id?: string;
  workspace_id?: string;
  task_id?: string;
  phase?: string;
  provider?: string;
  model?: string;
  endpoint_id?: string;
  request_id?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  status: string;
  error_code?: string;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface BillingPriceRule {
  id: number;
  code: string;
  provider: string;
  tenant_id?: string;
  workspace_id?: string;
  model?: string;
  endpoint_id?: string;
  resource_type: string;
  phase?: string;
  input_price_per_1m_tokens: number;
  output_price_per_1m_tokens: number;
  cached_input_price_per_1m_tokens: number;
  reasoning_price_per_1m_tokens: number;
  currency: string;
  enabled: number | boolean;
  effective_from?: string;
  effective_to?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  actor_user_id?: number;
  actor_username?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  ip?: string;
  user_agent?: string;
  created_at: string;
  before_json?: string;
  after_json?: string;
}
