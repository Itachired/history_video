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

import { useEffect, useRef, useState } from 'react';

import cx from 'classnames';
import { Progress } from '@arco-design/web-react';


import iconVideoFailed from '@/images/assets/icon_video_failed.png';
import usePageVisibility from '@/hooks/usePageVisibility';
import { Phase } from '@/types/video_gen_task';

import { ResultType, useRefetchRunningTask } from '../../../../hooks/useRefetchRunningTask';
import VideoPlayer from '../VideoPlayer';
import styles from './index.module.less';
import { ErrorString } from '../../../../types';

const VideoBlock = ({
  id,
  setVideoLink,
  videoLink,
  afterLoad,
  afterTerminal,
  onTaskUpdate,
  projectId,
  taskIndex,
  audioImg,
}: {
  id: string;
  setVideoLink: (value: string) => void;
  videoLink?: string;
  afterLoad?: () => void;
  afterTerminal?: (success: boolean) => void;
  onTaskUpdate?: (task: ResultType) => void;
  projectId?: string;
  taskIndex?: number;
  audioImg?: string;
}) => {
  const [video, setVideo] = useState<ResultType>();
  const { run } = useRefetchRunningTask(setVideo);
  const terminalNotifiedRef = useRef(false);
  const callbacksRef = useRef({
    afterLoad,
    afterTerminal,
    onTaskUpdate,
    setVideoLink,
  });

  useEffect(() => {
    callbacksRef.current = {
      afterLoad,
      afterTerminal,
      onTaskUpdate,
      setVideoLink,
    };
  }, [afterLoad, afterTerminal, onTaskUpdate, setVideoLink]);

  useEffect(() => {
    terminalNotifiedRef.current = false;
    setVideo(undefined);
    callbacksRef.current.setVideoLink('');
    if (id && id !== ErrorString.VideoError) {
      run(id, { ProjectId: projectId, Index: taskIndex });
    }
  }, [id, projectId, run, taskIndex]);

  usePageVisibility(() => {
    if (id && id !== ErrorString.VideoError) {
      run(id, { ProjectId: projectId, Index: taskIndex });
    }
  });

  useEffect(() => {
    if (video) {
      callbacksRef.current.onTaskUpdate?.(video);
    }

    if (!id || terminalNotifiedRef.current) {
      return;
    }

    if (id === ErrorString.VideoError) {
      terminalNotifiedRef.current = true;
      callbacksRef.current.afterTerminal?.(false);
      return;
    }

    if (video?.status === Phase.PhaseCompleted) {
      callbacksRef.current.setVideoLink(video.content?.video_url || '');
      if (video.content?.video_url) {
        terminalNotifiedRef.current = true;
        callbacksRef.current.afterLoad?.();
        callbacksRef.current.afterTerminal?.(true);
      }
      return;
    }

    if (video?.status === Phase.PhaseFailed || video?.Error) {
      terminalNotifiedRef.current = true;
      callbacksRef.current.afterTerminal?.(false);
    }
  }, [id, video]);

  // 固定阶段返回值映射
  const fixedPercentages: Record<string, number> = {
    [Phase.PhaseFailed]: 0,
    [Phase.PhaseQueuing]: 10,
    [Phase.PhaseRunning]: 50,
  };

  const getVideoGenPercent = (video: ResultType) => {
    const { status } = video;
    if (!status) {
      return 0;
    }
    if (status in fixedPercentages) {
      return fixedPercentages[status];
    }

    return 99;
  };

  const renderVideo = () => {
    if (id === ErrorString.VideoError || video?.status === Phase.PhaseFailed || video?.Error) {
      return (
        <div className={styles.failed}>
          <img src={iconVideoFailed} style={{ width: 76, height: 76 }} />
          <div className={styles.failedText}>{'视频生成失败'}</div>
        </div>
      );
    }
    if (video?.status === Phase.PhaseCompleted) {
      return <VideoPlayer videoLink={videoLink} />;
    }
    if (![Phase.PhaseCompleted, Phase.PhaseFailed].includes(video?.status as Phase)) {
      return (
        <div className={styles.videoWrapper}>
          <div className={styles.loading}>
            <img src={audioImg} className={styles.loadingImg} />
            {video?.id ? (
              <div
                className={cx(styles.loadingMask, {
                  [styles.loadingMaskSpc]: !audioImg,
                })}
              >
                <Progress
                  percent={getVideoGenPercent(video)}
                  color={{
                    '0%': '#ce63ff',
                    '40%': '#0093ff',
                  }}
                  style={{ marginBottom: 20 }}
                  type="circle"
                  className={styles.videoProgress}
                  formatText={percent => (
                    <div
                      className={cx(styles.progressText)}
                    >{`${percent}%`}</div>
                  )}
                />
                <div
                  className={cx(styles.loadingText)}
                >
                  {video?.status === Phase.PhaseQueuing && '排队中，'}
                  {'退出后AI会继续生成'}
                </div>
              </div>
            ) : (
              <div
                className={cx(styles.loadingMask, {
                  [styles.loadingMaskSpc]: !audioImg,
                })}
              >
                <Progress
                  percent={0}
                  color={{
                    '0%': '#ce63ff',
                    '40%': '#0093ff',
                  }}
                  style={{ marginBottom: 20 }}
                  type="circle"
                  className={styles.videoProgress}
                  formatText={percent => <div className={styles.progressText}>{`${percent}%`}</div>}
                />
                <div className={cx(styles.loadingText, styles.loadingTextSpc)}>{'等待提交生成任务'}</div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return renderVideo();
};

export default VideoBlock;
