import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  Layout,
  Menu,
  Message,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react';
import {
  IconApps,
  IconCopy,
  IconDashboard,
  IconDelete,
  IconDownload,
  IconEye,
  IconFile,
  IconLock,
  IconRefresh,
  IconSafe,
  IconSettings,
  IconUser,
} from '@arco-design/web-react/icon';
import {
  adminLogin,
  adminLogout,
  assignAdminProjectOwner,
  changeAdminPassword,
  createBillingPriceRule,
  createAdminRole,
  createAdminUser,
  createTenant,
  createWorkspace,
  deleteAdminAsset,
  deleteAdminRole,
  getBillingSummary,
  getAdminMe,
  getAdminProjectAssets,
  getAdminProjectDetail,
  getAdminDashboard,
  getAdminTask,
  getSystemStatus,
  listAdminPermissions,
  listAdminProjects,
  listAdminRoles,
  listAdminTasks,
  listAdminUsers,
  listAuditLogs,
  listBillingPriceRules,
  listBillingProjects,
  listBillingTasks,
  listBillingUsageEvents,
  listTenants,
  listWorkspaces,
  replaceAdminUserRoles,
  resetAdminUserPassword,
  safeDeleteAdminProject,
  setAdminUserStatus,
  updateBillingPriceRule,
  updateAdminRole,
  updateAdminUser,
} from '@/services/admin/api';
import { getDesktopAPI, resolveBackendUrl } from '@/utils/desktopRuntime';
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
} from '@/services/admin/types';
import { formatLocalDateTime, formatShortLocalDateTime } from '@/utils/time';
import './style.css';

const { Sider, Content, Header } = Layout;
const FormItem = Form.Item;

type ViewKey = 'dashboard' | 'users' | 'roles' | 'organizations' | 'projects' | 'tasks' | 'billing' | 'audit' | 'system';

interface BillingState {
  summary: BillingSummary | null;
  projects: BillingProjectSummary[];
  tasks: BillingTaskSummary[];
  events: BillingUsageEvent[];
  priceRules: BillingPriceRule[];
}

interface OrganizationState {
  tenants: Tenant[];
  workspaces: Workspace[];
}

const loadOptional = async <T,>(
  loader: () => Promise<T>,
  fallback: T,
  label: string,
) => {
  try {
    return await loader();
  } catch (error) {
    console.warn(`[AdminConsole] ${label} load failed`, error);
    return fallback;
  }
};

const statusTag = (status?: string) => {
  if (status === 'active' || status === 'ready' || status === 'ok') {
    return <Tag color="green">{status}</Tag>;
  }
  if (status === 'succeeded') {
    return <Tag color="green">succeeded</Tag>;
  }
  if (status === 'running' || status === 'submitted' || status === 'processing') {
    return <Tag color="blue">{status}</Tag>;
  }
  if (status === 'pending') {
    return <Tag color="orange">pending</Tag>;
  }
  if (status === 'disabled' || status === 'failed') {
    return <Tag color="red">{status}</Tag>;
  }
  return <Tag>{status || '-'}</Tag>;
};

const formatTime = (value?: string) => {
  return formatLocalDateTime(value);
};

const formatShortTime = (value?: string) => {
  return formatShortLocalDateTime(value);
};

