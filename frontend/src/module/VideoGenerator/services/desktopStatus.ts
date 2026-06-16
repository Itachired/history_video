import { resolveBackendUrl } from '@/utils/desktopRuntime';

export interface DesktopStatusResponse {
  status: string;
  backend: {
    asset_root: string;
    base_url: string;
    cwd: string;
    port: string;
    python: string;
    started_at: string;
  };
  config: Record<string, boolean>;
  capabilities: Record<string, boolean>;
}

export interface DesktopProjectSummary {
  asset_count: number;
  created_at?: string;
  film_ready: boolean;
  manifest_path: string;
  message?: string;
  phase_counts: Record<string, Record<string, number>>;
  project_dir: string;
  project_id: string;
  ready_asset_count: number;
  status: string;
  storyboard_video_task_count: number;
  updated_at?: string;
}

export interface DesktopProjectsResponse {
  asset_root: string;
  projects: DesktopProjectSummary[];
}

const requestJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(resolveBackendUrl(path), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const getDesktopStatus = () =>
  requestJson<DesktopStatusResponse>('/v1/desktop/status');

export const getDesktopProjects = (limit = 20) =>
  requestJson<DesktopProjectsResponse>(`/v1/desktop/projects?limit=${limit}`);
