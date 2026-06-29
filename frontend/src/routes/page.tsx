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

const Index = () => {
  const storeKey =
    localStorage.getItem('ark-interactive-video-store-key') || uuidV4();
  const [backendOrigin, setBackendOrigin] = useState(() => getBackendOrigin());
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
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
    getAdminMe()
      .then(result => setCurrentUser(result.user))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

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
