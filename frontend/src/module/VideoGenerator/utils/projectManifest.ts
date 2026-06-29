import { resolveBackendUrl } from '@/utils/desktopRuntime';
import { getAdminAuthHeaders } from '@/services/admin/authHeaders';

export interface ProjectAsset {
  asset_id: string;
  phase: string;
  index: number;
  status: string;
  filename?: string;
  relative_path?: string;
  source_url?: string;
  download_url?: string;
  size?: number;
  message?: string;
  video_gen_task_id?: string;
  metadata?: Record<string, any>;
  updated_at?: string;
}

export interface ProjectManifest {
  project_id: string;
  created_at?: string;
  updated_at?: string;
  assets: ProjectAsset[];
}

export const getProjectManifest = async (
  projectId: string,
): Promise<ProjectManifest> => {
  const response = await fetch(
    resolveBackendUrl(`/v1/assets/projects/${projectId}/manifest`),
    {
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders(),
      },
    },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'get project manifest failed');
  }
  return response.json();
};
