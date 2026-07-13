import { resolveBackendUrl } from '@/utils/desktopRuntime';
import { getAdminAuthHeaders } from '@/services/admin/authHeaders';

export interface StoryboardVideoAsset {
  asset_id: string;
  phase: string;
  index: number;
  status: string;
  video_gen_task_id?: string;
  download_url?: string;
  relative_path?: string;
  filename?: string;
  size?: number;
  updated_at?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncStoryboardVideosResponse {
  project_id: string;
  assets: StoryboardVideoAsset[];
}

export const syncStoryboardVideos = async (
  projectId: string,
): Promise<SyncStoryboardVideosResponse> => {
  const response = await fetch(
    resolveBackendUrl(
      `/v1/assets/projects/${projectId}/storyboard-videos/sync`,
    ),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders(),
      },
    },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'sync storyboard videos failed');
  }
  return response.json();
};
