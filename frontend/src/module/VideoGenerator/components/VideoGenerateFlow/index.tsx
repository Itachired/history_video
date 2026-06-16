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

/* eslint-disable max-nested-callbacks */
import { useContext, useEffect, useRef, useState } from 'react';

import { cloneDeep, isUndefined } from 'lodash';
import clsx from 'classnames';
import { Button, Message, Modal, Popover, Radio } from '@arco-design/web-react';
import { IconDownload, IconUpload } from '@arco-design/web-react/icon';

import { ReactComponent as IconAiPlay } from '@/images/icon_ai_play.svg';
import { ReactComponent as IconAiPlayDisabled } from '@/images/icon_ai_play_disabled.svg';
import { ReactComponent as IconAiPause } from '@/images/icon_ai_pause.svg';
import { ReactComponent as IconAiChat } from '@/images/icon_ai_chat.svg';
import { ReactComponent as IconAiReset } from '@/images/icon_ai_reset.svg';
import { useStartChatWithVideo } from '@/module/WatchAndChat/providers/WatchAndChatProvider/hooks/useStartChatWithVideo';
import { ChatWindowContext } from '@/components/ChatWindowV2/context';
import { Assistant } from '@/types/assistant';

import {
  ComplexMessage,
  FlowPhase,
  FlowStatus,
  RunningPhaseStatus,
  UserConfirmationDataKey,
  VideoGeneratorTaskPhase,
  VoiceMode,
} from '../../types';
import { useParseOriginData } from './useParseOriginData';
import { FlowData } from './types';
import BaseFlow, { FlowItem } from '../BaseFlow';
import CardScrollList from '../CardScrollList';
import MediaCard from '../MediaCard';
import MediaCardHeader from '../MediaCard/components/MediaCardHeader';
import { RenderedMessagesContext } from '../../store/RenderedMessages/context';
import ColorfulButton from '../ColorfulButton';
import VideoPlayer, { IVideoPlayerRef } from '../MediaCard/components/VideoPlayer';
import styles from './index.module.less';
import {
  matchFirstFrameDescription,
  matchRoleDescription,
  matchVideoDescription,
  mergedOriginDescriptionsByPhase,
} from '../../utils';
import FlowItemTitle from '../FlowItemTitle';
import LoadingFilm from '../LoadingFilm';
import useFlowPhaseData from './useFlowPhaseData';
import { uploadReferenceImage } from '../../utils/uploadReferenceImage';
import { downloadAsset } from '../../utils/downloadAsset';
import { StoryboardVideoAsset, syncStoryboardVideos } from '../../utils/syncStoryboardVideos';

interface Props {
  messages: ComplexMessage;
}

const FlowPhaseMap = [
  [VideoGeneratorTaskPhase.PhaseRoleDescription, VideoGeneratorTaskPhase.PhaseRoleImage],
  [VideoGeneratorTaskPhase.PhaseFirstFrameDescription, VideoGeneratorTaskPhase.PhaseFirstFrameImage],
  [VideoGeneratorTaskPhase.PhaseVideoDescription, VideoGeneratorTaskPhase.PhaseVideo],
  [VideoGeneratorTaskPhase.PhaseTone, VideoGeneratorTaskPhase.PhaseAudio],
  [VideoGeneratorTaskPhase.PhaseFilm],
];

