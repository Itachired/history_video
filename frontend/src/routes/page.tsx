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
import { getBackendOrigin, getDesktopAPI } from '@/utils/desktopRuntime';
import { Helmet } from '@modern-js/runtime/head';
import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidV4 } from 'uuid';

import './index.css';

const Index = () => {
  const storeKey =
    localStorage.getItem('ark-interactive-video-store-key') || uuidV4();
  const [backendOrigin, setBackendOrigin] = useState(() => getBackendOrigin());
  const botCompletionUrl = useMemo(
    () => `${backendOrigin}/api/v3/bots/chat/completions`,
    [backendOrigin],
  );

  useEffect(() => {
    localStorage.setItem('ark-interactive-video-store-key', storeKey);
  }, [storeKey]);

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
