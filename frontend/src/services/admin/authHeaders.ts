export const ADMIN_TOKEN_KEY = 'chat2cartoon-admin-token';

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY) || '';

export const getAdminAuthHeaders = (org?: {
  tenantId?: string;
  workspaceId?: string;
}): Record<string, string> => {
  const token = getAdminToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (org?.tenantId) {
    headers['X-Tenant-Id'] = org.tenantId;
  }
  if (org?.workspaceId) {
    headers['X-Workspace-Id'] = org.workspaceId;
  }
  return headers;
};