const VideoGenerateFlow = (props: Props) => {
  const { messages } = props;
  const { assistantInfo } = useContext(ChatWindowContext);
  const assistantData = assistantInfo as Assistant & { Extra?: any };

  // 是否需要提示重新生成
  const [firstFrameDescriptionRegenerateState, setFirstFrameDescriptionRegenerateState] = useState<number>(0);
  const [firstFrameRegenerateState, setFirstFrameRegenerateState] = useState<number>(0);
  const [videoRegenerateState, setVideoRegenerateState] = useState<number>(0);
  const [audioRegenerateState, setAudioRegenerateState] = useState<number>(0);
  const [referenceImageUploading, setReferenceImageUploading] = useState<Record<number, boolean>>({});

  const {
    runningPhase,
    finishPhase,
    userConfirmData,
    autoNext,
    isEditing,
    runningPhaseStatus,
    mediaRelevance,
    flowStatus,
    proceedNextPhase,
    regenerateMessageByPhase,
    sendRegenerationDescription,
    updateConfirmationMessage,
    updateAutoNext,
    resetMessages,
    updateRunningPhaseStatus,
    correctDescription,
    retryFromPhase,
  } = useContext(RenderedMessagesContext);
  const { videoBackgroundImages, audioBackgroundImages, updateVideoBackgroundImages, updateAudioBackgroundImages } =
    mediaRelevance;

  const parsedOriginData = useParseOriginData(messages);
  const {
    roleDescription,
    firstFrameDescription,
    videoDescription,
    resultFilm,
  } = parsedOriginData;

  const {
    generateRolePhaseData,
    generateStoryBoardImageData,
    generateStoryBoardVideoData,
    generateStoryBoardAudioData,
  } = useFlowPhaseData(messages, parsedOriginData, assistantData);

  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);

  const [, setVideoStatus] = useState<number>(0);

  const { startChatWithVideo } = useStartChatWithVideo();

  const finalFilmPlayerRef = useRef<IVideoPlayerRef>(null);

  const hasReadyLocalAsset = (item?: Record<string, any>) =>
    Boolean(item?.local_assets?.some((asset: Record<string, any>) => asset.status === 'ready'));

  const getAssetDownloadUrl = (item?: Record<string, any>, fallbackUrl = '') =>
    item?.local_assets?.find((asset: Record<string, any>) => asset.status === 'ready')?.download_url ||
    item?.download_url ||
    fallbackUrl ||
    item?.images?.[0] ||
    item?.url;

  const getProjectAssetUrl = (phase: 'role_images' | 'storyboard_images' | 'storyboard_videos', index: number) => {
    const projectId = userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.project_id;
    const assetId = `${phase}_${String(index + 1).padStart(2, '0')}`;
    return projectId ? `/v1/assets/projects/${projectId}/files/${assetId}` : '';
  };

  const getProjectArchiveUrl = (phase: 'role_images' | 'storyboard_images' | 'storyboard_videos' | 'film') => {
    const projectId = userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.project_id;
    return projectId ? `/v1/assets/projects/${projectId}/archive/${phase}` : '';
  };

  const getAllAssetsArchiveUrl = () => {
    const projectId = userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.project_id;
    return projectId ? `/v1/assets/projects/${projectId}/archive-all` : '';
  };

  const renderDownloadButton = (url?: string, tooltip = '下载素材', disabled = false) => (
    <Popover content={tooltip}>
      <Button
        size="mini"
        type="text"
        icon={<IconDownload />}
        disabled={disabled || !url}
        onClick={() => downloadAsset(url)}
      />
    </Popover>
  );

  const renderPhaseDownloadButton = (url?: string, tooltip = '下载全部素材', disabled = false) =>
    renderDownloadButton(url, tooltip, disabled);

  useEffect(() => {
    const phaseArr = [
      '',
      FlowPhase.GenerateRole,
      FlowPhase.GenerateStoryBoardImage,
      FlowPhase.GenerateStoryBoardVideo,
      FlowPhase.GenerateStoryBoardAudio,
      FlowPhase.VideoEdit,
      FlowPhase.Result,
    ];
    const phase = phaseArr[currentPhaseIndex];
    const element = document.getElementById(phase);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentPhaseIndex]);

  const modelOperateDisabled = autoNext || runningPhaseStatus === RunningPhaseStatus.Pending;
  const voiceMode = userConfirmData?.[UserConfirmationDataKey.VoiceOptions]?.mode ?? VoiceMode.Generated;
  const isOriginalVoiceMode = voiceMode === VoiceMode.Original;
  const hasGeneratedVideos = Boolean(userConfirmData?.[UserConfirmationDataKey.Videos]?.length);
  const projectId = userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.project_id;

  const handleVoiceModeChange = (mode: VoiceMode) => {
    updateConfirmationMessage({
      [UserConfirmationDataKey.VoiceOptions]: {
        mode,
      },
    });
  };

  const mergeStoryboardVideoAssets = (assets: StoryboardVideoAsset[]) => {
    if (!assets.length) {
      return false;
    }
    const currentVideos = userConfirmData?.[UserConfirmationDataKey.Videos] ?? [];
    const nextVideos = cloneDeep(currentVideos);
    let changed = false;

    assets.forEach(asset => {
      const taskId = asset.video_gen_task_id || asset.metadata?.video_gen_task_id;
      if (!taskId) {
        return;
      }
      const videoIndex = nextVideos.findIndex(item => item.index === asset.index);
      const nextVideo = {
        ...(videoIndex === -1 ? { index: asset.index } : nextVideos[videoIndex]),
        video_gen_task_id: taskId,
        local_assets: [asset],
        download_url: asset.download_url,
        archive_url: projectId ? `/v1/assets/projects/${projectId}/archive/storyboard_videos` : undefined,
      };

      if (videoIndex === -1) {
        nextVideos.push(nextVideo);
        changed = true;
        return;
      }

      const prevVideo = nextVideos[videoIndex];
      const prevAsset = prevVideo?.local_assets?.[0];
      if (
        prevVideo.video_gen_task_id !== nextVideo.video_gen_task_id ||
        prevAsset?.status !== asset.status ||
        prevAsset?.filename !== asset.filename ||
        prevAsset?.message !== asset.message ||
        prevVideo.download_url !== nextVideo.download_url
      ) {
        nextVideos[videoIndex] = nextVideo;
        changed = true;
      }
    });

    if (changed) {
      updateConfirmationMessage({
        [UserConfirmationDataKey.Videos]: nextVideos.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
      });
    }
    return changed;
  };

  const markFirstFrameDescriptionRegenerate = (role: string) => {
    const updateState = generateStoryBoardImageData.reduce((pre, cur, index) => {
      if (cur.role?.includes(role)) {
        return pre | (1 << index);
      }
      return pre;
    }, 0);
    setFirstFrameDescriptionRegenerateState(val => val | updateState);
  };

  const markFirstFrameImageRegenerate = (role: string) => {
    const updateState = generateStoryBoardImageData.reduce((pre, cur, index) => {
      if (cur.role?.includes(role)) {
        return pre | (1 << index);
      }
      return pre;
    }, 0);
    setFirstFrameRegenerateState(val => val | updateState);
    if (generateStoryBoardVideoData.length > 0) {
      setVideoRegenerateState(val => val | updateState);
    }
  };

  const handleUploadRoleReferenceImage = async (roleIndex: number, roleName?: string, file?: File) => {
    if (!file) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      Message.error('仅支持 jpg、png、webp 图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Message.error('参考图不能超过 10MB');
      return;
    }

    setReferenceImageUploading(val => ({ ...val, [roleIndex]: true }));
    try {
      const { url } = await uploadReferenceImage(file);
      const roleImages = userConfirmData?.[UserConfirmationDataKey.RoleImage] || [];
      const cloneArr = cloneDeep(roleImages);
      let imageIndex = cloneArr.findIndex(item => item.index === roleIndex);
      if (imageIndex === -1) {
        cloneArr.push({
          index: roleIndex,
          images: [],
          locked: true,
        });
        imageIndex = cloneArr.length - 1;
      }
      const previousImages = cloneArr[imageIndex].images || [];
      cloneArr[imageIndex] = {
        ...cloneArr[imageIndex],
        images: [url, ...previousImages.filter((item: string) => item !== url)],
        reference_image: url,
        locked: true,
      };
      updateConfirmationMessage({
        [UserConfirmationDataKey.RoleImage]: cloneArr,
      });
      if (roleName && generateStoryBoardImageData.length > 0) {
        markFirstFrameImageRegenerate(roleName);
      }
      Message.success('参考图已上传并锁定');
    } catch {
      Message.error('参考图上传失败');
    } finally {
      setReferenceImageUploading(val => ({ ...val, [roleIndex]: false }));
    }
  };

  const resetConfirm = () => {
    Modal.confirm({
      title: '确认清空对话吗？',
      content:
        '确认清空当前故事及生成的所有图片及音视频素材？删除后记录及素材无法找回，如有需要请先保存。',
      okText: '确认清空',
      closable: true,
      onOk: () => {
        resetMessages();
      },
    });
  };

  const renderOperationBtn = () => {
    if (finishPhase === VideoGeneratorTaskPhase.PhaseFilm && resultFilm.length > 0) {
      // 视频生成结束后的按钮事件
      if (isEditing) {
        return (
          <div className="flex gap-[10px]">
            <Popover
              disabled={flowStatus === FlowStatus.Ready}
              content={
                '当前有相关内容错误，请重新生成相关内容'
              }
            >
              <ColorfulButton
                mode="active"
                disabled={runningPhaseStatus === RunningPhaseStatus.Pending}
                style={{ width: 250 }}
              >
                <div
                  className={styles.operateWrapper}
                  onClick={() => {
                    if (runningPhaseStatus === RunningPhaseStatus.Pending) {
                      return;
                    }
                    const params = { url: '' };
                    regenerateMessageByPhase(VideoGeneratorTaskPhase.PhaseFilm, {
                      [UserConfirmationDataKey.Film]: params,
                    });
                  }}
                >
                  {runningPhaseStatus !== RunningPhaseStatus.Pending ? (
                    <IconAiPlay className={clsx(styles.operateIcon, styles.disabledIcon)} />
                  ) : (
                    <IconAiPlayDisabled className={styles.operateIcon} />
                  )}
                  <div>
                    {
                      '素材已编辑，再次生成视频'
                    }
                  </div>
                </div>
              </ColorfulButton>
            </Popover>
            <ColorfulButton mode="default" style={{ width: 130, borderWidth: 1 }}>
              <div
                className={styles.operateWrapper}
                onClick={() => {
                  resetConfirm();
                }}
              >
                <IconAiReset className={styles.operateIcon} />
                {'清空对话'}
              </div>
            </ColorfulButton>
          </div>
        );
      }

      return (
        <ColorfulButton mode="active" style={{ width: 250 }}>
          <div
            className={styles.operateWrapper}
            onClick={() => {
              resetConfirm();
            }}
          >
            <IconAiReset className={styles.operateIcon} />
            {'清空历史，开始新故事'}
          </div>
        </ColorfulButton>
      );
    }

    return (
      <>
        {autoNext ? (
          <ColorfulButton mode="active" style={{ width: 225 }}>
            <div
              className={styles.operateWrapper}
              onClick={() => {
                updateAutoNext(false);
              }}
            >
              <IconAiPause className={styles.operateIcon} />
              {'暂停后续流程'}
            </div>
          </ColorfulButton>
        ) : (
          <div className="flex gap-[10px]">
            <Popover
              disabled={flowStatus === FlowStatus.Ready}
              content={
                '当前有相关内容错误，请重新生成相关内容'
              }
            >
              <ColorfulButton mode="active" style={{ width: 225 }}>
                <div
                  onClick={() => {
                    // 人工确认当前阶段后，只进入下一个阶段。
                    proceedNextPhase(finishPhase);
                    updateAutoNext(false);
                  }}
                  className={styles.operateWrapper}
                >
                  <IconAiPlay className={styles.operateIcon} />
                  {'确认并进入下一步'}
                </div>
              </ColorfulButton>
            </Popover>
            <ColorfulButton mode="default" style={{ width: 130, borderWidth: 1 }}>
              <div
                className={styles.operateWrapper}
                onClick={() => {
                  resetConfirm();
                }}
              >
                <IconAiReset className={styles.operateIcon} />
                {'清空对话'}
              </div>
            </ColorfulButton>
          </div>
        )}
      </>
    );
  };

  const flowList: FlowItem[] = [
    {
      id: FlowPhase.GenerateRole,
      title: (
        <FlowItemTitle
          content={'1.生成故事角色'}
          disabled={finishPhase === VideoGeneratorTaskPhase.PhaseFilm || modelOperateDisabled}
          onRetry={retryFromPhase}
          retryPhase={VideoGeneratorTaskPhase.PhaseRoleDescription}
          finishPhase={finishPhase}
          extra={renderPhaseDownloadButton(
            userConfirmData?.[UserConfirmationDataKey.RoleImage]?.[0]?.archive_url ||
              getProjectArchiveUrl('role_images'),
            '下载全部角色图',
            !userConfirmData?.[UserConfirmationDataKey.RoleImage]?.some(item => hasReadyLocalAsset(item)),
          )}
        />
      ),
      phase: FlowPhase.GenerateRole,
      content:
        generateRolePhaseData.length > 0
          ? active => {
              const roleImages = userConfirmData?.[UserConfirmationDataKey.RoleImage];

              return (
                <CardScrollList
                  id={FlowPhase.GenerateRole}
                  list={generateRolePhaseData.map((item, index) => {
                    const imageIndex = roleImages?.findIndex(item => item.index === index);
                    const roleImageItem = !isUndefined(imageIndex) ? roleImages?.[imageIndex] : undefined;

                    return (
                      <MediaCard
                        key={`${FlowPhase.GenerateRole}${index}`}
                        src={roleImageItem?.images?.[0] || ''}
                        prompt={item.description}
                        header={
                          <MediaCardHeader
                            title={`
                              故事角色 ${index + 1}
                            `}
                            extra={
                              <>
                                <input
                                  id={`role-reference-upload-${index}`}
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  style={{ display: 'none' }}
                                  onChange={event => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    handleUploadRoleReferenceImage(index, item.role, file);
                                  }}
                                />
                                <Popover content="上传参考图并锁定角色">
                                  <Button
                                    size="mini"
                                    type="text"
                                    icon={<IconUpload />}
                                    loading={referenceImageUploading[index]}
                                    disabled={modelOperateDisabled}
                                    onClick={() => {
                                      document.getElementById(`role-reference-upload-${index}`)?.click();
                                    }}
                                  />
                                </Popover>
                                {renderDownloadButton(
                                  getAssetDownloadUrl(roleImageItem, getProjectAssetUrl('role_images', index)),
                                  '下载角色图',
                                  !getAssetDownloadUrl(roleImageItem, getProjectAssetUrl('role_images', index)),
                                )}
                              </>
                            }
                          />
                        }
                        type="image"
                        previewable
                        modelInfo={item.modelDisplayInfo}
                        onEdit={val => {
                          const currentDescriptionData = roleDescription[index];
                          const storeDescriptionData = userConfirmData?.[UserConfirmationDataKey.RoleDescriptions];
                          if (!storeDescriptionData) {
                            return;
                          }
                          const matchDescriptionList = matchRoleDescription(storeDescriptionData);
                          if (!matchDescriptionList?.length) {
                            return;
                          }
                          // 合成新的描述
                          const mergedDescriptionStr = mergedOriginDescriptionsByPhase({
                            phase: VideoGeneratorTaskPhase.PhaseRoleDescription,
                            replaceDesc: val ?? '',
                            mergeList: matchDescriptionList,
                            uniqueKey: String(currentDescriptionData.key),
                          });
                          correctDescription(VideoGeneratorTaskPhase.PhaseRoleDescription, mergedDescriptionStr);
                          updateConfirmationMessage({
                            [UserConfirmationDataKey.RoleDescriptions]: mergedDescriptionStr,
                          });
                          if (generateStoryBoardImageData.length > 0) {
                            markFirstFrameDescriptionRegenerate(item.role ?? '');
                          }
                        }}
                        promptLoading={runningPhaseStatus === RunningPhaseStatus.Pending}
                        disabled={modelOperateDisabled}
                        onRegenerate={() => {
                          const roleImages = userConfirmData?.[UserConfirmationDataKey.RoleImage];
                          if (!roleImages) {
                            return;
                          }
                          const imageIndex = roleImages.findIndex(item => item.index === index);
                          if (imageIndex === -1) {
                            return;
                          }
                          // 将相应的图片置为空字符串，传给后端
                          const cloneArr = cloneDeep(roleImages);
                          cloneArr[imageIndex].images = [];
                          // 发送重新生成消息
                          regenerateMessageByPhase(VideoGeneratorTaskPhase.PhaseRoleImage, {
                            [UserConfirmationDataKey.RoleImage]: cloneArr,
                          });
                        }}
                      />
                    );
                  })}
                  isActive={active}
                />
              );
            }
          : undefined,
    },
    {
      id: FlowPhase.GenerateStoryBoardImage,
      title: (
        <FlowItemTitle
          content={'2.生成分镜画面'}
          disabled={finishPhase === VideoGeneratorTaskPhase.PhaseFilm || modelOperateDisabled}
          onRetry={retryFromPhase}
          retryPhase={VideoGeneratorTaskPhase.PhaseFirstFrameDescription}
          finishPhase={finishPhase}
          extra={renderPhaseDownloadButton(
            userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]?.[0]?.archive_url ||
              getProjectArchiveUrl('storyboard_images'),
            '下载全部分镜画面',
            !userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]?.some(item => hasReadyLocalAsset(item)),
          )}
        />
      ),
      phase: FlowPhase.GenerateStoryBoardImage,
      content:
        generateStoryBoardImageData.length > 0
          ? active => {
              const firstFrameImages = userConfirmData?.[UserConfirmationDataKey.FirstFrameImages];
              return (
                <CardScrollList
                  id={FlowPhase.GenerateStoryBoardImage}
                  list={generateStoryBoardImageData.map((item, index) => {
                    const firstFrameImageIndex = firstFrameImages?.findIndex(item => item.index === index);
                    const firstFrameImageItem =
                      !isUndefined(firstFrameImageIndex) ? firstFrameImages?.[firstFrameImageIndex] : undefined;

                    return (
                      <MediaCard
                        key={`${FlowPhase.GenerateRole}${index}`}
                        src={
                          (!isUndefined(firstFrameImageIndex) &&
                            firstFrameImages?.[firstFrameImageIndex]?.images?.[0]) ||
                          ''
                        }
                        prompt={item.description}
                        disabled={modelOperateDisabled}
                        header={
                          <MediaCardHeader
                            title={`分镜画面 ${index + 1}`}
                            imgArr={generateStoryBoardImageData?.[index]?.mediaUrls}
                            currentIndex={generateStoryBoardImageData?.[index]?.mediaUrls?.findIndex(
                              item =>
                                item ===
                                  (!isUndefined(firstFrameImageIndex) &&
                                    firstFrameImages?.[firstFrameImageIndex]?.images?.[0]) || '',
                            )}
                            onSelect={val => {
                              if (isUndefined(firstFrameImageIndex) || !firstFrameImages) {
                                return;
                              }
                              const cloneArr = cloneDeep(firstFrameImages);
                              cloneArr[firstFrameImageIndex].images = [
                                generateStoryBoardImageData?.[index]?.mediaUrls?.[val],
                              ];
                              updateConfirmationMessage({
                                [UserConfirmationDataKey.FirstFrameImages]: cloneArr,
                              });
                            }}
                            extra={renderDownloadButton(
                              getAssetDownloadUrl(firstFrameImageItem, getProjectAssetUrl('storyboard_images', index)),
                              '下载分镜画面',
                              !getAssetDownloadUrl(
                                firstFrameImageItem,
                                getProjectAssetUrl('storyboard_images', index),
                              ),
                            )}
                          />
                        }
                        type="image"
                        previewable
                        previewVariant="landscape"
                        modelInfo={item.modelDisplayInfo}
                        editWarning={Boolean(firstFrameDescriptionRegenerateState & (1 << index))}
                        regenerateWarning={Boolean(firstFrameRegenerateState & (1 << index))}
                        onEdit={val => {
                          const currentDescriptionData = firstFrameDescription[index];
                          const storeDescriptionData =
                            userConfirmData?.[UserConfirmationDataKey.FirstFrameDescriptions];
                          if (!storeDescriptionData) {
                            return;
                          }
                          const matchDescriptionList = matchFirstFrameDescription(storeDescriptionData);
                          if (!matchDescriptionList?.length) {
                            return;
                          }
                          // 合成新的描述
                          const mergedDescriptionStr = mergedOriginDescriptionsByPhase({
                            phase: VideoGeneratorTaskPhase.PhaseFirstFrameDescription,
                            replaceDesc: val ?? '',
                            mergeList: matchDescriptionList,
                            uniqueKey: String(currentDescriptionData.key),
                          });
                          correctDescription(VideoGeneratorTaskPhase.PhaseFirstFrameDescription, mergedDescriptionStr);
                          updateConfirmationMessage({
                            [UserConfirmationDataKey.FirstFrameDescriptions]: mergedDescriptionStr,
                          });
                          setFirstFrameDescriptionRegenerateState(val => val & ~(1 << index));
                          setFirstFrameRegenerateState(val => val | (1 << index));
                        }}
                        onRegenerate={() => {
                          const firstFrameImages = userConfirmData?.[UserConfirmationDataKey.FirstFrameImages];
                          if (!firstFrameImages) {
                            return;
                          }
                          const firstFrameImageIndex = firstFrameImages.findIndex(item => item.index === index);
                          if (firstFrameImageIndex === -1) {
                            return;
                          }
                          // 将相应的图片置为空字符串，传给后端
                          const cloneArr = cloneDeep(firstFrameImages);
                          cloneArr[firstFrameImageIndex].images = [];
                          // 发送重新生成消息
                          regenerateMessageByPhase(VideoGeneratorTaskPhase.PhaseFirstFrameImage, {
                            [UserConfirmationDataKey.FirstFrameImages]: cloneArr,
                          });
                          setFirstFrameRegenerateState(val => val & ~(1 << index));
                          if (generateStoryBoardVideoData.length > 0) {
                            setVideoRegenerateState(val => val | (1 << index));
                          }
                        }}
                        promptLoading={runningPhaseStatus === RunningPhaseStatus.Pending}
                        onPromptGenerate={() => {
                          const currentDescriptionData = firstFrameDescription[index];
                          const storeDescriptionData =
                            userConfirmData?.[UserConfirmationDataKey.FirstFrameDescriptions];
                          if (!storeDescriptionData) {
                            return;
                          }
                          const matchDescriptionList = matchFirstFrameDescription(storeDescriptionData);
                          if (!matchDescriptionList?.length) {
                            return;
                          }
                          const mergedDescriptionStr = mergedOriginDescriptionsByPhase({
                            phase: VideoGeneratorTaskPhase.PhaseFirstFrameDescription,
                            replaceDesc: '',
                            mergeList: matchDescriptionList,
                            uniqueKey: String(currentDescriptionData.key),
                          });
                          sendRegenerationDescription(
                            VideoGeneratorTaskPhase.PhaseFirstFrameDescription,
                            {
                              [UserConfirmationDataKey.FirstFrameDescriptions]: mergedDescriptionStr,
                            },
                            String(currentDescriptionData.key),
                          );
                          setFirstFrameDescriptionRegenerateState(val => val & ~(1 << index));
                          setFirstFrameRegenerateState(val => val | (1 << index));
                        }}
                      />
                    );
                  })}
                  isActive={active}
                />
              );
            }
          : undefined,
    },
    {
      id: FlowPhase.GenerateStoryBoardVideo,
      title: (
        <FlowItemTitle
          content={'3.生成分镜视频'}
          disabled={finishPhase === VideoGeneratorTaskPhase.PhaseFilm || modelOperateDisabled}
          onRetry={retryFromPhase}
          retryPhase={VideoGeneratorTaskPhase.PhaseVideoDescription}
          finishPhase={finishPhase}
          extra={renderPhaseDownloadButton(
            userConfirmData?.[UserConfirmationDataKey.Videos]?.[0]?.archive_url ||
              getProjectArchiveUrl('storyboard_videos'),
            '下载全部分镜视频',
            !userConfirmData?.[UserConfirmationDataKey.Videos]?.some(item =>
              item?.local_assets?.some((asset: Record<string, any>) => asset.status === 'ready'),
            ),
          )}
        />
      ),
      phase: FlowPhase.GenerateStoryBoardVideo,
      content:
        generateStoryBoardVideoData.length > 0
          ? active => {
              const videos = userConfirmData?.[UserConfirmationDataKey.Videos];
              const firstFrameImages = userConfirmData?.[UserConfirmationDataKey.FirstFrameImages];

              return (
                <CardScrollList
                  id={FlowPhase.GenerateStoryBoardVideo}
                  list={generateStoryBoardVideoData.map((item, index) => {
                    const videoIndex = videos?.findIndex(item => item.index === index);
                    const videoItem = !isUndefined(videoIndex) ? videos?.[videoIndex] : undefined;
                    const firstImageIndex = firstFrameImages?.findIndex(item => item.index === index);

                    if (!isUndefined(firstImageIndex) && firstFrameImages?.[firstImageIndex]?.images?.[0]) {
                      if (!(index in videoBackgroundImages)) {
                        updateVideoBackgroundImages(val => ({
                          ...val,
                          [index]: [firstFrameImages?.[firstImageIndex]?.images?.[0]],
                        }));
                        videoBackgroundImages[index] = [firstFrameImages?.[firstImageIndex]?.images?.[0]];
                      }
                    }

                    return (
                      <MediaCard
                        key={`${FlowPhase.GenerateStoryBoardVideo}${index}`}
                        src={videoItem?.video_gen_task_id || ''}
                        videoUrl={getAssetDownloadUrl(videoItem)}
                        prompt={item.description}
                        disabled={modelOperateDisabled}
                        header={
                          <MediaCardHeader
                            title={`
                              视频画面 ${index + 1}
                            `}
                            imgArr={videoBackgroundImages?.[index]}
                            currentIndex={generateStoryBoardVideoData?.[index]?.mediaIds?.findIndex(
                              item =>
                                item === (!isUndefined(videoIndex) && videos?.[videoIndex]?.video_gen_task_id) || '',
                            )}
                            onSelect={val => {
                              if (isUndefined(videoIndex) || !videos) {
                                return;
                              }
                              const cloneArr = cloneDeep(videos);
                              cloneArr[videoIndex].video_gen_task_id =
                                generateStoryBoardVideoData?.[index]?.mediaIds?.[val];
                              updateConfirmationMessage({
                                [UserConfirmationDataKey.Videos]: cloneArr,
                              });
                            }}
                            extra={renderDownloadButton(
                              getAssetDownloadUrl(videoItem),
                              '下载视频片段',
                              !getAssetDownloadUrl(videoItem),
                            )}
                          />
                        }
                        type="video"
                        modelInfo={item.modelDisplayInfo}
                        videoProjectId={projectId}
                        videoIndex={index}
                        onVideoTaskUpdate={task => {
                          if (!task?.local_asset || isUndefined(videoIndex) || !videos) {
                            return;
                          }
                          const currentVideo = videos[videoIndex];
                          const currentAsset = currentVideo?.local_assets?.[0];
                          const nextAsset = task.local_asset;
                          if (
                            currentAsset?.status === nextAsset.status &&
                            currentAsset?.filename === nextAsset.filename &&
                            currentAsset?.message === nextAsset.message
                          ) {
                            return;
                          }
                          const cloneArr = cloneDeep(videos);
                          cloneArr[videoIndex] = {
                            ...cloneArr[videoIndex],
                            local_assets: [nextAsset],
                            download_url: nextAsset.download_url || cloneArr[videoIndex].download_url,
                            video_url: task.content?.video_url || cloneArr[videoIndex].video_url,
                          };
                          updateConfirmationMessage({
                            [UserConfirmationDataKey.Videos]: cloneArr,
                          });
                        }}
                        afterTerminal={success => {
                          if (!success) {
                            setVideoRegenerateState(val => val | (1 << index));
                          }
                          setVideoStatus(status => {
                            if ((status | (1 << index)) === (1 << generateStoryBoardVideoData.length) - 1 && runningPhase === VideoGeneratorTaskPhase.PhaseVideo) {
                              // 阶段转终态
                              updateRunningPhaseStatus(RunningPhaseStatus.Success);
                              updateAutoNext(false);
                            }
                            return status | (1 << index);
                          });
                        }}
                        audioImg={isUndefined(firstImageIndex) ? '' : firstFrameImages?.[firstImageIndex]?.images?.[0]}
                        onEdit={val => {
                          const currentDescriptionData = videoDescription[index];
                          const storeDescriptionData = userConfirmData?.[UserConfirmationDataKey.VideoDescriptions];
                          if (!storeDescriptionData) {
                            return;
                          }
                          const matchDescriptionList = matchVideoDescription(storeDescriptionData);
                          if (!matchDescriptionList?.length) {
                            return;
                          }
                          // 合成新的描述
                          const mergedDescriptionStr = mergedOriginDescriptionsByPhase({
                            phase: VideoGeneratorTaskPhase.PhaseVideoDescription,
                            replaceDesc: val ?? '',
                            mergeList: matchDescriptionList,
                            uniqueKey: String(currentDescriptionData.key),
                          });
                          correctDescription(VideoGeneratorTaskPhase.PhaseVideoDescription, mergedDescriptionStr);
                          updateConfirmationMessage({
                            [UserConfirmationDataKey.VideoDescriptions]: mergedDescriptionStr,
                          });
                          setVideoRegenerateState(val => val | (1 << index));
                        }}
                        regenerateWarning={Boolean(videoRegenerateState & (1 << index))}
                        onRegenerate={() => {
                          const videoIds = userConfirmData?.[UserConfirmationDataKey.Videos];
                          if (!videoIds) {
                            return;
                          }
                          const videoIndex = videoIds.findIndex(item => item.index === index);
                          if (videoIndex === -1) {
                            return;
                          }
                          // 将相应的图片置为空字符串，传给后端
                          const cloneArr = cloneDeep(videoIds);
                          cloneArr[videoIndex].video_gen_task_id = '';
                          // 发送重新生成消息
                          regenerateMessageByPhase(VideoGeneratorTaskPhase.PhaseVideo, {
                            [UserConfirmationDataKey.Videos]: cloneArr,
                          });
                          setVideoStatus(status => status & ~(1 << videoIndex));
                          updateVideoBackgroundImages(val => {
                            const cloneArr = cloneDeep(val);
                            cloneArr[index].push(
                              isUndefined(firstImageIndex) ? '' : firstFrameImages?.[firstImageIndex]?.images?.[0],
                            );
                            return cloneArr;
                          });
                          setVideoRegenerateState(val => val & ~(1 << index));
                        }}
                        promptLoading={runningPhaseStatus === RunningPhaseStatus.Pending}
                        onPromptGenerate={() => {
                          const currentDescriptionData = videoDescription[index];
                          const storeDescriptionData = userConfirmData?.[UserConfirmationDataKey.VideoDescriptions];
                          if (!storeDescriptionData) {
                            return;
                          }
                          const matchDescriptionList = matchVideoDescription(storeDescriptionData);
                          if (!matchDescriptionList?.length) {
                            return;
                          }
                          const mergedDescriptionStr = mergedOriginDescriptionsByPhase({
                            phase: VideoGeneratorTaskPhase.PhaseVideoDescription,
                            replaceDesc: '',
                            mergeList: matchDescriptionList,
                            uniqueKey: String(currentDescriptionData.key),
                          });
                          sendRegenerationDescription(
                            VideoGeneratorTaskPhase.PhaseVideoDescription,
                            {
                              [UserConfirmationDataKey.VideoDescriptions]: mergedDescriptionStr,
                            },
                            String(currentDescriptionData.key),
                          );
                          setVideoRegenerateState(val => val | (1 << index));
                        }}
                      />
                    );
                  })}
                  isActive={active}
                />
              );
            }
          : undefined,
    },
    {
      id: FlowPhase.GenerateStoryBoardAudio,
      title: (
        <FlowItemTitle
          content={'4.配音设置'}
          disabled={finishPhase === VideoGeneratorTaskPhase.PhaseFilm || modelOperateDisabled}
          onRetry={retryFromPhase}
          retryPhase={isOriginalVoiceMode ? VideoGeneratorTaskPhase.PhaseVideo : VideoGeneratorTaskPhase.PhaseTone}
          finishPhase={finishPhase}
        />
      ),
      phase: FlowPhase.GenerateStoryBoardAudio,
      content:
        hasGeneratedVideos || generateStoryBoardAudioData.length > 0
          ? active => {
              const audios = userConfirmData?.[UserConfirmationDataKey.Audios];
              const firstFrameImages = userConfirmData?.[UserConfirmationDataKey.FirstFrameImages];

              return (
                <div className={styles.voiceSettingsWrapper}>
                  <div className={styles.voiceModePanel}>
                    <Radio.Group
                      type="button"
                      value={voiceMode}
                      disabled={finishPhase === VideoGeneratorTaskPhase.PhaseFilm || modelOperateDisabled}
                      onChange={handleVoiceModeChange}
                    >
                      <Radio value={VoiceMode.Generated}>生成 AI 配音</Radio>
                      <Radio value={VoiceMode.Original}>使用原音频</Radio>
                    </Radio.Group>
                  </div>
                  {isOriginalVoiceMode ? (
                    <div className={styles.originalAudioStatus}>使用原音频</div>
                  ) : generateStoryBoardAudioData.length > 0 ? (
                    <CardScrollList
                      id={FlowPhase.GenerateStoryBoardAudio}
                      list={generateStoryBoardAudioData.map((item, index) => {
                        const audioIndex = audios?.findIndex(item => item.index === index);
                        const firstImageIndex = firstFrameImages?.findIndex(item => item.index === index);

                        if (!isUndefined(firstImageIndex) && firstFrameImages?.[firstImageIndex]?.images?.[0]) {
                          if (!(index in audioBackgroundImages)) {
                            updateAudioBackgroundImages(val => ({
                              ...val,
                              [index]: [firstFrameImages?.[firstImageIndex]?.images?.[0]],
                            }));
                            audioBackgroundImages[index] = [firstFrameImages?.[firstImageIndex]?.images?.[0]];
                          }
                        }

                        return (
                          <MediaCard
                            key={`${FlowPhase.GenerateStoryBoardAudio}${index}`}
                            src={(!isUndefined(audioIndex) && audios?.[audioIndex]?.url) || ''}
                            prompt={item.description}
                            disabled={modelOperateDisabled}
                            tone={item.tone}
                            regenerateWarning={Boolean(audioRegenerateState & (1 << index))}
                            header={
                              <MediaCardHeader
                                title={`
                                  分镜配音 ${index + 1}
                                `}
                                imgArr={audioBackgroundImages?.[index]}
                                currentIndex={generateStoryBoardAudioData?.[index]?.mediaUrls?.findIndex(
                                  item => item === (!isUndefined(audioIndex) && audios?.[audioIndex]?.url) || '',
                                )}
                                onSelect={val => {
                                  if (isUndefined(audioIndex) || !audios) {
                                    return;
                                  }
                                  const cloneArr = cloneDeep(audios);
                                  cloneArr[audioIndex].url = generateStoryBoardAudioData?.[index]?.mediaUrls?.[val];
                                  // 发送重新生成消息
                                  updateConfirmationMessage({
                                    [UserConfirmationDataKey.Audios]: cloneArr,
                                  });
                                }}
                              />
                            }
                            audioImg={generateStoryBoardImageData[index]?.mediaUrls?.[0]}
                            type="audio"
                            modelInfo={item.modelDisplayInfo}
                            onRegenerate={() => {
                              const audios = userConfirmData?.[UserConfirmationDataKey.Audios];
                              if (!audios) {
                                return;
                              }
                              const audioIndex = audios.findIndex(item => item.index === index);
                              if (audioIndex === -1) {
                                return;
                              }
                              const cloneArr = cloneDeep(audios);
                              cloneArr[audioIndex].url = '';
                              // 发送重新生成消息
                              regenerateMessageByPhase(VideoGeneratorTaskPhase.PhaseAudio, {
                                [UserConfirmationDataKey.Audios]: cloneArr,
                              });
                              updateAudioBackgroundImages(val => {
                                const cloneArr = cloneDeep(val);
                                cloneArr[index].push(
                                  isUndefined(firstImageIndex) ? '' : firstFrameImages?.[firstImageIndex]?.images?.[0],
                                );
                                return cloneArr;
                              });
                              setAudioRegenerateState(status => status & ~(1 << index));
                            }}
                            onEdit={(val, tone) => {
                              const tones = userConfirmData?.[UserConfirmationDataKey.Tones];
                              if (!tones) {
                                return;
                              }
                              const toneIndex = tones?.findIndex(item => item.index === index);
                              if (toneIndex === -1) {
                                return;
                              }
                              const cloneArr = cloneDeep(tones);
                              cloneArr[toneIndex].line = val;
                              if (tone) {
                                cloneArr[toneIndex].tone = tone;
                              }
                              correctDescription(
                                VideoGeneratorTaskPhase.PhaseTone,
                                JSON.stringify({ [UserConfirmationDataKey.Tones]: cloneArr }),
                              );
                              updateConfirmationMessage({
                                [UserConfirmationDataKey.Tones]: cloneArr,
                              });
                              setAudioRegenerateState(val => val | (1 << index));
                            }}
                            promptLoading={runningPhaseStatus === RunningPhaseStatus.Pending}
                            onPromptGenerate={() => {
                              const tones = userConfirmData?.[UserConfirmationDataKey.Tones];
                              if (!tones) {
                                return;
                              }
                              const toneIndex = tones?.findIndex(item => item.index === index);
                              if (toneIndex === -1) {
                                return;
                              }
                              const cloneArr = cloneDeep(tones);
                              cloneArr[toneIndex].line = '';
                              // 发送重新生成消息
                              sendRegenerationDescription(
                                VideoGeneratorTaskPhase.PhaseTone,
                                {
                                  [UserConfirmationDataKey.Tones]: cloneArr,
                                },
                                String(tones[toneIndex].key),
                              );
                            }}
                          />
                        );
                      })}
                      isActive={active}
                    />
                  ) : (
                    <div className={styles.originalAudioStatus}>AI 配音待生成</div>
                  )}
                </div>
              );
            }
          : undefined,
    },
    // resultFilm 操控两个步骤，第5步是loading，第6步是展示视频
    // 这里的逻辑是，当视频生成完，进入第6步，否则进入第5步
    {
      id: FlowPhase.VideoEdit,
      title: null,
      phase: FlowPhase.VideoEdit,
      content: active => (
        <ColorfulButton style={{ width: 180 }} mode={active ? 'active' : 'default'}>
          <div id={FlowPhase.VideoEdit}>
            {runningPhase === VideoGeneratorTaskPhase.PhaseFilm && runningPhaseStatus !== RunningPhaseStatus.Success ? (
              <LoadingFilm runningPhaseStatus={runningPhaseStatus} />
            ) : (
              '5.视频剪辑'
            )}
          </div>
        </ColorfulButton>
      ),
    },
    {
      id: FlowPhase.Result,
      title: '6.最终视频',
      phase: FlowPhase.Result,
      content: () => {
        if (!userConfirmData?.film?.url) {
          return null;
        }

        return (
          <div id={FlowPhase.Result} className={styles.videoChatWrapper}>
            <div className={styles.videoWrapper}>
              <div className={styles.videoBorder}>
                <VideoPlayer ref={finalFilmPlayerRef} videoLink={userConfirmData?.film?.url || ''} />
              </div>
            </div>
            <div className={styles.resultActions}>
              <Button
                icon={<IconDownload />}
                onClick={() => downloadAsset(userConfirmData?.film?.download_url || userConfirmData?.film?.url)}
              >
                下载成片
              </Button>
              <Button
                icon={<IconDownload />}
                onClick={() => downloadAsset(userConfirmData?.film?.all_assets_archive_url || getAllAssetsArchiveUrl())}
              >
                下载全部素材
              </Button>
              <ColorfulButton
                mode="active"
                style={{ width: 180 }}
                onClick={() => {
                  finalFilmPlayerRef.current?.pause();
                  startChatWithVideo({
                    videoUrl: userConfirmData?.film?.url || '',
                    // userConfirmData?.videos?.at(-1)||'',
                    confirmation: JSON.stringify({
                      [UserConfirmationDataKey.Script]: userConfirmData?.script,
                      [UserConfirmationDataKey.StoryBoards]: userConfirmData?.storyboards,
                      [UserConfirmationDataKey.RoleDescriptions]: userConfirmData?.role_descriptions,
                    }),
                  });
                }}
              >
                <div className={styles.operateWrapper}>
                  <IconAiChat className={styles.operateIcon} />
                  {'边看边聊'}
                </div>
              </ColorfulButton>
            </div>
          </div>
        );
      },
    },
  ];

  useEffect(() => {
    if (!runningPhase) {
      return;
    }
    // 映射 phase 到当前第几步
    const index = FlowPhaseMap.findIndex(item => item.includes(runningPhase as VideoGeneratorTaskPhase));
    setCurrentPhaseIndex(index === -1 ? 0 : index + 1);
  }, [runningPhase]);

  useEffect(() => {
    // 如果视频生成完，进入第6步
    if (runningPhase === VideoGeneratorTaskPhase.PhaseFilm && runningPhaseStatus === RunningPhaseStatus.Success) {
      setCurrentPhaseIndex(6);
    }
  }, [runningPhaseStatus]);

  useEffect(() => {
    if (!projectId || generateStoryBoardVideoData.length === 0) {
      return undefined;
    }

    let stopped = false;
    const syncOnce = async () => {
      try {
        const result = await syncStoryboardVideos(projectId);
        if (stopped) {
          return;
        }
        mergeStoryboardVideoAssets(result.assets || []);
      } catch {
        // Keep the card-level polling and the next project-level tick alive.
      }
    };

    syncOnce();
    const timer = window.setInterval(syncOnce, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    projectId,
    generateStoryBoardVideoData.length,
    userConfirmData?.[UserConfirmationDataKey.Videos]?.map(item => {
      const asset = item.local_assets?.[0];
      return `${item.index}:${item.video_gen_task_id || ''}:${asset?.status || ''}:${asset?.filename || ''}`;
    }).join('|'),
  ]);

  useEffect(() => {
    if (generateStoryBoardVideoData.length === 0) {
      return;
    }
    const videos = userConfirmData?.[UserConfirmationDataKey.Videos] || [];
    const readyStatus = videos.reduce((status, item) => {
      if (typeof item?.index !== 'number' || !hasReadyLocalAsset(item)) {
        return status;
      }
      return status | (1 << item.index);
    }, 0);

    if (readyStatus) {
      setVideoStatus(status => status | readyStatus);
      if (
        runningPhase === VideoGeneratorTaskPhase.PhaseVideo &&
        runningPhaseStatus === RunningPhaseStatus.Pending &&
        (readyStatus & ((1 << generateStoryBoardVideoData.length) - 1)) ===
          (1 << generateStoryBoardVideoData.length) - 1
      ) {
        updateRunningPhaseStatus(RunningPhaseStatus.Success);
        updateAutoNext(false);
      }
    }
  }, [
    generateStoryBoardVideoData.length,
    runningPhase,
    runningPhaseStatus,
    updateAutoNext,
    updateRunningPhaseStatus,
    userConfirmData?.[UserConfirmationDataKey.Videos]?.map(item => {
      const asset = item.local_assets?.[0];
      return `${item.index}:${asset?.status || ''}:${asset?.filename || ''}`;
    }).join('|'),
  ]);

  return (
    <>
      <div className={styles['base-flow-wrapper']}>
        <BaseFlow items={flowList} current={currentPhaseIndex} />
      </div>
      <div className={styles.operateButton}>{renderOperationBtn()}</div>
    </>
  );
};

export default VideoGenerateFlow;
