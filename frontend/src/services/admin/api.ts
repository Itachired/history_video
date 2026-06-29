import { adminRequest, setAdminToken, type AdminRequestOptions } from './client';
import type {
  AdminAsset,
  AdminDashboard,
  AdminProject,
  AdminProjectDetail,
  AdminTask,
  AdminUser,
  AuditLog,
  BillingPriceRule,
  BillingProjectSummary,
  BillingSummary,
  BillingTaskSummary,
  BillingUsageEvent,
  Permission,
  Role,
  Tenant,
  Workspace,
} from './types';

export const adminLogin = async (username: string, password: string) => {
  const result = await adminRequest<{ token: string; user: AdminUser }>(
    '/v1/admin/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
  );
  setAdminToken(result.token);
  return result;
};

export const adminLogout = async () => {
  try {
    await adminRequest('/v1/admin/auth/logout', { method: 'POST' });
  } finally {
    setAdminToken('');
  }
};

export const changeAdminPassword = (oldPassword: string, newPassword: string) =>
  adminRequest<{ ok: boolean }>('/v1/admin/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });

export const getAdminMe = () =>
  adminRequest<{ user: AdminUser }>('/v1/admin/auth/me');

export const listAdminUsers = (options: AdminRequestOptions = {}) =>
  adminRequest<{ users: AdminUser[] }>('/v1/admin/users', options);

export const createAdminUser = (payload: Record<string, unknown>) =>
  adminRequest<{ user: AdminUser }>('/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateAdminUser = (id: number, payload: Record<string, unknown>) =>
  adminRequest<{ user: AdminUser }>(`/v1/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const setAdminUserStatus = (id: number, status: 'active' | 'disabled') =>
  adminRequest<{ user: AdminUser }>(
    `/v1/admin/users/${id}/${status === 'active' ? 'enable' : 'disable'}`,
    { method: 'POST' },
  );

export const resetAdminUserPassword = (id: number, password: string) =>
  adminRequest<{ ok: boolean }>(`/v1/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

export const replaceAdminUserRoles = (id: number, roleIds: number[]) =>
  adminRequest<{ user: AdminUser }>(`/v1/admin/users/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ role_ids: roleIds }),
  });

export const listAdminRoles = (options: AdminRequestOptions = {}) =>
  adminRequest<{ roles: Role[] }>('/v1/admin/roles', options);

export const createAdminRole = (payload: Record<string, unknown>) =>
  adminRequest<{ role: Role }>('/v1/admin/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateAdminRole = (id: number, payload: Record<string, unknown>) =>
  adminRequest<{ role: Role }>(`/v1/admin/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deleteAdminRole = (id: number) =>
  adminRequest<{ ok: boolean }>(`/v1/admin/roles/${id}`, {
    method: 'DELETE',
  });

export const listAdminPermissions = (options: AdminRequestOptions = {}) =>
  adminRequest<{ permissions: Permission[] }>('/v1/admin/permissions', options);

export const listTenants = (options: AdminRequestOptions = {}) =>
  adminRequest<{ tenants: Tenant[] }>('/v1/admin/organizations/tenants', options);

export const createTenant = (payload: Record<string, unknown>) =>
  adminRequest<{ tenant: Tenant }>('/v1/admin/organizations/tenants', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const listWorkspaces = (tenantId = '', options: AdminRequestOptions = {}) =>
  adminRequest<{ workspaces: Workspace[] }>(
    `/v1/admin/organizations/workspaces${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''}`,
    options,
  );

export const createWorkspace = (payload: Record<string, unknown>) =>
  adminRequest<{ workspace: Workspace }>('/v1/admin/organizations/workspaces', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const listAdminProjects = (options: AdminRequestOptions = {}) =>
  adminRequest<{ asset_root: string; projects: AdminProject[] }>(
    '/v1/admin/projects',
    options,
  );

export const getAdminDashboard = (options: AdminRequestOptions = {}) =>
  adminRequest<AdminDashboard>('/v1/admin/dashboard', options);

export const getBillingSummary = (options: AdminRequestOptions = {}) =>
  adminRequest<BillingSummary>('/v1/admin/billing/summary', options);

export const listBillingProjects = (limit = 100, options: AdminRequestOptions = {}) =>
  adminRequest<{ projects: BillingProjectSummary[] }>(
    `/v1/admin/billing/projects?limit=${limit}`,
    options,
  );

export const listBillingTasks = (params: Record<string, string | number> = {}, options: AdminRequestOptions = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return adminRequest<{ tasks: BillingTaskSummary[] }>(
    `/v1/admin/billing/tasks${query.toString() ? `?${query.toString()}` : ''}`,
    options,
  );
};

export const listBillingUsageEvents = (params: Record<string, string | number> = {}, options: AdminRequestOptions = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return adminRequest<{ events: BillingUsageEvent[] }>(
    `/v1/admin/billing/usage-events${query.toString() ? `?${query.toString()}` : ''}`,
    options,
  );
};

export const listBillingPriceRules = (options: AdminRequestOptions = {}) =>
  adminRequest<{ rules: BillingPriceRule[] }>('/v1/admin/billing/price-rules', options);

export const createBillingPriceRule = (payload: Record<string, unknown>) =>
  adminRequest<{ rule: BillingPriceRule }>('/v1/admin/billing/price-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateBillingPriceRule = (id: number, payload: Record<string, unknown>) =>
  adminRequest<{ rule: BillingPriceRule }>(`/v1/admin/billing/price-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const listAdminTasks = (params: Record<string, string | number> = {}, options: AdminRequestOptions = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return adminRequest<{ tasks: AdminTask[] }>(
    `/v1/admin/tasks${query.toString() ? `?${query.toString()}` : ''}`,
    options,
  );
};

export const getAdminTask = (taskId: string) =>
  adminRequest<{ task: AdminTask }>(`/v1/admin/tasks/${encodeURIComponent(taskId)}`);

export const getAdminProjectTasks = (projectId: string) =>
  adminRequest<{ project_id: string; tasks: AdminTask[] }>(
    `/v1/admin/projects/${projectId}/tasks`,
  );

export const getAdminProjectAssets = (projectId: string) =>
  adminRequest<{ project_id: string; assets: AdminAsset[] }>(
    `/v1/admin/projects/${projectId}/assets`,
  );

export const getAdminProjectDetail = (projectId: string) =>
  adminRequest<AdminProjectDetail>(`/v1/admin/projects/${projectId}/detail`);

export const assignAdminProjectOwner = (projectId: string, ownerUserId?: number | null) =>
  adminRequest<{ project: AdminProject }>(`/v1/admin/projects/${projectId}/owner`, {
    method: 'PUT',
    body: JSON.stringify({ owner_user_id: ownerUserId || null }),
  });

export const safeDeleteAdminProject = (projectId: string, confirmProjectId: string) =>
  adminRequest<{ ok: boolean }>(`/v1/admin/projects/${projectId}/delete`, {
    method: 'POST',
    body: JSON.stringify({ confirm_project_id: confirmProjectId }),
  });

export const deleteAdminAsset = (projectId: string, assetId: string) =>
  adminRequest<{ ok: boolean }>(
    `/v1/admin/projects/${projectId}/assets/${assetId}`,
    { method: 'DELETE' },
  );

export const listAuditLogs = (params: Record<string, string | number> = {}, options: AdminRequestOptions = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return adminRequest<{ logs: AuditLog[] }>(
    `/v1/admin/audit-logs${query.toString() ? `?${query.toString()}` : ''}`,
    options,
  );
};

export const getSystemStatus = (options: AdminRequestOptions = {}) =>
  adminRequest<Record<string, any>>('/v1/admin/system/status', options);
