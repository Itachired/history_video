import { resolveBackendUrl } from '@/utils/desktopRuntime';
import { getAdminAuthHeaders } from '@/services/admin/authHeaders';

import type { UserConfirmationData } from '../types';

export interface RewriteStoryboardsPayload {
  script?: string;
  storyboards: string;
  instruction: string;
  content_options?: UserConfirmationData['content_options'];
}

export interface RewriteStoryboardsResponse {
  storyboards: string;
  char_count: number;
  warnings?: string[];
}

export const rewriteStoryboards = async (
  payload: RewriteStoryboardsPayload,
) => {
  const response = await fetch(resolveBackendUrl('/v1/storyboards/rewrite'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `rewrite storyboards failed: ${response.status}`);
  }

  return response.json() as Promise<RewriteStoryboardsResponse>;
};