const compactId = (value?: string, head = 14, tail = 6) => {
  if (!value) {
    return '-';
  }
  if (value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const formatNumber = (value?: number | null) => {
  const numeric = Number(value || 0);
  return numeric.toLocaleString('zh-CN');
};

const formatCost = (value?: number | null, currency = 'CNY') => {
  const numeric = Number(value || 0);
  return `${currency} ${numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })}`;
};

const summarizeError = (value?: string) => {
  if (!value) {
    return '-';
  }
  if (value.includes('ConnectTimeoutError') || value.includes('timed out')) {
    return '下载超时';
  }
  if (value.includes('HTTPError') || value.includes('status code')) {
    return '外部接口错误';
  }
  if (value.includes('asset exceeds download limit')) {
    return '文件过大';
  }
  if (value.includes('file not found')) {
    return '文件缺失';
  }
  if (value.includes('Max retries exceeded')) {
    return '连接重试失败';
  }
  return value.length > 18 ? `${value.slice(0, 18)}...` : value;
};

const shortText = (value?: string, maxLength = 96) => {
  if (!value) {
    return '-';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const copyText = async (value?: string) => {
  if (!value) {
    return;
  }
  try {
    await window.navigator.clipboard.writeText(value);
    Message.success('已复制');
  } catch {
    Message.error('复制失败');
  }
};

const LongTextCell = ({
  value,
  detailValue,
  maxLength = 96,
  onDetail,
}: {
  value?: string;
  detailValue?: string;
  maxLength?: number;
  onDetail?: (value: string) => void;
}) => {
  if (!value) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  const fullValue = detailValue || value;
  const hasDetail = value.trim().length > maxLength;
  return (
    <div className="admin-long-text-cell">
      <Typography.Text className="admin-long-text-summary" title={fullValue}>
        {shortText(value, maxLength)}
      </Typography.Text>
      <Space size={6} className="admin-long-text-actions">
        {(hasDetail || detailValue) && onDetail && (
          <Button size="mini" type="text" onClick={() => onDetail(fullValue)}>
            详情
          </Button>
        )}
        <Button
          size="mini"
          type="text"
          icon={<IconCopy />}
          title="复制"
          onClick={() => copyText(fullValue)}
        />
      </Space>
    </div>
  );
};

const statusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    succeeded: '成功',
    failed: '失败',
    running: '运行中',
    pending: '等待中',
    unknown: '未知',
  };
  return labels[status || ''] || status || '-';
};

const statusColor = (status?: string) => {
  if (status === 'succeeded' || status === 'ready' || status === 'active') {
    return 'green';
  }
  if (status === 'failed' || status === 'disabled') {
    return 'red';
  }
  if (status === 'running' || status === 'submitted' || status === 'processing') {
    return 'blue';
  }
  if (status === 'pending') {
    return 'orange';
  }
  return 'gray';
};

const LoginView = ({ onLoggedIn }: { onLoggedIn: (user: AdminUser) => void }) => {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');

  const handleSubmit = async () => {
    if (!username.trim()) {
      Message.warning('请输入用户名');
      return;
    }
    if (!password) {
      Message.warning('请输入密码');
      return;
    }
    setLoading(true);
    try {
      const result = await adminLogin(username.trim(), password);
      onLoggedIn(result.user);
      Message.success('登录成功');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-panel">
        <div>
          <Typography.Title heading={3}>后台管理</Typography.Title>
          <Typography.Text type="secondary">
            管理用户、角色、项目资产和审计记录。
          </Typography.Text>
        </div>
        <Form layout="vertical">
          <FormItem label="用户名">
            <Input
              autoComplete="username"
              placeholder="admin"
              value={username}
              onChange={setUsername}
              onPressEnter={handleSubmit}
            />
          </FormItem>
          <FormItem label="密码">
            <Input.Password
              autoComplete="current-password"
              placeholder="默认 admin123456"
              value={password}
              onChange={setPassword}
              onPressEnter={handleSubmit}
            />
          </FormItem>
          <Button long type="primary" loading={loading} onClick={handleSubmit}>
            登录
          </Button>
        </Form>
      </div>
    </div>
  );
};

const DashboardPanel = ({
  dashboard,
  onOpenTasks,
  onOpenProject,
}: {
  dashboard: AdminDashboard | null;
  onOpenTasks: (filters?: Record<string, string>) => void;
  onOpenProject: (projectId: string) => void;
}) => {
  if (!dashboard) {
    return (
      <Card>
        <Typography.Text type="secondary">暂无概览数据</Typography.Text>
      </Card>
    );
  }

  const { summary } = dashboard;
  const successRate = summary.task_count
    ? Math.round((summary.succeeded_task_count / summary.task_count) * 100)
    : 0;
  const healthStatus = summary.failed_task_count > 0 ? 'warning' : 'ok';
  const failedPhases = dashboard.phase_stats
    .filter(item => (item.failed || 0) > 0)
    .map(item => item.phase_label || item.phase);
  const healthText = summary.failed_task_count > 0
    ? `当前有 ${summary.failed_task_count} 个失败任务，主要集中在${failedPhases.join('、') || '部分'}阶段。`
    : summary.running_task_count > 0
      ? `当前有 ${summary.running_task_count} 个任务运行中，生产队列正在处理。`
      : '当前生产状态正常，暂无失败任务。';
  const metricCards = [
    {
      label: '总任务',
      value: summary.task_count,
      helper: `${summary.project_count} 个项目`,
      tone: 'neutral',
    },
    {
      label: '成功率',
      value: `${successRate}%`,
      helper: `${summary.succeeded_task_count}/${summary.task_count} 成功`,
      tone: successRate >= 90 || summary.task_count === 0 ? 'success' : successRate >= 75 ? 'warning' : 'danger',
    },
    {
      label: '失败任务',
      value: summary.failed_task_count,
      helper: summary.failed_task_count > 0 ? '需要处理' : '暂无异常',
      tone: summary.failed_task_count > 0 ? 'danger' : 'success',
      onClick: () => onOpenTasks({ status: 'failed' }),
    },
    {
      label: '运行中',
      value: summary.running_task_count,
      helper: summary.running_task_count > 0 ? '正在生成' : '队列空闲',
      tone: summary.running_task_count > 0 ? 'info' : 'success',
      onClick: () => onOpenTasks({ status: 'running' }),
    },
    {
      label: '资源占用',
      value: summary.disk_usage_display,
      helper: `${summary.asset_count} 个资产`,
      tone: 'neutral',
    },
  ];
  const maxProjectUsage = Math.max(
    ...dashboard.project_rankings.map(item => item.disk_usage?.bytes || 0),
    1,
  );
  const recentProjects = [...dashboard.project_rankings]
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, 5);

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div className={`admin-dashboard-hero admin-dashboard-hero-${healthStatus}`}>
        <div>
          <Space size={10} align="center">
            <Typography.Title heading={4} style={{ margin: 0 }}>Dashboard</Typography.Title>
            <Tag color={healthStatus === 'ok' ? 'green' : 'orange'}>
              {healthStatus === 'ok' ? '生产正常' : '需要关注'}
            </Tag>
          </Space>
          <Typography.Text type="secondary" className="admin-dashboard-hero-text">
            {healthText}
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<IconRefresh />} onClick={() => window.location.reload()}>刷新</Button>
          <Button type="primary" onClick={() => onOpenTasks()}>任务中心</Button>
        </Space>
      </div>

      <div className="admin-dashboard-metrics">
        {metricCards.map(item => (
          <button
            key={item.label}
            className={`admin-metric-card admin-metric-${item.tone}`}
            type="button"
            onClick={item.onClick}
            disabled={!item.onClick}
          >
            <span className="admin-metric-label">{item.label}</span>
            <span className="admin-metric-value">{item.value}</span>
            <span className="admin-metric-helper">{item.helper}</span>
          </button>
        ))}
      </div>

      <div className="admin-dashboard-main-grid">
        <Card title="任务状态分布" className="admin-dashboard-card">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {['succeeded', 'failed', 'running', 'pending', 'unknown'].map(status => {
              const item = dashboard.task_status.find(entry => entry.status === status);
              const count = item?.count || 0;
              const percent = summary.task_count ? Math.round((count / summary.task_count) * 100) : 0;
              return (
                <button
                  key={status}
                  className="admin-status-line"
                  type="button"
                  onClick={() => onOpenTasks({ status })}
                >
                  <span className={`admin-status-dot admin-status-${statusColor(status)}`} />
                  <span className="admin-status-name">{statusLabel(status)}</span>
                  <Progress
                    percent={percent}
                    size="small"
                    color={statusColor(status)}
                    showText={false}
                    className="admin-status-progress"
                  />
                  <span className="admin-status-count">{count}</span>
                </button>
              );
            })}
            <Space>
              <Button size="small" onClick={() => onOpenTasks({ status: 'failed' })}>查看失败任务</Button>
              <Button size="small" onClick={() => onOpenTasks()}>查看全部任务</Button>
            </Space>
          </Space>
        </Card>

        <Card title="阶段健康度" className="admin-dashboard-card">
          <div className="admin-phase-health-grid">
            {dashboard.phase_stats.map(item => {
              const total = item.total || 0;
              const failed = item.failed || 0;
              const succeeded = item.succeeded || 0;
              const health = total ? Math.round((succeeded / total) * 100) : 0;
              const tone = failed > 0 ? 'warning' : 'success';
              return (
                <button
                  type="button"
                  key={item.phase}
                  className={`admin-phase-health admin-phase-health-${tone}`}
                  onClick={() => onOpenTasks({ phase: item.phase })}
                >
                  <span className="admin-phase-title">{item.phase_label || item.phase}</span>
                  <span className="admin-phase-percent">{health}%</span>
                  <Progress percent={health} size="small" showText={false} />
                  <span className="admin-phase-meta">
                    成功 {succeeded} / 失败 {failed}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card
        title="最近失败任务"
        className="admin-dashboard-card"
        extra={<Button size="small" onClick={() => onOpenTasks({ status: 'failed' })}>查看全部</Button>}
      >
        <Table
          rowKey="task_id"
          data={dashboard.recent_failures}
          pagination={false}
          columns={[
            { title: '时间', width: 110, render: (_, item) => formatShortTime(item.updated_at) },
            {
              title: '项目',
              render: (_, item) => (
                <Typography.Text title={item.project_id}>
                  {compactId(item.project_id, 16, 6)}
                </Typography.Text>
              ),
            },
            { title: '阶段', width: 110, render: (_, item) => item.phase_label || item.phase },
            { title: '错误摘要', width: 130, render: (_, item) => <Tag color="red">{summarizeError(item.error_message)}</Tag> },
            {
              title: '操作',
              width: 160,
              render: (_, item) => (
                <Space>
                  <Button size="small" onClick={() => onOpenTasks({ status: 'failed', project_id: item.project_id })}>
                    详情
                  </Button>
                  <Button size="small" onClick={() => onOpenProject(item.project_id)}>项目</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <div className="admin-dashboard-main-grid">
        <Card title="磁盘占用 Top 项目" className="admin-dashboard-card">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {dashboard.project_rankings.slice(0, 6).map((project, index) => {
              const bytes = project.disk_usage?.bytes || 0;
              const percent = Math.max(2, Math.round((bytes / maxProjectUsage) * 100));
              return (
                <button
                  type="button"
                  className="admin-project-rank"
                  key={project.project_id}
                  onClick={() => onOpenProject(project.project_id)}
                >
                  <span className="admin-rank-index">{index + 1}</span>
                  <span className="admin-rank-main">
                    <Typography.Text title={project.project_id}>
                      {compactId(project.project_id, 20, 6)}
                    </Typography.Text>
                    <span className="admin-rank-bar">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  </span>
                  <span className="admin-rank-size">{project.disk_usage?.display || '-'}</span>
                </button>
              );
            })}
          </Space>
        </Card>

        <Card title="最近项目动态" className="admin-dashboard-card">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {recentProjects.map(project => {
              const failedPhase = Object.entries(project.phase_counts || {})
                .find(([, counts]) => (counts.failed || 0) > 0)?.[0];
              const stateText = failedPhase
                ? `${failedPhase} 失败`
                : project.film_ready
                  ? '成片成功'
                  : project.last_task_status
                    ? statusLabel(project.last_task_status)
                    : '已更新';
              return (
                <button
                  type="button"
                  className="admin-project-activity"
                  key={project.project_id}
                  onClick={() => onOpenProject(project.project_id)}
                >
                  <Tag color={failedPhase ? 'red' : project.film_ready ? 'green' : statusColor(project.last_task_status)}>
                    {stateText}
                  </Tag>
                  <Typography.Text title={project.project_id} className="admin-project-activity-id">
                    {compactId(project.project_id, 20, 6)}
                  </Typography.Text>
                  <span className="admin-project-activity-time">{formatShortTime(project.updated_at)}</span>
                </button>
              );
            })}
            <Button size="small" onClick={() => onOpenProject('')}>查看项目管理</Button>
          </Space>
        </Card>
      </div>
    </Space>
  );
};

const UsersPanel = ({
  users,
  roles,
  tenants,
  workspaces,
  reload,
}: {
  users: AdminUser[];
  roles: Role[];
  tenants: Tenant[];
  workspaces: Workspace[];
  reload: () => Promise<void>;
}) => {
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [roleModalUser, setRoleModalUser] = useState<AdminUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const openCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({
      default_tenant_id: tenants[0]?.tenant_id,
      default_workspace_id: workspaces[0]?.workspace_id,
    });
    setUserModalVisible(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    form.setFieldsValue({
      display_name: user.display_name,
      email: user.email,
      phone: user.phone,
      default_tenant_id: user.default_tenant_id,
      default_workspace_id: user.default_workspace_id,
    });
    setUserModalVisible(true);
  };

  const saveUser = async () => {
    const values = await form.validate();
    if (editingUser) {
      await updateAdminUser(editingUser.id, values);
    } else {
      await createAdminUser(values);
    }
    setUserModalVisible(false);
    await reload();
  };

  const openRoles = (user: AdminUser) => {
    setRoleModalUser(user);
    roleForm.setFieldsValue({ role_ids: user.roles.map(role => role.id) });
  };

  const saveRoles = async () => {
    const values = await roleForm.validate();
    if (roleModalUser) {
      await replaceAdminUserRoles(roleModalUser.id, values.role_ids || []);
      setRoleModalUser(null);
      await reload();
    }
  };

  const savePassword = async () => {
    const values = await passwordForm.validate();
    if (passwordUser) {
      await resetAdminUserPassword(passwordUser.id, values.password);
      setPasswordUser(null);
      passwordForm.resetFields();
      Message.success('密码已重置');
    }
  };

  return (
    <Card
      title="用户管理"
      extra={<Button type="primary" onClick={openCreate}>新建用户</Button>}
    >
      <Table
        rowKey="id"
        data={users}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'display_name' },
          {
            title: '默认项目组',
            render: (_, user) => user.default_workspace?.display_name
              || user.default_workspace?.name
              || user.default_workspace_id
              || '-',
          },
          { title: '状态', render: (_, user) => statusTag(user.status) },
          {
            title: '角色',
            render: (_, user) => (
              <Space wrap>
                {user.roles.map(role => <Tag key={role.id}>{role.name}</Tag>)}
              </Space>
            ),
          },
          { title: '最近登录', render: (_, user) => formatTime(user.last_login_at) },
          {
            title: '操作',
            width: 280,
            render: (_, user) => (
              <Space>
                <Button size="small" onClick={() => openEdit(user)}>编辑</Button>
                <Button size="small" onClick={() => openRoles(user)}>角色</Button>
                <Button size="small" onClick={() => setPasswordUser(user)}>重置密码</Button>
                <Button
                  size="small"
                  status={user.status === 'active' ? 'danger' : 'success'}
                  disabled={user.is_super_admin}
                  onClick={async () => {
                    await setAdminUserStatus(
                      user.id,
                      user.status === 'active' ? 'disabled' : 'active',
                    );
                    await reload();
                  }}
                >
                  {user.status === 'active' ? '禁用' : '启用'}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editingUser ? '编辑用户' : '新建用户'}
        visible={userModalVisible}
        onOk={saveUser}
        onCancel={() => setUserModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          {!editingUser && (
            <FormItem label="用户名" field="username" rules={[{ required: true }]}>
              <Input />
            </FormItem>
          )}
          <FormItem label="姓名" field="display_name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="默认企业" field="default_tenant_id" rules={[{ required: true }]}>
            <Select>
              {tenants.map(tenant => (
                <Select.Option key={tenant.tenant_id} value={tenant.tenant_id}>
                  {tenant.display_name || tenant.name || tenant.tenant_id}
                </Select.Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="默认项目组" field="default_workspace_id" rules={[{ required: true }]}>
            <Select>
              {workspaces.map(workspace => (
                <Select.Option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.display_name || workspace.name || workspace.workspace_id}
                </Select.Option>
              ))}
            </Select>
          </FormItem>
          {!editingUser && (
            <FormItem label="密码" field="password" rules={[{ required: true, minLength: 8 }]}>
              <Input.Password />
            </FormItem>
          )}
          {!editingUser && (
            <FormItem label="角色" field="role_ids">
              <Select mode="multiple">
                {roles.map(role => (
                  <Select.Option key={role.id} value={role.id}>
                    {role.name}
                  </Select.Option>
                ))}
              </Select>
            </FormItem>
          )}
          <FormItem label="邮箱" field="email">
            <Input />
          </FormItem>
          <FormItem label="手机" field="phone">
            <Input />
          </FormItem>
        </Form>
      </Modal>
      <Modal
        title="分配角色"
        visible={Boolean(roleModalUser)}
        onOk={saveRoles}
        onCancel={() => setRoleModalUser(null)}
      >
        <Form form={roleForm} layout="vertical">
          <FormItem label="角色" field="role_ids">
            <Select mode="multiple">
              {roles.map(role => (
                <Select.Option key={role.id} value={role.id}>
                  {role.name}
                </Select.Option>
              ))}
            </Select>
          </FormItem>
        </Form>
      </Modal>
      <Modal
        title="重置密码"
        visible={Boolean(passwordUser)}
        onOk={savePassword}
        onCancel={() => setPasswordUser(null)}
      >
        <Form form={passwordForm} layout="vertical">
          <FormItem label="新密码" field="password" rules={[{ required: true, minLength: 8 }]}>
            <Input.Password />
          </FormItem>
        </Form>
      </Modal>
    </Card>
  );
};

const OrganizationPanel = ({
  organizations,
  reload,
}: {
  organizations: OrganizationState;
  reload: () => Promise<void>;
}) => {
  const [tenantVisible, setTenantVisible] = useState(false);
  const [workspaceVisible, setWorkspaceVisible] = useState(false);
  const [tenantForm] = Form.useForm();
  const [workspaceForm] = Form.useForm();

  const tenantName = (tenantId?: string) => {
    const tenant = organizations.tenants.find(item => item.tenant_id === tenantId);
    return tenant?.display_name || tenant?.name || tenantId || '-';
  };

  const saveTenant = async () => {
    const values = await tenantForm.validate();
    await createTenant(values);
    setTenantVisible(false);
    tenantForm.resetFields();
    await reload();
  };

  const saveWorkspace = async () => {
    const values = await workspaceForm.validate();
    await createWorkspace(values);
    setWorkspaceVisible(false);
    workspaceForm.resetFields();
    await reload();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="企业"
        extra={<Button type="primary" onClick={() => setTenantVisible(true)}>新建企业</Button>}
      >
        <Table
          rowKey="tenant_id"
          data={organizations.tenants}
          pagination={false}
          columns={[
            { title: '企业名称', render: (_, tenant) => tenant.display_name || tenant.name },
            { title: '企业 ID', dataIndex: 'tenant_id' },
            { title: '状态', render: (_, tenant) => statusTag(tenant.status) },
            { title: '项目组', render: (_, tenant) => formatNumber(tenant.workspace_count) },
            { title: '用户', render: (_, tenant) => formatNumber(tenant.user_count) },
            { title: '计费币种', render: (_, tenant) => tenant.billing_currency || 'CNY' },
            { title: '创建时间', render: (_, tenant) => formatTime(tenant.created_at) },
          ]}
        />
      </Card>
      <Card
        title="项目组"
        extra={<Button type="primary" onClick={() => setWorkspaceVisible(true)}>新建项目组</Button>}
      >
        <Table
          rowKey="workspace_id"
          data={organizations.workspaces}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '项目组名称', render: (_, workspace) => workspace.display_name || workspace.name },
            { title: '所属企业', render: (_, workspace) => tenantName(workspace.tenant_id) },
            { title: '项目组 ID', dataIndex: 'workspace_id' },
            { title: '状态', render: (_, workspace) => statusTag(workspace.status) },
            { title: '项目数', render: (_, workspace) => formatNumber(workspace.project_count) },
            { title: '用户数', render: (_, workspace) => formatNumber(workspace.user_count) },
            { title: '月预算', render: (_, workspace) => workspace.monthly_budget_limit ? `¥${workspace.monthly_budget_limit}` : '-' },
          ]}
        />
      </Card>
      <Modal
        title="新建企业"
        visible={tenantVisible}
        onOk={saveTenant}
        onCancel={() => setTenantVisible(false)}
      >
        <Form form={tenantForm} layout="vertical">
          <FormItem label="企业名称" field="name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="显示名称" field="display_name">
            <Input />
          </FormItem>
          <FormItem label="联系人" field="contact_name">
            <Input />
          </FormItem>
          <FormItem label="联系邮箱" field="contact_email">
            <Input />
          </FormItem>
          <FormItem label="联系电话" field="contact_phone">
            <Input />
          </FormItem>
        </Form>
      </Modal>
      <Modal
        title="新建项目组"
        visible={workspaceVisible}
        onOk={saveWorkspace}
        onCancel={() => setWorkspaceVisible(false)}
      >
        <Form
          form={workspaceForm}
          layout="vertical"
          initialValues={{ tenant_id: organizations.tenants[0]?.tenant_id, billing_mode: 'inherit' }}
        >
          <FormItem label="所属企业" field="tenant_id" rules={[{ required: true }]}>
            <Select>
              {organizations.tenants.map(tenant => (
                <Select.Option key={tenant.tenant_id} value={tenant.tenant_id}>
                  {tenant.display_name || tenant.name || tenant.tenant_id}
                </Select.Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="项目组名称" field="name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="显示名称" field="display_name">
            <Input />
          </FormItem>
          <FormItem label="描述" field="description">
            <Input.TextArea />
          </FormItem>
          <FormItem label="月预算" field="monthly_budget_limit">
            <Input />
          </FormItem>
        </Form>
      </Modal>
    </Space>
  );
};

const RolesPanel = ({
  roles,
  permissions,
  reload,
}: {
  roles: Role[];
  permissions: Permission[];
  reload: () => Promise<void>;
}) => {
  const [visible, setVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [form] = Form.useForm();

  const groupedPermissions = useMemo(() => {
    return permissions.reduce<Record<string, Permission[]>>((memo, permission) => {
      memo[permission.resource] = memo[permission.resource] || [];
      memo[permission.resource].push(permission);
      return memo;
    }, {});
  }, [permissions]);

  const openCreate = () => {
    setEditingRole(null);
    form.resetFields();
    setVisible(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    form.setFieldsValue({
      code: role.code,
      name: role.name,
      description: role.description,
      permission_codes: role.permission_codes,
    });
    setVisible(true);
  };

  const saveRole = async () => {
    const values = await form.validate();
    if (editingRole) {
      await updateAdminRole(editingRole.id, values);
    } else {
      await createAdminRole(values);
    }
    setVisible(false);
    await reload();
  };

  return (
    <Card title="角色权限" extra={<Button type="primary" onClick={openCreate}>新建角色</Button>}>
      <Table
        rowKey="id"
        data={roles}
        pagination={false}
        columns={[
          { title: '编码', dataIndex: 'code' },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', render: (_, role) => role.is_system ? <Tag color="blue">系统</Tag> : <Tag>自定义</Tag> },
          { title: '权限数', render: (_, role) => role.permission_codes.length },
          {
            title: '操作',
            render: (_, role) => (
              <Space>
                <Button size="small" onClick={() => openEdit(role)}>编辑</Button>
                <Button
                  size="small"
                  status="danger"
                  disabled={role.is_system}
                  onClick={() => {
                    Modal.confirm({
                      title: '删除角色',
                      content: `确认删除 ${role.name}？`,
                      onOk: async () => {
                        await deleteAdminRole(role.id);
                        await reload();
                      },
                    });
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        visible={visible}
        onOk={saveRole}
        onCancel={() => setVisible(false)}
        style={{ width: 720 }}
      >
        <Form form={form} layout="vertical">
          <FormItem label="编码" field="code" rules={[{ required: true }]}>
            <Input disabled={Boolean(editingRole?.is_system)} />
          </FormItem>
          <FormItem label="名称" field="name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="描述" field="description">
            <Input.TextArea />
          </FormItem>
          <FormItem label="权限" field="permission_codes">
            <Checkbox.Group>
              <div className="admin-permission-grid">
                {Object.entries(groupedPermissions).map(([resource, items]) => (
                  <div className="admin-permission-group" key={resource}>
                    <Typography.Text bold>{resource}</Typography.Text>
                    {items.map(permission => (
                      <Checkbox key={permission.code} value={permission.code}>
                        {permission.name}
                      </Checkbox>
                    ))}
                  </div>
                ))}
              </div>
            </Checkbox.Group>
          </FormItem>
        </Form>
      </Modal>
    </Card>
  );
};

const ProjectsPanel = ({
  projects,
  users,
  reload,
  initialProjectId,
  onOpenTasks,
}: {
  projects: AdminProject[];
  users: AdminUser[];
  reload: () => Promise<void>;
  initialProjectId?: string;
  onOpenTasks: (filters?: Record<string, string>) => void;
}) => {
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [projectDetail, setProjectDetail] = useState<AdminProjectDetail | null>(null);
  const [phaseFilter, setPhaseFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [manifestVisible, setManifestVisible] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AdminAsset | null>(null);
  const [deleteProject, setDeleteProject] = useState<AdminProject | null>(null);
  const [ownerProject, setOwnerProject] = useState<AdminProject | null>(null);
  const [confirmProjectId, setConfirmProjectId] = useState('');
  const [fullTextDetail, setFullTextDetail] = useState<{ title: string; value: string } | null>(null);
  const [ownerForm] = Form.useForm();
  const projectDetailRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToProjectDetailRef = useRef(false);

  const openAssets = async (projectId: string, options?: { scrollToDetail?: boolean }) => {
    shouldScrollToProjectDetailRef.current = Boolean(options?.scrollToDetail);
    setSelectedProject(projectId);
    setLoadingAssets(true);
    try {
      const [assetResult, detailResult] = await Promise.all([
        getAdminProjectAssets(projectId),
        getAdminProjectDetail(projectId),
      ]);
      setAssets(assetResult.assets);
      setProjectDetail(detailResult);
      setPhaseFilter('');
      setStatusFilter('');
    } finally {
      setLoadingAssets(false);
    }
  };

  const phaseOptions = useMemo(
    () => Array.from(new Set(assets.map(asset => asset.phase).filter(Boolean))),
    [assets],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(assets.map(asset => asset.status).filter(Boolean))),
    [assets],
  );

  const filteredAssets = useMemo(
    () =>
      assets.filter(asset => {
        if (phaseFilter && asset.phase !== phaseFilter) {
          return false;
        }
        if (statusFilter && asset.status !== statusFilter) {
          return false;
        }
        return true;
      }),
    [assets, phaseFilter, statusFilter],
  );

  const previewUrl = previewAsset?.download_url
    ? resolveBackendUrl(previewAsset.download_url)
    : '';

  const confirmDeleteProject = async () => {
    if (!deleteProject) {
      return;
    }
    await safeDeleteAdminProject(deleteProject.project_id, confirmProjectId.trim());
    Message.success('项目已删除');
    setDeleteProject(null);
    setConfirmProjectId('');
    if (selectedProject === deleteProject.project_id) {
      setSelectedProject('');
      setAssets([]);
      setProjectDetail(null);
    }
    await reload();
  };

  const openOwnerModal = (project: AdminProject) => {
    setOwnerProject(project);
    ownerForm.setFieldsValue({
      owner_user_id: project.owner_user_id || undefined,
    });
  };

  const saveProjectOwner = async () => {
    if (!ownerProject) {
      return;
    }
    const values = await ownerForm.validate();
    await assignAdminProjectOwner(ownerProject.project_id, values.owner_user_id || null);
    Message.success('负责人已更新');
    setOwnerProject(null);
    if (selectedProject === ownerProject.project_id) {
      await openAssets(ownerProject.project_id);
    }
    await reload();
  };

  useEffect(() => {
    if (initialProjectId && initialProjectId !== selectedProject) {
      openAssets(initialProjectId);
    }
  }, [initialProjectId]);

  useEffect(() => {
    if (!shouldScrollToProjectDetailRef.current || !projectDetail) {
      return;
    }
    shouldScrollToProjectDetailRef.current = false;
    window.requestAnimationFrame(() => {
      projectDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [projectDetail]);

  return (
    <div className="admin-panel-stack">
      <Card title="项目管理" className="admin-wide-table-card">
        <div className="admin-wide-table-viewport">
          <div className="admin-project-table-canvas">
            <Table
              rowKey="project_id"
              data={projects}
              pagination={{ pageSize: 8 }}
              columns={[
                {
                  title: '项目 ID',
                  dataIndex: 'project_id',
                  width: 210,
                  render: (_, item) => (
                    <Typography.Text className="admin-mono-id" title={item.project_id}>
                      {compactId(item.project_id, 18, 8)}
                    </Typography.Text>
                  ),
                },
                { title: '企业', width: 120, render: (_, item) => item.tenant_name || item.tenant_id || '-' },
                { title: '项目组', width: 130, render: (_, item) => item.workspace_name || item.workspace_id || '-' },
                { title: '资产', width: 80, render: (_, item) => `${item.ready_asset_count}/${item.asset_count}` },
                { title: '任务', width: 70, render: (_, item) => item.task_count || 0 },
                {
                  title: '负责人',
                  width: 120,
                  render: (_, item) => item.owner_user_id
                    ? (
                      <Typography.Text className="admin-file-name" title={item.owner_username || item.owner_display_name}>
                        {item.owner_display_name || item.owner_username}
                      </Typography.Text>
                    )
                    : <Tag color="orange">未分配</Tag>,
                },
                { title: '最近任务', width: 120, render: (_, item) => item.last_task_status ? statusTag(item.last_task_status) : '-' },
                { title: '磁盘', width: 100, render: (_, item) => item.disk_usage?.display || '-' },
                { title: '成片', width: 100, render: (_, item) => item.film_ready ? <Tag color="green">ready</Tag> : <Tag>未完成</Tag> },
                { title: '更新时间', width: 170, render: (_, item) => formatTime(item.updated_at) },
                {
                  title: '操作',
                  width: 360,
                  render: (_, item) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => openAssets(item.project_id, { scrollToDetail: true })}
                      >
                        详情
                      </Button>
                      <Button
                        size="small"
                        onClick={() => onOpenTasks({ project_id: item.project_id })}
                      >
                        任务
                      </Button>
                      <Button size="small" onClick={() => openOwnerModal(item)}>负责人</Button>
                      <Button
                        size="small"
                        icon={<IconDownload />}
                        href={resolveBackendUrl(`/v1/assets/projects/${item.project_id}/archive-all`)}
                      >
                        下载
                      </Button>
                      <Button
                        size="small"
                        status="danger"
                        icon={<IconDelete />}
                        onClick={() => {
                          setDeleteProject(item);
                          setConfirmProjectId('');
                        }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </Card>
      {projectDetail && (
        <div ref={projectDetailRef} className="admin-project-detail-anchor">
          <Card
            title={`项目详情：${selectedProject}`}
            extra={<Button onClick={() => setManifestVisible(true)}>查看 manifest</Button>}
          >
          <Descriptions
            column={2}
            data={[
              { label: '项目 ID', value: selectedProject },
              { label: '磁盘占用', value: projectDetail.disk_usage.display },
              { label: '任务数', value: projectDetail.tasks.length },
              {
                label: '负责人',
                value: projectDetail.project?.owner_user_id
                  ? `${projectDetail.project.owner_display_name || projectDetail.project.owner_username}`
                  : <Tag color="orange">未分配</Tag>,
              },
              {
                label: '最近任务状态',
                value: projectDetail.project?.last_task_status
                  ? statusTag(projectDetail.project.last_task_status)
                  : '-',
              },
              { label: '项目目录', value: projectDetail.project?.project_dir || '-' },
              { label: 'manifest', value: projectDetail.project?.manifest_path || '-' },
              { label: '创建时间', value: formatTime(projectDetail.project?.created_at) },
              { label: '更新时间', value: formatTime(projectDetail.project?.updated_at) },
            ]}
          />
          <div className="admin-phase-grid">
            {Object.entries(projectDetail.phase_counts || {}).map(([phase, counts]) => (
              <div className="admin-phase-item" key={phase}>
                <Typography.Text bold>{phase}</Typography.Text>
                <Typography.Text type="secondary">
                  total {counts.total || 0} / ready {counts.ready || 0} / failed {counts.failed || 0}
                </Typography.Text>
              </div>
            ))}
          </div>
          <Typography.Title heading={6} className="admin-section-title">关联任务</Typography.Title>
          <Table
            rowKey="task_id"
            data={projectDetail.tasks}
            pagination={{ pageSize: 5 }}
            columns={[
              { title: '任务 ID', dataIndex: 'task_id' },
              { title: '阶段', render: (_, task) => task.phase_label || task.phase },
              { title: '状态', render: (_, task) => statusTag(task.status) },
              { title: '进度', render: (_, task) => <Progress percent={task.progress || 0} size="small" /> },
              { title: '资产', render: (_, task) => `${task.ready_asset_count}/${task.asset_count}` },
              { title: '更新时间', render: (_, task) => formatTime(task.updated_at) },
              {
                title: '操作',
                render: (_, task) => (
                  <Button
                    size="small"
                    onClick={() => onOpenTasks({ project_id: task.project_id, phase: task.phase })}
                  >
                    查看
                  </Button>
                ),
              },
            ]}
          />
          </Card>
        </div>
      )}
      {selectedProject && (
        <Card
          className="admin-assets-card"
          title={`资产：${selectedProject}`}
          extra={(
            <Space>
              <Select
                allowClear
                placeholder="阶段"
                value={phaseFilter || undefined}
                onChange={value => setPhaseFilter(value || '')}
                style={{ width: 140 }}
              >
                {phaseOptions.map(phase => (
                  <Select.Option key={phase} value={phase}>{phase}</Select.Option>
                ))}
              </Select>
              <Select
                allowClear
                placeholder="状态"
                value={statusFilter || undefined}
                onChange={value => setStatusFilter(value || '')}
                style={{ width: 120 }}
              >
                {statusOptions.map(status => (
                  <Select.Option key={status} value={status}>{status}</Select.Option>
                ))}
              </Select>
            </Space>
          )}
        >
          <Spin loading={loadingAssets}>
            <div className="admin-asset-table-viewport">
              <div className="admin-asset-table-canvas">
                <Table
                  rowKey="asset_id"
                  data={filteredAssets}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    {
                      title: '资产 ID',
                      dataIndex: 'asset_id',
                      width: 150,
                      render: (_, asset) => (
                        <Typography.Text className="admin-mono-id" title={asset.asset_id || '-'}>
                          {asset.asset_id || '-'}
                        </Typography.Text>
                      ),
                    },
                    {
                      title: '阶段',
                      dataIndex: 'phase',
                      width: 130,
                      render: (_, asset) => (
                        <Typography.Text className="admin-file-name" title={asset.phase || '-'}>
                          {asset.phase || '-'}
                        </Typography.Text>
                      ),
                    },
                    {
                      title: '文件',
                      dataIndex: 'filename',
                      width: 170,
                      render: (_, asset) => (
                        <Typography.Text className="admin-file-name" title={asset.filename || '-'}>
                          {asset.filename || '-'}
                        </Typography.Text>
                      ),
                    },
                    { title: '状态', width: 96, render: (_, asset) => statusTag(asset.status) },
                    {
                      title: '任务',
                      width: 160,
                      render: (_, asset) =>
                        (
                          <Typography.Text
                            className="admin-mono-id"
                            title={asset.video_gen_task_id || asset.metadata?.video_gen_task_id || '-'}
                          >
                            {asset.video_gen_task_id || asset.metadata?.video_gen_task_id || '-'}
                          </Typography.Text>
                        ),
                    },
                    {
                      title: '消息',
                      width: 320,
                      render: (_, asset) => (
                        <LongTextCell
                          value={asset.message ? summarizeError(asset.message) : undefined}
                          detailValue={asset.message}
                          maxLength={76}
                          onDetail={value => setFullTextDetail({ title: '资产消息', value })}
                        />
                      ),
                    },
                    { title: '更新时间', width: 170, render: (_, asset) => formatTime(asset.updated_at) },
                    {
                      title: '操作',
                      width: 260,
                      render: (_, asset) => (
                        <Space>
                          {asset.download_url && (
                            <Button
                              size="small"
                              icon={<IconEye />}
                              onClick={() => setPreviewAsset(asset)}
                            >
                              预览
                            </Button>
                          )}
                          {asset.download_url && (
                            <Button
                              size="small"
                              href={resolveBackendUrl(asset.download_url)}
                              icon={<IconDownload />}
                            >
                              下载
                            </Button>
                          )}
                          <Button
                            size="small"
                            status="danger"
                            icon={<IconDelete />}
                            onClick={() => {
                              Modal.confirm({
                                title: '删除资产',
                                content: `确认删除资产 ${asset.asset_id}？`,
                                onOk: async () => {
                                  await deleteAdminAsset(selectedProject, asset.asset_id);
                                  await openAssets(selectedProject);
                                  await reload();
                                },
                              });
                            }}
                          >
                            删除
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </Spin>
        </Card>
      )}
      <Modal
        title={`分配负责人：${ownerProject?.project_id || ''}`}
        visible={Boolean(ownerProject)}
        onOk={saveProjectOwner}
        onCancel={() => setOwnerProject(null)}
      >
        <Form form={ownerForm} layout="vertical">
          <FormItem label="负责人" field="owner_user_id">
            <Select allowClear placeholder="选择负责人，留空则标记为未分配">
              {users.map(user => (
                <Select.Option key={user.id} value={user.id}>
                  {user.display_name || user.username}（{user.username}）
                </Select.Option>
              ))}
            </Select>
          </FormItem>
        </Form>
      </Modal>
      <Modal
        title={`manifest：${selectedProject}`}
        visible={manifestVisible}
        onCancel={() => setManifestVisible(false)}
        footer={null}
        style={{ width: 820 }}
      >
        <pre className="admin-json-view">
          {JSON.stringify(projectDetail?.manifest || {}, null, 2)}
        </pre>
      </Modal>
      <Modal
        title={previewAsset?.filename || previewAsset?.asset_id || '资产预览'}
        visible={Boolean(previewAsset)}
        onCancel={() => setPreviewAsset(null)}
        footer={null}
        style={{ width: 820 }}
      >
        {previewAsset?.preview_type === 'image' && (
          <img className="admin-preview-media" src={previewUrl} alt={previewAsset.asset_id} />
        )}
        {previewAsset?.preview_type === 'video' && (
          <video className="admin-preview-media" src={previewUrl} controls />
        )}
        {previewAsset?.preview_type === 'audio' && (
          <audio className="admin-preview-audio" src={previewUrl} controls />
        )}
        {previewAsset && previewAsset.preview_type === 'file' && (
          <Typography.Text type="secondary">该资产不支持直接预览，请下载查看。</Typography.Text>
        )}
      </Modal>
      <Modal
        title={fullTextDetail?.title || '详情'}
        visible={Boolean(fullTextDetail)}
        onCancel={() => setFullTextDetail(null)}
        footer={[
          <Button key="copy" icon={<IconCopy />} onClick={() => copyText(fullTextDetail?.value)}>
            复制
          </Button>,
          <Button key="close" type="primary" onClick={() => setFullTextDetail(null)}>
            关闭
          </Button>,
        ]}
        style={{ width: 820 }}
      >
        <pre className="admin-long-text-modal">{fullTextDetail?.value || ''}</pre>
      </Modal>
      <Modal
        title="删除项目"
        visible={Boolean(deleteProject)}
        onOk={confirmDeleteProject}
        onCancel={() => setDeleteProject(null)}
        okButtonProps={{
          status: 'danger',
          disabled: confirmProjectId.trim() !== deleteProject?.project_id,
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            content={`将删除项目 ${deleteProject?.project_id || ''} 及其本地资产文件。`}
          />
          <Typography.Text>请输入项目 ID 确认删除：</Typography.Text>
          <Input value={confirmProjectId} onChange={setConfirmProjectId} />
        </Space>
      </Modal>
    </div>
  );
};

const TasksPanel = ({
  tasks,
  filters,
  onSearch,
  onOpenProject,
}: {
  tasks: AdminTask[];
  filters: Record<string, string>;
  onSearch: (params: Record<string, string>) => Promise<void>;
  onOpenProject: (projectId: string) => void;
}) => {
  const [localFilters, setLocalFilters] = useState({
    status: filters.status || '',
    phase: filters.phase || '',
    project_id: filters.project_id || '',
  });
  const [detail, setDetail] = useState<AdminTask | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AdminAsset | null>(null);
  const [fullTextDetail, setFullTextDetail] = useState<{ title: string; value: string } | null>(null);

  useEffect(() => {
    setLocalFilters({
      status: filters.status || '',
      phase: filters.phase || '',
      project_id: filters.project_id || '',
    });
  }, [filters.status, filters.phase, filters.project_id]);

  const phaseOptions = useMemo(
    () => Array.from(new Set(tasks.map(task => task.phase).filter(Boolean))),
    [tasks],
  );

  const openDetail = async (task: AdminTask) => {
    setLoadingDetail(true);
    try {
      const result = await getAdminTask(task.task_id);
      setDetail(result.task);
    } finally {
      setLoadingDetail(false);
    }
  };

  const previewUrl = previewAsset?.download_url
    ? resolveBackendUrl(previewAsset.download_url)
    : '';
  const taskErrorDetail = detail?.error_detail || detail?.error_message || '';
  const taskErrorSummary = summarizeError(detail?.error_message || taskErrorDetail);

  return (
    <Card title="任务中心" className="admin-task-center-card">
      <Space className="admin-filter-bar" wrap>
        <Select
          allowClear
          placeholder="状态"
          value={localFilters.status || undefined}
          onChange={value => setLocalFilters({ ...localFilters, status: value || '' })}
          style={{ width: 140 }}
        >
          {['pending', 'running', 'succeeded', 'failed', 'unknown'].map(status => (
            <Select.Option key={status} value={status}>{status}</Select.Option>
          ))}
        </Select>
        <Select
          allowClear
          placeholder="阶段"
          value={localFilters.phase || undefined}
          onChange={value => setLocalFilters({ ...localFilters, phase: value || '' })}
          style={{ width: 160 }}
        >
          {phaseOptions.map(phase => (
            <Select.Option key={phase} value={phase}>{phase}</Select.Option>
          ))}
        </Select>
        <Input
          placeholder="项目 ID"
          value={localFilters.project_id}
          onChange={value => setLocalFilters({ ...localFilters, project_id: value })}
          style={{ width: 260 }}
        />
        <Button type="primary" onClick={() => onSearch(localFilters)}>筛选</Button>
        <Button
          onClick={() => {
            const nextFilters = { status: '', phase: '', project_id: '' };
            setLocalFilters(nextFilters);
            onSearch(nextFilters);
          }}
        >
          重置
        </Button>
      </Space>
      <div className="admin-wide-table-viewport">
        <div className="admin-task-main-table-canvas">
          <Table
            rowKey="task_id"
            data={tasks}
            pagination={{ pageSize: 12 }}
            columns={[
              {
                title: '任务 ID',
                dataIndex: 'task_id',
                width: 230,
                render: (_, task) => (
                  <Typography.Text className="admin-mono-id" title={task.task_id}>
                    {compactId(task.task_id, 20, 8)}
                  </Typography.Text>
                ),
              },
              {
                title: '项目',
                dataIndex: 'project_id',
                width: 210,
                render: (_, task) => (
                  <Typography.Text className="admin-mono-id" title={task.project_id}>
                    {compactId(task.project_id, 18, 8)}
                  </Typography.Text>
                ),
              },
              { title: '企业', width: 120, render: (_, task) => task.tenant_id || '-' },
              { title: '项目组', width: 130, render: (_, task) => task.workspace_id || '-' },
              { title: '创建人', width: 110, render: (_, task) => task.creator_username || '-' },
              { title: '阶段', width: 130, render: (_, task) => task.phase_label || task.phase },
              { title: '状态', width: 110, render: (_, task) => statusTag(task.status) },
              { title: '进度', width: 130, render: (_, task) => <Progress percent={task.progress || 0} size="small" /> },
              { title: '资产', width: 80, render: (_, task) => `${task.ready_asset_count}/${task.asset_count}` },
              { title: '失败', width: 70, render: (_, task) => task.failed_asset_count || 0 },
              { title: '更新时间', width: 170, render: (_, task) => formatTime(task.updated_at) },
              {
                title: '操作',
                width: 170,
                render: (_, task) => (
                  <Space>
                    <Button size="small" onClick={() => openDetail(task)}>详情</Button>
                    <Button size="small" onClick={() => onOpenProject(task.project_id)}>项目</Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </div>
      <Drawer
        title={
          detail ? (
            <div className="admin-task-drawer-title">
              <Typography.Text className="admin-task-drawer-title-main">
                {detail.phase_label || detail.phase || '任务详情'}{detail.status === 'failed' ? '生成失败' : '生成任务'}
              </Typography.Text>
              <Typography.Text type="secondary" className="admin-task-drawer-title-sub">
                {detail.project_id} · {formatTime(detail.updated_at)}
              </Typography.Text>
            </div>
          ) : '任务详情'
        }
        visible={Boolean(detail) || loadingDetail}
        onCancel={() => setDetail(null)}
        footer={null}
        width="min(920px, 92vw)"
        className="admin-task-detail-drawer"
      >
        <Spin loading={loadingDetail}>
          {detail && (
            <div className="admin-task-detail-stack">
              <Descriptions
                column={1}
                data={[
                  { label: '任务 ID', value: detail.task_id },
                  { label: '项目 ID', value: detail.project_id },
                  { label: '创建人', value: detail.creator_username || '-' },
                  { label: '任务类型', value: detail.task_type },
                  { label: '阶段', value: detail.phase_label || detail.phase },
                  { label: '状态', value: statusTag(detail.status) },
                  { label: '进度', value: <Progress percent={detail.progress || 0} size="small" /> },
                  { label: '资产', value: `${detail.ready_asset_count}/${detail.asset_count}` },
                  { label: '创建时间', value: formatTime(detail.created_at) },
                  { label: '更新时间', value: formatTime(detail.updated_at) },
                  { label: '耗时', value: detail.duration_seconds == null ? '-' : `${detail.duration_seconds}s` },
                  { label: '错误摘要', value: taskErrorSummary || '-' },
                  { label: '错误码', value: detail.error_code || '-' },
                  { label: '错误类型', value: detail.error_type || '-' },
                  { label: '来源', value: detail.provider || '-' },
                  { label: '可重试', value: detail.retryable == null ? '-' : detail.retryable ? '是' : '否' },
                  {
                    label: '完整错误',
                    value: taskErrorDetail ? (
                      <Space>
                        <Button
                          size="small"
                          onClick={() => setFullTextDetail({ title: '完整错误', value: taskErrorDetail })}
                        >
                          查看完整错误
                        </Button>
                        <Button size="small" icon={<IconCopy />} onClick={() => copyText(taskErrorDetail)}>
                          复制
                        </Button>
                      </Space>
                    ) : '-',
                  },
                ]}
              />
              <Card title="阶段事件" className="admin-task-table-card">
                <div className="admin-task-table-viewport">
                  <div className="admin-task-events-table-canvas">
                    <Table
                      rowKey="event_id"
                      data={detail.events || []}
                      pagination={false}
                      columns={[
                        { title: '资产', dataIndex: 'asset_id', width: 150, render: (_, event) => (
                          <Typography.Text className="admin-mono-id" title={event.asset_id || '-'}>
                            {event.asset_id || '-'}
                          </Typography.Text>
                        ) },
                        { title: '状态', width: 96, render: (_, event) => statusTag(event.status) },
                        { title: '消息', width: 390, render: (_, event) => (
                          <LongTextCell
                            value={(event.error_message || event.message) ? summarizeError(event.error_message || event.message) : undefined}
                            detailValue={event.error_message || event.message}
                            maxLength={92}
                            onDetail={value => setFullTextDetail({ title: '事件消息', value })}
                          />
                        ) },
                        { title: '时间', width: 170, render: (_, event) => formatTime(event.updated_at) },
                      ]}
                    />
                  </div>
                </div>
              </Card>
              <Card title="关联资产" className="admin-task-table-card">
                <div className="admin-task-table-viewport">
                  <div className="admin-task-assets-table-canvas">
                    <Table
                      rowKey="asset_id"
                      data={detail.assets || []}
                      pagination={{ pageSize: 6 }}
                      columns={[
                        { title: '资产 ID', dataIndex: 'asset_id', width: 150, render: (_, asset) => (
                          <Typography.Text className="admin-mono-id" title={asset.asset_id || '-'}>
                            {asset.asset_id || '-'}
                          </Typography.Text>
                        ) },
                        { title: '文件', dataIndex: 'filename', width: 180, render: (_, asset) => (
                          <Typography.Text className="admin-file-name" title={asset.filename || '-'}>
                            {asset.filename || '-'}
                          </Typography.Text>
                        ) },
                        { title: '状态', width: 96, render: (_, asset) => statusTag(asset.status) },
                        { title: '消息', width: 330, render: (_, asset) => (
                          <LongTextCell
                            value={asset.message ? summarizeError(asset.message) : undefined}
                            detailValue={asset.message}
                            maxLength={80}
                            onDetail={value => setFullTextDetail({ title: '资产消息', value })}
                          />
                        ) },
                        {
                          title: '操作',
                          width: 130,
                          render: (_, asset) => (
                            <Space>
                              {asset.download_url && (
                                <Button size="small" onClick={() => setPreviewAsset(asset)}>预览</Button>
                              )}
                              {asset.download_url && (
                                <Button size="small" href={resolveBackendUrl(asset.download_url)}>下载</Button>
                              )}
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>
              </Card>
            </div>
          )}
        </Spin>
      </Drawer>
      <Modal
        title={previewAsset?.filename || previewAsset?.asset_id || '资产预览'}
        visible={Boolean(previewAsset)}
        onCancel={() => setPreviewAsset(null)}
        footer={null}
        style={{ width: 820 }}
      >
        {previewAsset?.preview_type === 'image' && (
          <img className="admin-preview-media" src={previewUrl} alt={previewAsset.asset_id} />
        )}
        {previewAsset?.preview_type === 'video' && (
          <video className="admin-preview-media" src={previewUrl} controls />
        )}
        {previewAsset?.preview_type === 'audio' && (
          <audio className="admin-preview-audio" src={previewUrl} controls />
        )}
        {previewAsset && previewAsset.preview_type === 'file' && (
          <Typography.Text type="secondary">该资产不支持直接预览，请下载查看。</Typography.Text>
        )}
      </Modal>
      <Modal
        title={fullTextDetail?.title || '详情'}
        visible={Boolean(fullTextDetail)}
        onCancel={() => setFullTextDetail(null)}
        footer={[
          <Button key="copy" icon={<IconCopy />} onClick={() => copyText(fullTextDetail?.value)}>
            复制
          </Button>,
          <Button key="close" type="primary" onClick={() => setFullTextDetail(null)}>
            关闭
          </Button>,
        ]}
        style={{ width: 820 }}
      >
        <pre className="admin-long-text-modal">{fullTextDetail?.value || ''}</pre>
      </Modal>
    </Card>
  );
};

const BillingPanel = ({
  billing,
  reloadBilling,
  onOpenProject,
  onOpenTasks,
}: {
  billing: BillingState;
  reloadBilling: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
  onOpenTasks: (filters?: Record<string, string>) => void;
}) => {
  const [priceRuleVisible, setPriceRuleVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<BillingPriceRule | null>(null);
  const [form] = Form.useForm();
  const summary = billing.summary;
  const currency = summary?.currency || 'CNY';
  const metricCards = [
    {
      label: '累计费用',
      value: formatCost(summary?.total_cost, currency),
      helper: `${formatNumber(summary?.project_count)} 个项目`,
      tone: 'neutral',
    },
    {
      label: '总 Tokens',
      value: formatNumber(summary?.total_tokens),
      helper: `输入 ${formatNumber(summary?.prompt_tokens)} / 输出 ${formatNumber(summary?.completion_tokens)}`,
      tone: 'info',
    },
    {
      label: '缓存 Tokens',
      value: formatNumber(summary?.cached_tokens),
      helper: '按缓存输入单价计费',
      tone: 'success',
    },
    {
      label: '推理 Tokens',
      value: formatNumber(summary?.reasoning_tokens),
      helper: '按推理 token 单价计费',
      tone: 'warning',
    },
    {
      label: '计费任务',
      value: formatNumber(summary?.task_count),
      helper: `${formatNumber(summary?.user_count)} 个用户`,
      tone: 'neutral',
    },
  ];

  const openCreatePriceRule = () => {
    setEditingRule(null);
    form.setFieldsValue({
      provider: 'volcengine',
      model: '',
      endpoint_id: '',
      resource_type: 'llm_token',
      phase: '',
      input_price_per_1m_tokens: 0,
      output_price_per_1m_tokens: 0,
      cached_input_price_per_1m_tokens: 0,
      reasoning_price_per_1m_tokens: 0,
      currency: 'CNY',
      enabled: true,
    });
    setPriceRuleVisible(true);
  };

  const openEditPriceRule = (rule: BillingPriceRule) => {
    setEditingRule(rule);
    form.setFieldsValue({
      code: rule.code,
      provider: rule.provider,
      model: rule.model || '',
      endpoint_id: rule.endpoint_id || '',
      resource_type: rule.resource_type || 'llm_token',
      phase: rule.phase || '',
      input_price_per_1m_tokens: rule.input_price_per_1m_tokens || 0,
      output_price_per_1m_tokens: rule.output_price_per_1m_tokens || 0,
      cached_input_price_per_1m_tokens: rule.cached_input_price_per_1m_tokens || 0,
      reasoning_price_per_1m_tokens: rule.reasoning_price_per_1m_tokens || 0,
      currency: rule.currency || 'CNY',
      enabled: Boolean(rule.enabled),
      effective_from: rule.effective_from || '',
      effective_to: rule.effective_to || '',
    });
    setPriceRuleVisible(true);
  };

  const savePriceRule = async () => {
    const values = await form.validate();
    const payload = {
      ...values,
      input_price_per_1m_tokens: Number(values.input_price_per_1m_tokens || 0),
      output_price_per_1m_tokens: Number(values.output_price_per_1m_tokens || 0),
      cached_input_price_per_1m_tokens: Number(values.cached_input_price_per_1m_tokens || 0),
      reasoning_price_per_1m_tokens: Number(values.reasoning_price_per_1m_tokens || 0),
      enabled: Boolean(values.enabled),
    };
    if (editingRule) {
      await updateBillingPriceRule(editingRule.id, payload);
    } else {
      await createBillingPriceRule(payload);
    }
    Message.success('价格规则已保存');
    setPriceRuleVisible(false);
    await reloadBilling();
  };

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div className="admin-billing-header">
        <div>
          <Typography.Title heading={4} style={{ margin: 0 }}>计费</Typography.Title>
          <Typography.Text type="secondary">
            按项目、任务和用户统计 LLM token 使用量及费用。
          </Typography.Text>
        </div>
        <Button type="primary" onClick={openCreatePriceRule}>新建价格规则</Button>
      </div>

      <div className="admin-dashboard-metrics">
        {metricCards.map(item => (
          <div key={item.label} className={`admin-metric-card admin-metric-${item.tone}`}>
            <span className="admin-metric-label">{item.label}</span>
            <span className="admin-metric-value admin-billing-metric-value">{item.value}</span>
            <span className="admin-metric-helper">{item.helper}</span>
          </div>
        ))}
      </div>

      <Card title="项目费用">
        <Table
          rowKey="project_id"
          data={billing.projects}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '项目',
              width: 230,
              render: (_, project) => (
                <Typography.Text className="admin-mono-id" title={project.project_id}>
                  {compactId(project.project_id, 18, 8)}
                </Typography.Text>
              ),
            },
            { title: '负责人', width: 120, render: (_, project) => project.owner_display_name || project.owner_username || '-' },
            {
              title: '企业',
              width: 130,
              render: (_, project) => project.tenant_display_name || project.tenant_name || project.tenant_id || '-',
            },
            {
              title: '项目组',
              width: 130,
              render: (_, project) => project.workspace_display_name || project.workspace_name || project.workspace_id || '-',
            },
            { title: '任务数', width: 90, render: (_, project) => formatNumber(project.task_count) },
            { title: '总 Tokens', width: 130, render: (_, project) => formatNumber(project.total_tokens) },
            { title: '输入', width: 120, render: (_, project) => formatNumber(project.prompt_tokens) },
            { title: '输出', width: 120, render: (_, project) => formatNumber(project.completion_tokens) },
            { title: '缓存', width: 120, render: (_, project) => formatNumber(project.cached_tokens) },
            { title: '费用', width: 150, render: (_, project) => formatCost(project.total_cost, currency) },
            { title: '更新时间', width: 170, render: (_, project) => formatTime(project.updated_at) },
            {
              title: '操作',
              width: 150,
              render: (_, project) => (
                <Space>
                  <Button size="small" onClick={() => onOpenProject(project.project_id)}>项目</Button>
                  <Button size="small" onClick={() => onOpenTasks({ project_id: project.project_id })}>任务</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="任务费用">
        <Table
          rowKey="task_id"
          data={billing.tasks}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '任务',
              width: 230,
              render: (_, task) => (
                <Typography.Text className="admin-mono-id" title={task.task_id}>
                  {compactId(task.task_id, 18, 8)}
                </Typography.Text>
              ),
            },
            {
              title: '项目',
              width: 190,
              render: (_, task) => (
                <Typography.Text className="admin-mono-id" title={task.project_id}>
                  {compactId(task.project_id, 14, 6)}
                </Typography.Text>
              ),
            },
            { title: '用户', width: 110, render: (_, task) => task.username || '-' },
            {
              title: '项目组',
              width: 130,
              render: (_, task) => task.workspace_display_name || task.workspace_name || task.workspace_id || '-',
            },
            { title: '阶段', width: 130, render: (_, task) => task.phase || '-' },
            { title: '状态', width: 100, render: (_, task) => statusTag(task.status) },
            { title: '事件', width: 80, render: (_, task) => formatNumber(task.event_count) },
            { title: '总 Tokens', width: 130, render: (_, task) => formatNumber(task.total_tokens) },
            { title: '费用', width: 150, render: (_, task) => formatCost(task.total_cost, currency) },
            { title: '更新时间', width: 170, render: (_, task) => formatTime(task.updated_at) },
            {
              title: '操作',
              width: 110,
              render: (_, task) => (
                <Button size="small" onClick={() => onOpenTasks({ project_id: task.project_id })}>
                  查看任务
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title="价格规则"
        extra={<Typography.Text type="secondary">单价单位：每 100 万 tokens</Typography.Text>}
      >
        <Table
          rowKey="id"
          data={billing.priceRules}
          pagination={false}
          columns={[
            { title: '编码', dataIndex: 'code', width: 220 },
            { title: 'Provider', dataIndex: 'provider', width: 120 },
            { title: '模型/Endpoint', width: 220, render: (_, rule) => rule.endpoint_id || rule.model || '-' },
            { title: '阶段', width: 120, render: (_, rule) => rule.phase || '全部' },
            { title: '输入', width: 110, render: (_, rule) => formatCost(rule.input_price_per_1m_tokens, rule.currency) },
            { title: '输出', width: 110, render: (_, rule) => formatCost(rule.output_price_per_1m_tokens, rule.currency) },
            { title: '缓存输入', width: 120, render: (_, rule) => formatCost(rule.cached_input_price_per_1m_tokens, rule.currency) },
            { title: '推理', width: 110, render: (_, rule) => formatCost(rule.reasoning_price_per_1m_tokens, rule.currency) },
            { title: '状态', width: 90, render: (_, rule) => rule.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag> },
            { title: '更新时间', width: 170, render: (_, rule) => formatTime(rule.updated_at) },
            {
              title: '操作',
              width: 90,
              render: (_, rule) => (
                <Button size="small" onClick={() => openEditPriceRule(rule)}>编辑</Button>
              ),
            },
          ]}
        />
      </Card>

      <Card title="最近 Token 事件">
        <Table
          rowKey="event_id"
          data={billing.events}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '事件',
              width: 220,
              render: (_, event) => (
                <Typography.Text className="admin-mono-id" title={event.event_id}>
                  {compactId(event.event_id, 18, 8)}
                </Typography.Text>
              ),
            },
            { title: '用户', width: 110, render: (_, event) => event.username || '-' },
            { title: '阶段', width: 130, render: (_, event) => event.phase || '-' },
            { title: 'Provider', width: 120, render: (_, event) => event.provider || '-' },
            { title: '模型', width: 180, render: (_, event) => event.model || event.endpoint_id || '-' },
            { title: '输入', width: 110, render: (_, event) => formatNumber(event.prompt_tokens) },
            { title: '输出', width: 110, render: (_, event) => formatNumber(event.completion_tokens) },
            { title: '总 Tokens', width: 120, render: (_, event) => formatNumber(event.total_tokens) },
            { title: '时间', width: 170, render: (_, event) => formatTime(event.created_at) },
          ]}
        />
      </Card>

      <Modal
        title={editingRule ? '编辑价格规则' : '新建价格规则'}
        visible={priceRuleVisible}
        onOk={savePriceRule}
        onCancel={() => setPriceRuleVisible(false)}
        style={{ width: 720 }}
      >
        <Form form={form} layout="vertical">
          <FormItem label="规则编码" field="code">
            <Input placeholder="留空时自动生成" />
          </FormItem>
          <div className="admin-form-grid">
            <FormItem label="Provider" field="provider" rules={[{ required: true }]}>
              <Input />
            </FormItem>
            <FormItem label="币种" field="currency" rules={[{ required: true }]}>
              <Input />
            </FormItem>
          </div>
          <FormItem label="Endpoint ID" field="endpoint_id">
            <Input placeholder="为空表示匹配全部 endpoint" />
          </FormItem>
          <FormItem label="模型" field="model">
            <Input placeholder="为空表示匹配全部模型" />
          </FormItem>
          <FormItem label="阶段" field="phase">
            <Input placeholder="为空表示全部阶段" />
          </FormItem>
          <div className="admin-form-grid">
            <FormItem label="输入单价" field="input_price_per_1m_tokens">
              <Input type="number" />
            </FormItem>
            <FormItem label="输出单价" field="output_price_per_1m_tokens">
              <Input type="number" />
            </FormItem>
            <FormItem label="缓存输入单价" field="cached_input_price_per_1m_tokens">
              <Input type="number" />
            </FormItem>
            <FormItem label="推理单价" field="reasoning_price_per_1m_tokens">
              <Input type="number" />
            </FormItem>
          </div>
          <FormItem label="启用" field="enabled" triggerPropName="checked">
            <Checkbox />
          </FormItem>
        </Form>
      </Modal>
    </Space>
  );
};

const AuditPanel = ({
  logs,
  onSearch,
}: {
  logs: AuditLog[];
  onSearch: (params: Record<string, string>) => Promise<void>;
}) => {
  const [filters, setFilters] = useState({
    action: '',
    actor_username: '',
    resource_type: '',
  });
  const [detail, setDetail] = useState<AuditLog | null>(null);

  return (
    <Card title="审计日志">
      <Space className="admin-filter-bar" wrap>
        <Input
          placeholder="动作"
          value={filters.action}
          onChange={value => setFilters({ ...filters, action: value })}
          style={{ width: 180 }}
        />
        <Input
          placeholder="操作者"
          value={filters.actor_username}
          onChange={value => setFilters({ ...filters, actor_username: value })}
          style={{ width: 160 }}
        />
        <Select
          allowClear
          placeholder="资源类型"
          value={filters.resource_type || undefined}
          onChange={value => setFilters({ ...filters, resource_type: value || '' })}
          style={{ width: 150 }}
        >
          {['auth', 'user', 'role', 'project', 'asset'].map(type => (
            <Select.Option key={type} value={type}>{type}</Select.Option>
          ))}
        </Select>
        <Button type="primary" onClick={() => onSearch(filters)}>筛选</Button>
        <Button
          onClick={() => {
            const nextFilters = { action: '', actor_username: '', resource_type: '' };
            setFilters(nextFilters);
            onSearch(nextFilters);
          }}
        >
          重置
        </Button>
      </Space>
      <Table
        rowKey="id"
        data={logs}
        pagination={{ pageSize: 12 }}
        columns={[
          { title: '时间', render: (_, log) => formatTime(log.created_at) },
          { title: '操作者', dataIndex: 'actor_username' },
          { title: '动作', dataIndex: 'action' },
          { title: '资源', render: (_, log) => `${log.resource_type}:${log.resource_id || '-'}` },
          { title: 'IP', dataIndex: 'ip' },
          {
            title: '操作',
            render: (_, log) => (
              <Button size="small" onClick={() => setDetail(log)}>详情</Button>
            ),
          },
        ]}
      />
      <Modal
        title="审计详情"
        visible={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={null}
        style={{ width: 820 }}
      >
        {detail && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions
              column={1}
              data={[
                { label: '时间', value: formatTime(detail.created_at) },
                { label: '操作者', value: detail.actor_username || '-' },
                { label: '动作', value: detail.action },
                { label: '资源', value: `${detail.resource_type}:${detail.resource_id || '-'}` },
                { label: 'IP', value: detail.ip || '-' },
                { label: 'User-Agent', value: detail.user_agent || '-' },
              ]}
            />
            <Typography.Text bold>Before</Typography.Text>
            <pre className="admin-json-view">{detail.before_json || '{}'}</pre>
            <Typography.Text bold>After</Typography.Text>
            <pre className="admin-json-view">{detail.after_json || '{}'}</pre>
          </Space>
        )}
      </Modal>
    </Card>
  );
};

const SystemPanel = ({ status }: { status: Record<string, any> | null }) => {
  const warnings: string[] = status?.security?.warnings || [];
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {warnings.length > 0 && (
        <Alert
          type="warning"
          title="安全检查"
          content={warnings.join(' ')}
          showIcon
        />
      )}
      <Card title="系统状态">
        {status ? (
          <Descriptions
            column={1}
            data={[
              { label: '服务状态', value: status.status },
              { label: '后端地址', value: status.backend?.base_url },
              { label: '资产目录', value: status.backend?.asset_root },
              { label: '数据库', value: status.backend?.database_path },
              { label: 'Python', value: status.backend?.python },
              { label: '启动时间', value: formatTime(status.backend?.started_at) },
              { label: 'LLM', value: status.config?.llm_endpoint_id ? '已配置' : '未配置' },
              { label: 'TOS', value: status.config?.tos ? '已配置' : '未配置' },
              { label: 'TTS', value: status.config?.tts ? '已配置' : '未配置' },
            ]}
          />
        ) : (
          <Typography.Text type="secondary">暂无状态数据</Typography.Text>
        )}
      </Card>
      <Card title="安全状态">
        {status ? (
          <Descriptions
            column={1}
            data={[
              {
                label: '默认管理员密码',
                value: status.security?.default_admin_password_active
                  ? <Tag color="orange">仍可登录</Tag>
                  : <Tag color="green">已修改</Tag>,
              },
              {
                label: 'Token 密钥',
                value: status.security?.default_token_secret
                  ? <Tag color="orange">开发默认值</Tag>
                  : <Tag color="green">已配置</Tag>,
              },
            ]}
          />
        ) : (
          <Typography.Text type="secondary">暂无安全状态</Typography.Text>
        )}
      </Card>
    </Space>
  );
};

export default function AdminConsole() {
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationState>({
    tenants: [],
    workspaces: [],
  });
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [taskFilters, setTaskFilters] = useState<Record<string, string>>({});
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [billing, setBilling] = useState<BillingState>({
    summary: null,
    projects: [],
    tasks: [],
    events: [],
    priceRules: [],
  });
  const [projectFocusId, setProjectFocusId] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [systemStatus, setSystemStatus] = useState<Record<string, any> | null>(null);
  const [loadWarning, setLoadWarning] = useState('');
  const [passwordForm] = Form.useForm();

  const reload = async () => {
    const [
      userResult,
      roleResult,
      permissionResult,
      tenantResult,
      workspaceResult,
      projectResult,
      taskResult,
      dashboardResult,
      billingSummaryResult,
      billingProjectResult,
      billingTaskResult,
      billingEventResult,
      billingPriceRuleResult,
      logResult,
      statusResult,
    ] = await Promise.all([
      loadOptional(() => listAdminUsers({ silent: true }), { users: [] }, 'users'),
      loadOptional(() => listAdminRoles({ silent: true }), { roles: [] }, 'roles'),
      loadOptional(() => listAdminPermissions({ silent: true }), { permissions: [] }, 'permissions'),
      loadOptional(() => listTenants({ silent: true }), { tenants: [] }, 'tenants'),
      loadOptional(() => listWorkspaces('', { silent: true }), { workspaces: [] }, 'workspaces'),
      loadOptional(() => listAdminProjects({ silent: true }), { asset_root: '', projects: [] }, 'projects'),
      loadOptional(() => listAdminTasks(taskFilters, { silent: true }), { tasks: [] }, 'tasks'),
      loadOptional<AdminDashboard | null>(() => getAdminDashboard({ silent: true }), null, 'dashboard'),
      loadOptional<BillingSummary | null>(() => getBillingSummary({ silent: true }), null, 'billing summary'),
      loadOptional(() => listBillingProjects(100, { silent: true }), { projects: [] }, 'billing projects'),
      loadOptional(() => listBillingTasks({ limit: 100 }, { silent: true }), { tasks: [] }, 'billing tasks'),
      loadOptional(() => listBillingUsageEvents({ limit: 100 }, { silent: true }), { events: [] }, 'billing events'),
      loadOptional(() => listBillingPriceRules({ silent: true }), { rules: [] }, 'billing price rules'),
      loadOptional(() => listAuditLogs({}, { silent: true }), { logs: [] }, 'audit logs'),
      loadOptional<Record<string, any> | null>(() => getSystemStatus({ silent: true }), null, 'system status'),
    ]);
    const missingOrganizationApi =
      tenantResult.tenants.length === 0 && workspaceResult.workspaces.length === 0;
    setLoadWarning(
      missingOrganizationApi
        ? '部分后台接口暂不可用，请确认后端已重启到最新版本。'
        : '',
    );
    setUsers(userResult.users);
    setRoles(roleResult.roles);
    setPermissions(permissionResult.permissions);
    setOrganizations({
      tenants: tenantResult.tenants,
      workspaces: workspaceResult.workspaces,
    });
    setProjects(projectResult.projects);
    setTasks(taskResult.tasks);
    setDashboard(dashboardResult);
    setBilling({
      summary: billingSummaryResult,
      projects: billingProjectResult.projects,
      tasks: billingTaskResult.tasks,
      events: billingEventResult.events,
      priceRules: billingPriceRuleResult.rules,
    });
    setLogs(logResult.logs);
    setSystemStatus(statusResult);
  };

  const reloadBilling = async () => {
    const [
      summaryResult,
      projectResult,
      taskResult,
      eventResult,
      priceRuleResult,
    ] = await Promise.all([
      getBillingSummary(),
      listBillingProjects(),
      listBillingTasks({ limit: 100 }),
      listBillingUsageEvents({ limit: 100 }),
      listBillingPriceRules(),
    ]);
    setBilling({
      summary: summaryResult,
      projects: projectResult.projects,
      tasks: taskResult.tasks,
      events: eventResult.events,
      priceRules: priceRuleResult.rules,
    });
  };

  const searchAuditLogs = async (params: Record<string, string>) => {
    const result = await listAuditLogs(params);
    setLogs(result.logs);
  };

  const searchTasks = async (params: Record<string, string>) => {
    setTaskFilters(params);
    const result = await listAdminTasks(params);
    setTasks(result.tasks);
  };

  const openTasks = (filters: Record<string, string> = {}) => {
    setView('tasks');
    searchTasks(filters);
  };

  const openProject = (projectId: string) => {
    setProjectFocusId(projectId);
    setView('projects');
  };

  useEffect(() => {
    getAdminMe()
      .then(async result => {
        setCurrentUser(result.user);
        await reload();
      })
      .catch(() => setCurrentUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="admin-loading"><Spin /></div>;
  }

  if (!currentUser) {
    return <LoginView onLoggedIn={async user => {
      setCurrentUser(user);
      await reload();
    }} />;
  }

  const menuItems = [
    { key: 'dashboard', label: '概览', icon: <IconDashboard /> },
    { key: 'users', label: '用户', icon: <IconUser /> },
    { key: 'roles', label: '角色权限', icon: <IconSafe /> },
    { key: 'organizations', label: '组织', icon: <IconApps /> },
    { key: 'projects', label: '项目资产', icon: <IconFile /> },
    { key: 'tasks', label: '任务', icon: <IconRefresh /> },
    { key: 'billing', label: '计费', icon: <IconFile /> },
    { key: 'audit', label: '审计', icon: <IconLock /> },
    { key: 'system', label: '系统', icon: <IconSettings /> },
  ];

  const submitPasswordChange = async () => {
    const values = await passwordForm.validate();
    if (values.new_password !== values.confirm_password) {
      Message.warning('两次输入的新密码不一致');
      return;
    }
    await changeAdminPassword(values.old_password, values.new_password);
    Message.success('密码已修改');
    setPasswordModalVisible(false);
    passwordForm.resetFields();
    await reload();
  };

  const openWorkbench = async () => {
    const desktopAPI = getDesktopAPI();
    if (desktopAPI?.focusMainWindow) {
      await desktopAPI.focusMainWindow();
      return;
    }
    window.location.href = '/';
  };

  return (
    <Layout className="admin-console">
      <Sider className="admin-sider" width={220}>
        <div className="admin-brand">
          <IconApps />
          <span>后台管理</span>
        </div>
        <Menu selectedKeys={[view]} onClickMenuItem={key => setView(key as ViewKey)}>
          {menuItems.map(item => (
            <Menu.Item key={item.key}>
              {item.icon}
              <span className="admin-menu-label">{item.label}</span>
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div>
            <Typography.Text bold>{currentUser.display_name}</Typography.Text>
            <Typography.Text type="secondary" className="admin-header-subtitle">
              {currentUser.username}
            </Typography.Text>
          </div>
          <Space>
            <Button onClick={openWorkbench}>主工作台</Button>
            <Button icon={<IconRefresh />} onClick={reload}>刷新</Button>
            <Button onClick={() => setPasswordModalVisible(true)}>修改密码</Button>
            <Button
              onClick={async () => {
                await adminLogout();
                setCurrentUser(null);
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content className="admin-content">
          {loadWarning && (
            <Alert
              type="warning"
              showIcon
              content={loadWarning}
              style={{ marginBottom: 16 }}
            />
          )}
          {view === 'dashboard' && (
            <DashboardPanel
              dashboard={dashboard}
              onOpenTasks={openTasks}
              onOpenProject={openProject}
            />
          )}
          {view === 'users' && (
            <UsersPanel
              users={users}
              roles={roles}
              tenants={organizations.tenants}
              workspaces={organizations.workspaces}
              reload={reload}
            />
          )}
          {view === 'roles' && (
            <RolesPanel roles={roles} permissions={permissions} reload={reload} />
          )}
          {view === 'organizations' && (
            <OrganizationPanel organizations={organizations} reload={reload} />
          )}
          {view === 'projects' && (
            <ProjectsPanel
              projects={projects}
              users={users}
              reload={reload}
              initialProjectId={projectFocusId}
              onOpenTasks={openTasks}
            />
          )}
          {view === 'tasks' && (
            <TasksPanel
              tasks={tasks}
              filters={taskFilters}
              onSearch={searchTasks}
              onOpenProject={openProject}
            />
          )}
          {view === 'billing' && (
            <BillingPanel
              billing={billing}
              reloadBilling={reloadBilling}
              onOpenProject={openProject}
              onOpenTasks={openTasks}
            />
          )}
          {view === 'audit' && <AuditPanel logs={logs} onSearch={searchAuditLogs} />}
          {view === 'system' && <SystemPanel status={systemStatus} />}
        </Content>
      </Layout>
      <Modal
        title="修改密码"
        visible={passwordModalVisible}
        onOk={submitPasswordChange}
        onCancel={() => setPasswordModalVisible(false)}
      >
        <Form form={passwordForm} layout="vertical">
          <FormItem
            label="当前密码"
            field="old_password"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </FormItem>
          <FormItem
            label="新密码"
            field="new_password"
            rules={[{ required: true, minLength: 8, message: '新密码至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </FormItem>
          <FormItem
            label="确认新密码"
            field="confirm_password"
            rules={[{ required: true, message: '请再次输入新密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </FormItem>
        </Form>
      </Modal>
    </Layout>
  );
}
