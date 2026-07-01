// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// Licensed under the 【火山方舟】原型应用软件自用许可协议
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     https://www.volcengine.com/docs/82379/1433703
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import VideoGenerator from '@/module/VideoGenerator';
import { GetVideoGenTask } from '@/services/getVideoGenTask';
import { adminLogin, getAdminMe } from '@/services/admin/api';
import { getAdminAuthHeaders } from '@/services/admin/authHeaders';
import type { AdminUser } from '@/services/admin/types';
import { getBackendOrigin, getDesktopAPI } from '@/utils/desktopRuntime';
import { Button, Form, Input, Message, Spin, Typography } from '@arco-design/web-react';
import { Helmet } from '@modern-js/runtime/head';
import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidV4 } from 'uuid';

import './index.css';

const createEmptyDesktopConfig = (): DesktopConfig => ({
  runtime: {
    assetRoot: '',
    backendPort: 8889,
  },
  volcengine: {
    apiKey: '',
    llmEndpointId: '',
    imageEndpointId: '',
    videoEndpointId: '',
    tosAccessKey: '',
    tosSecretKey: '',
    tosBucket: '',
    ttsAccessKey: '',
    ttsAppKey: '',
    ttsApiResourceId: 'volc.service_type.10029',
    ttsBaseUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    ttsNamespace: 'BidirectionalTTS',
    ttsSpeaker: 'zh_female_xiaohe_uranus_bigtts',
  },
});

const CONFIG_FIELD_LABELS: Record<string, string> = {
  'volcengine.apiKey': '火山方舟 API Key',
  'volcengine.llmEndpointId': '文案/分镜模型 Endpoint ID',
  'volcengine.imageEndpointId': '图片生成模型 Endpoint ID',
  'volcengine.videoEndpointId': '视频生成模型 Endpoint ID',
  'volcengine.tosAccessKey': 'TOS Access Key',
  'volcengine.tosSecretKey': 'TOS Secret Key',
  'volcengine.tosBucket': 'TOS Bucket',
};

const isDesktopConfigReady = (config?: DesktopConfig | null) =>
  Boolean(config?.status?.configured);

const getDesktopConfigAPI = () => {
  const desktopAPI = getDesktopAPI();
  if (!desktopAPI?.getConfig || !desktopAPI?.saveConfigAndRestart) {
    return undefined;
  }
  return desktopAPI;
};

