import { Button, Message, Modal } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getDesktopAPI } from '@/utils/desktopRuntime';
import { formatLocalDateTime } from '@/utils/time';

import {
  type DesktopProjectSummary,
  type DesktopProjectsResponse,
  type DesktopStatusResponse,
  getDesktopProjects,
  getDesktopStatus,
} from '../../../../services/desktopStatus';
import { syncStoryboardVideos } from '../../../../utils/syncStoryboardVideos';
import styles from './index.module.less';

interface Props {
  currentProjectId: string;
}

const CAPABILITY_LABELS: Record<string, string> = {
  script: '文案',
  image: '图片',
  video: '视频',
  tts: '配音',
  film: '成片',
};

const formatDate = (value?: string) => {
  return formatLocalDateTime(value, '未知');
};

const projectSummaryText = (project: DesktopProjectSummary) => {
  const roleReady = project.phase_counts.role_images?.ready || 0;
  const imageReady = project.phase_counts.storyboard_images?.ready || 0;
  const videoReady = project.phase_counts.storyboard_videos?.ready || 0;
  return `${project.ready_asset_count}/${project.asset_count} 个素材已归档，角色 ${roleReady}，画面 ${imageReady}，视频 ${videoReady}`;
};

export const DesktopStatusPanel = ({ currentProjectId }: Props) => {
  const desktopAPI = getDesktopAPI();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<DesktopStatusResponse>();
  const [projects, setProjects] = useState<DesktopProjectsResponse>();
  const [statusError, setStatusError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setStatusError('');
    try {
      const [nextStatus, nextProjects] = await Promise.all([
        getDesktopStatus(),
        getDesktopProjects(),
      ]);
      setStatus(nextStatus);
      setProjects(nextProjects);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!desktopAPI) {
      return undefined;
    }
    return desktopAPI.onBackendStatusChanged(() => {
      loadStatus();
    });
  }, [desktopAPI, loadStatus]);

  const triggerStatus = useMemo(() => {
    if (statusError) {
      return 'error';
    }
    return status?.status === 'ok' ? 'ok' : 'unknown';
  }, [status?.status, statusError]);
  const fallbackBackendOrigin = desktopAPI?.runtimeInfo?.backendOrigin || '';

  const handleRestartBackend = async () => {
    if (!desktopAPI) {
      Message.info('浏览器模式下请在终端重启后端服务');
      return;
    }
    setLoading(true);
    try {
      await desktopAPI.restartBackend();
      Message.success('后端已重启');
      await loadStatus();
    } catch {
      Message.error('后端重启失败，请查看日志');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLogs = async () => {
    if (!desktopAPI) {
      Message.info('浏览器模式下请查看项目 logs 目录');
      return;
    }
    await desktopAPI.openLogsFolder();
  };

  const handleOpenProject = async (projectId: string) => {
    if (!desktopAPI) {
      Message.info('浏览器模式下请在 assets/generated 目录查看素材');
      return;
    }
    await desktopAPI.openProjectFolder(projectId);
  };

  const handleSyncProject = async (projectId: string) => {
    setLoading(true);
    try {
      await syncStoryboardVideos(projectId);
      Message.success('分镜视频同步完成');
      await loadStatus();
    } catch {
      Message.error('分镜视频同步失败，请查看后端日志');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDiagnostic = async () => {
    const diagnostic = {
      backend: status?.backend,
      capabilities: status?.capabilities,
      config: status?.config,
      currentProjectId,
      desktopRuntime: Boolean(desktopAPI),
      fallbackBackendOrigin,
      status: status?.status,
      statusError,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      Message.success('诊断信息已复制');
    } catch {
      Message.error('复制失败');
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.statusTrigger}
        onClick={() => {
          setVisible(true);
          loadStatus();
        }}
      >
        <span className={styles.statusDot} data-status={triggerStatus} />
        本地服务
      </button>
      <Modal
        title="本地服务状态"
        visible={visible}
        footer={null}
        onCancel={() => setVisible(false)}
        style={{ width: 760 }}
      >
        <div className={styles.panel}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>运行状态</div>
            <div className={styles.infoGrid}>
              <div className={styles.infoLabel}>服务状态</div>
              <div className={styles.infoValue}>
                {statusError
                  ? `异常：${statusError}`
                  : status?.status || '检查中'}
              </div>
              <div className={styles.infoLabel}>后端地址</div>
              <div className={styles.infoValue}>
                {status?.backend.base_url || fallbackBackendOrigin || '-'}
              </div>
              <div className={styles.infoLabel}>素材目录</div>
              <div className={styles.infoValue}>
                {status?.backend.asset_root || projects?.asset_root || '-'}
              </div>
              <div className={styles.infoLabel}>Python</div>
              <div className={styles.infoValue}>
                {status?.backend.python || '-'}
              </div>
              <div className={styles.infoLabel}>启动时间</div>
              <div className={styles.infoValue}>
                {formatDate(status?.backend.started_at)}
              </div>
            </div>
            <div className={styles.capabilityList}>
              {Object.entries(status?.capabilities || {}).map(
                ([key, enabled]) => (
                  <span
                    key={key}
                    className={styles.capabilityPill}
                    data-enabled={enabled}
                  >
                    {CAPABILITY_LABELS[key] || key}
                    {enabled ? ' 可用' : ' 未就绪'}
                  </span>
                ),
              )}
            </div>
            <div className={styles.actions}>
              <Button loading={loading} onClick={loadStatus}>
                刷新
              </Button>
              <Button loading={loading} onClick={handleRestartBackend}>
                重启后端
              </Button>
              <Button onClick={handleOpenLogs}>打开日志</Button>
              <Button onClick={() => handleOpenProject(currentProjectId)}>
                打开当前素材目录
              </Button>
              <Button onClick={handleCopyDiagnostic}>复制诊断信息</Button>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>最近项目</div>
            {projects?.projects.length ? (
              <div className={styles.projectList}>
                {projects.projects.map(project => (
                  <div key={project.project_id} className={styles.projectItem}>
                    <div>
                      <div className={styles.projectTitle}>
                        {project.project_id}
                      </div>
                      <div className={styles.projectMeta}>
                        {projectSummaryText(project)}
                      </div>
                      <div className={styles.projectMeta}>
                        更新于 {formatDate(project.updated_at)}
                        {project.film_ready ? '，成片已生成' : ''}
                      </div>
                    </div>
                    <div className={styles.projectActions}>
                      <Button
                        size="mini"
                        onClick={() => handleOpenProject(project.project_id)}
                      >
                        打开
                      </Button>
                      <Button
                        size="mini"
                        loading={loading}
                        disabled={!project.storyboard_video_task_count}
                        onClick={() => handleSyncProject(project.project_id)}
                      >
                        同步
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>还没有可读取的项目 manifest</div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};
