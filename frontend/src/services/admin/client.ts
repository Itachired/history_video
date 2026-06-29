import { Message } from '@arco-design/web-react';
import { resolveBackendUrl } from '@/utils/desktopRuntime';
import { ADMIN_TOKEN_KEY, getAdminAuthHeaders, getAdminToken } from './authHeaders';

export type AdminRequestOptions = RequestInit & {
  silent?: boolean;
};

export const setAdminToken = (token: string) => {
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
};

export async function adminRequest<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  let response: Response;
  const { silent, ...requestOptions } = options;
  try {
    response = await fetch(resolveBackendUrl(path), {
      credentials: 'omit',
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders(),
        ...(requestOptions.headers || {}),
      },
    });
  } catch (error) {
    if (!silent) {
      Message.error('无法连接后端服务，请确认后端已启动');
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.detail || '请求失败';
    if (!silent) {
      Message.error(String(message));
    }
    throw new Error(String(message));
  }
  return payload as T;
}