const Index = () => {
  const storeKey =
    localStorage.getItem('ark-interactive-video-store-key') || uuidV4();
  const [backendOrigin, setBackendOrigin] = useState(() => getBackendOrigin());
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const hasDesktopRuntime = Boolean(getDesktopAPI());
  const hasDesktopConfigAPI = Boolean(getDesktopConfigAPI());
  const [authLoading, setAuthLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(() => hasDesktopConfigAPI);
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configTestResult, setConfigTestResult] =
    useState<DesktopConfigTestResult | null>(null);
  const [configVisible, setConfigVisible] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const botCompletionUrl = useMemo(
    () => `${backendOrigin}/api/v3/bots/chat/completions`,
    [backendOrigin],
  );
  const orgContext = useMemo(
    () => ({
      tenantId: currentUser?.default_tenant_id || currentUser?.default_tenant?.tenant_id || '',
      workspaceId: currentUser?.default_workspace_id || currentUser?.default_workspace?.workspace_id || '',
    }),
    [currentUser],
  );

  useEffect(() => {
    localStorage.setItem('ark-interactive-video-store-key', storeKey);
  }, [storeKey]);

  useEffect(() => {
    const desktopAPI = getDesktopConfigAPI();
    if (!desktopAPI) {
      setConfigLoading(false);
      if (hasDesktopRuntime) {
        Message.warning('客户端运行时已更新，请重启 Electron 后使用配置页');
      }
      return;
    }
    desktopAPI
      .getConfig()
      .then(config => {
        setDesktopConfig(config);
        setConfigVisible(!isDesktopConfigReady(config));
      })
      .catch(error => {
        Message.error(error instanceof Error ? error.message : '读取本地配置失败');
        setDesktopConfig(createEmptyDesktopConfig());
      })
      .finally(() => setConfigLoading(false));
  }, [hasDesktopRuntime]);

  useEffect(() => {
    if (hasDesktopConfigAPI && configLoading) {
      return;
    }
    if (hasDesktopConfigAPI && !isDesktopConfigReady(desktopConfig)) {
      setCurrentUser(null);
      setAuthLoading(false);
      return;
    }
    getAdminMe()
      .then(result => setCurrentUser(result.user))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthLoading(false));
  }, [configLoading, desktopConfig, hasDesktopConfigAPI]);

  useEffect(() => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      return undefined;
    }
    return desktopAPI.onBackendStatusChanged(status => {
      if (status.backendOrigin) {
        setBackendOrigin(status.backendOrigin.replace(/\/+$/, ''));
      }
    });
  }, []);

  const patchDesktopConfig = (patch: Partial<DesktopConfig>) => {
    setDesktopConfig(current => ({
      ...createEmptyDesktopConfig(),
      ...(current || {}),
      ...patch,
      runtime: {
        ...createEmptyDesktopConfig().runtime,
        ...(current?.runtime || {}),
        ...(patch.runtime || {}),
      },
      volcengine: {
        ...createEmptyDesktopConfig().volcengine,
        ...(current?.volcengine || {}),
        ...(patch.volcengine || {}),
      },
    }));
  };

  const handleSelectAssetRoot = async () => {
    const desktopAPI = getDesktopConfigAPI();
    if (!desktopAPI) {
      Message.warning('请重启 Electron 后再选择素材目录');
      return;
    }
    const assetRoot = await desktopAPI.selectAssetRoot();
    if (assetRoot) {
      patchDesktopConfig({
        runtime: {
          ...(desktopConfig?.runtime || createEmptyDesktopConfig().runtime),
          assetRoot,
        },
      });
    }
  };

  const handleTestConfig = async () => {
    const desktopAPI = getDesktopConfigAPI();
    if (!desktopAPI || !desktopConfig) {
      Message.warning('请重启 Electron 后再检查配置');
      return;
    }
    setConfigSaving(true);
    try {
      const result = await desktopAPI.testConfig(desktopConfig);
      setConfigTestResult(result);
      if (result.configured) {
        Message.success('必填配置已完整');
      } else {
        Message.warning('还有必填配置未填写');
      }
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    const desktopAPI = getDesktopConfigAPI();
    if (!desktopAPI || !desktopConfig) {
      Message.warning('请重启 Electron 后再保存配置');
      return;
    }
    setConfigSaving(true);
    try {
      const result = await desktopAPI.saveConfigAndRestart(desktopConfig);
      setDesktopConfig(result.config);
      if (result.backend.backendOrigin) {
        setBackendOrigin(result.backend.backendOrigin.replace(/\/+$/, ''));
      }
      setConfigVisible(!isDesktopConfigReady(result.config));
      Message.success('配置已保存，后端已重启');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim()) {
      Message.warning('请输入用户名');
      return;
    }
    if (!password) {
      Message.warning('请输入密码');
      return;
    }
    setLoginLoading(true);
    try {
      const result = await adminLogin(username.trim(), password);
      setCurrentUser(result.user);
      Message.success('登录成功');
    } finally {
      setLoginLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="app-auth-loading">
        <Spin />
      </div>
    );
  }

  const renderDesktopConfigPage = () => {
    const missing = desktopConfig?.status?.missing || [];
    const config = desktopConfig || createEmptyDesktopConfig();
    return (
      <div className="app-config-page">
        <div className="app-config-panel">
          <div className="app-config-header">
            <div>
              <Typography.Title heading={3}>配置火山引擎账号</Typography.Title>
              <Typography.Text type="secondary">
                首次使用需要填写你自己的火山方舟模型、TOS 存储和可选配音配置。配置只保存在本机。
              </Typography.Text>
            </div>
            {missing.length ? (
              <div className="app-config-warning">
                缺少：{missing.map(item => CONFIG_FIELD_LABELS[item] || item).join('、')}
              </div>
            ) : null}
          </div>
          <Form layout="vertical" className="app-config-form">
            <div className="app-config-section">
              <div className="app-config-section-title">火山方舟模型</div>
              <Form.Item label="火山方舟 API Key" required>
                <Input.Password
                  value={config.volcengine.apiKey}
                  onChange={value =>
                    patchDesktopConfig({
                      volcengine: { ...config.volcengine, apiKey: value },
                    })
                  }
                />
              </Form.Item>
              <div className="app-config-grid">
                <Form.Item label="文案/分镜模型 Endpoint ID" required>
                  <Input
                    value={config.volcengine.llmEndpointId}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          llmEndpointId: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="图片生成模型 Endpoint ID" required>
                  <Input
                    value={config.volcengine.imageEndpointId}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          imageEndpointId: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="视频生成模型 Endpoint ID" required>
                  <Input
                    value={config.volcengine.videoEndpointId}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          videoEndpointId: value,
                        },
                      })
                    }
                  />
                </Form.Item>
              </div>
            </div>
            <div className="app-config-section">
              <div className="app-config-section-title">TOS 对象存储</div>
              <div className="app-config-grid">
                <Form.Item label="TOS Access Key" required>
                  <Input.Password
                    value={config.volcengine.tosAccessKey}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          tosAccessKey: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="TOS Secret Key" required>
                  <Input.Password
                    value={config.volcengine.tosSecretKey}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          tosSecretKey: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="TOS Bucket" required>
                  <Input
                    value={config.volcengine.tosBucket}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          tosBucket: value,
                        },
                      })
                    }
                  />
                </Form.Item>
              </div>
            </div>
            <div className="app-config-section">
              <div className="app-config-section-title">配音，可稍后填写</div>
              <div className="app-config-grid">
                <Form.Item label="TTS Access Key">
                  <Input.Password
                    value={config.volcengine.ttsAccessKey}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          ttsAccessKey: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="TTS App Key">
                  <Input.Password
                    value={config.volcengine.ttsAppKey}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          ttsAppKey: value,
                        },
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="默认音色">
                  <Input
                    value={config.volcengine.ttsSpeaker}
                    onChange={value =>
                      patchDesktopConfig({
                        volcengine: {
                          ...config.volcengine,
                          ttsSpeaker: value,
                        },
                      })
                    }
                  />
                </Form.Item>
              </div>
            </div>
            <div className="app-config-section">
              <div className="app-config-section-title">本地存储</div>
              <Form.Item label="素材目录">
                <Input
                  value={config.runtime.assetRoot}
                  addAfter={<Button onClick={handleSelectAssetRoot}>选择</Button>}
                  onChange={value =>
                    patchDesktopConfig({
                      runtime: {
                        ...config.runtime,
                        assetRoot: value,
                      },
                    })
                  }
                />
              </Form.Item>
            </div>
          </Form>
          {configTestResult ? (
            <div className="app-config-result">
              {configTestResult.configured
                ? '必填配置完整。保存后客户端会重启本地后端并注入这些配置。'
                : `仍缺少：${configTestResult.missing
                    .map(item => CONFIG_FIELD_LABELS[item] || item)
                    .join('、')}`}
            </div>
          ) : null}
          <div className="app-config-actions">
            <Button loading={configSaving} onClick={handleTestConfig}>
              检查必填项
            </Button>
            <Button
              type="primary"
              loading={configSaving}
              disabled={!desktopConfig}
              onClick={handleSaveConfig}
            >
              保存配置并重启后端
            </Button>
          </div>
        </div>
      </div>
    );
  };

  if (hasDesktopConfigAPI && !configLoading && configVisible) {
    return renderDesktopConfigPage();
  }

  if (!currentUser) {
    return (
      <div className="app-login-page">
        <div className="app-login-panel">
          <div>
            <Typography.Title heading={3}>历史视频生成工具</Typography.Title>
            <Typography.Text type="secondary">
              请使用管理员分配的账号登录后创建项目和生成素材。
            </Typography.Text>
          </div>
          <Form layout="vertical">
            <Form.Item label="用户名">
              <Input
                autoComplete="username"
                value={username}
                onChange={setUsername}
                onPressEnter={handleLogin}
              />
            </Form.Item>
            <Form.Item label="密码">
              <Input.Password
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                onPressEnter={handleLogin}
              />
            </Form.Item>
            <Button long type="primary" loading={loginLoading} onClick={handleLogin}>
              登录
            </Button>
            {hasDesktopConfigAPI ? (
              <Button long onClick={() => setConfigVisible(true)}>
                编辑火山配置
              </Button>
            ) : null}
          </Form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Helmet>
        <link
          rel="icon"
          type="image/x-icon"
          href="https://lf3-static.bytednsdoc.com/obj/eden-cn/uhbfnupenuhf/favicon.ico"
        />
      </Helmet>
      <main>
        <div className="interactive-video" style={{ height: '100vh' }}>
          <VideoGenerator
            assistantInfo={{
              Name: '历史知识视频生成器',
              Description:
                '这是一款面向历史与知识类内容创作的视频生成工具。它支持上传现成文案，配置科普视觉风格、背景参考图、分镜画面和配音方式，辅助完成从文案到成片的视频生产流程。',
              OpeningRemarks: {
                OpeningRemark:
                  '上传一段现成文案，或输入一个历史/知识主题，系统会协助生成分镜脚本、角色设定、分镜画面、视频片段和成片。',
                OpeningQuestions: [
                  '制作一条法国大革命科普视频',
                  '讲清楚唐代牛李党争的来龙去脉',
                  '用博物馆展陈风格讲一个历史知识点',
                ],
              },
            }}
            botUrl={botCompletionUrl}
            botChatUrl={botCompletionUrl}
            requestHeaders={getAdminAuthHeaders(orgContext)}
            orgContext={orgContext}
            storeUniqueId={storeKey}
            api={{
              GetVideoGenTask: GetVideoGenTask,
            }}
            slots={{}}
          />
        </div>
      </main>
    </div>
  );
};

export default Index;
