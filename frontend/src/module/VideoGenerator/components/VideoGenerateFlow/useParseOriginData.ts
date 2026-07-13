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
import { useState, useEffect } from 'react';

import { compact } from 'lodash';

import { BotMessage, EMessageType } from '@/components/ChatWindowV2/context';

import { ComplexMessage, UserConfirmationDataKey, VideoGeneratorTaskPhase } from '../../types';
import { matchFirstFrameDescription, matchRoleDescription, matchVideoDescription } from '../../utils';

interface ParsedOriginData {
  key: number | string;
  versions: any[];
  extra?: any;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export interface ParsedData {
  roleDescription: ParsedOriginData[];
  roleImage: ParsedOriginData[];
  firstFrameDescription: ParsedOriginData[];
  firstFrameImage: ParsedOriginData[];
  videoDescription: ParsedOriginData[];
  storyboardVideo: ParsedOriginData[];
  audioTones: ParsedOriginData[];
  storyboardAudio: ParsedOriginData[];
  resultFilm: ParsedOriginData[];
}

export const useParseOriginData = (messages: ComplexMessage) => {
  const [parsedData, setParsedData] = useState<ParsedData>({
    roleDescription: [],
    roleImage: [],
    firstFrameDescription: [],
    firstFrameImage: [],
    videoDescription: [],
    storyboardVideo: [],
    audioTones: [],
    storyboardAudio: [],
    resultFilm: [],
  });

  const parsePhaseRoleDescription = (botMessage: BotMessage) => {
    const { versions, currentVersion } = botMessage;
    const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
    if (!messageItem) {
      return undefined;
    }
    return matchRoleDescription(messageItem.content);
  };

  const parsePhaseRoleImage = (botMessage: BotMessage): Record<string, any>[] | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if (UserConfirmationDataKey.RoleImage in parsedData) {
        return parsedData.role_images as Record<string, any>[];
      }
      return [];
    } catch {
      return undefined;
    }
  };

  const parsePhaseFirstFrameDescription = (botMessage: BotMessage) => {
    const { versions, currentVersion } = botMessage;
    const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
    if (!messageItem) {
      return undefined;
    }
    return matchFirstFrameDescription(messageItem.content);
  };

  const parsePhaseFirstFrameImage = (botMessage: BotMessage): Record<string, any>[] | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if (UserConfirmationDataKey.FirstFrameImages in parsedData) {
        return parsedData.first_frame_images as Record<string, any>[];
      }
      return [];
    } catch {
      return undefined;
    }
  };

  const parsePhaseVideoDescription = (botMessage: BotMessage) => {
    const { versions, currentVersion } = botMessage;
    const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
    if (!messageItem) {
      return undefined;
    }
    return matchVideoDescription(messageItem.content);
  };

  const parsePhaseVideo = (
    botMessage: BotMessage,
  ): {
    index: number;
    videoId: string;
    downloadUrl?: string;
    videoUrl?: string;
    localAssets?: Record<string, any>[];
  }[] | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if (UserConfirmationDataKey.Videos in parsedData) {
        return parsedData.videos.map(
          (item: {
            index: number;
            video_gen_task_id: string;
            download_url?: string;
            video_url?: string;
            local_assets?: Record<string, any>[];
          }) => ({
            index: item.index,
            videoId: item.video_gen_task_id,
            downloadUrl: item.download_url,
            videoUrl: item.video_url,
            localAssets: item.local_assets,
          }),
        );
      }
      return [];
    } catch {
      return undefined;
    }
  };

  const parsePhaseTones = (
    botMessage: BotMessage,
  ): { index: number; tone: string; lines: string; lines_en: string }[] | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if (UserConfirmationDataKey.Tones in parsedData) {
        return parsedData.tones as { index: number; tone: string; lines: string; lines_en: string }[];
      }
      return [];
    } catch {
      return undefined;
    }
  };

  const parsePhaseAudio = (
    botMessage: BotMessage,
  ):
    | { index: number; url: string; error_code?: string; error_message?: string; log_id?: string }[]
    | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if (UserConfirmationDataKey.Audios in parsedData) {
        return parsedData.audios as { index: number; url: string }[];
      }
      return [];
    } catch {
      return undefined;
    }
  };

  const parsePhaseFilm = (botMessage: BotMessage): { index: number; url: string }[] | undefined => {
    const { versions, finish, currentVersion } = botMessage;
    if (!finish) {
      return undefined;
    }
    try {
      const messageItem = versions[currentVersion].find(item => item.type === EMessageType.Message);
      if (!messageItem) {
        return undefined;
      }
      const parsedData = JSON.parse(messageItem.content);
      // 数据在下面属性里
      if ('film' in parsedData) {
        return [{ index: 0, url: parsedData.film.url }];
      }
      return [];
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    // 处理消息
    const { phaseMessageMap } = messages;
    const resultData: ParsedData = {
      roleDescription: [],
      roleImage: [],
      firstFrameDescription: [],
      firstFrameImage: [],
      videoDescription: [],
      storyboardVideo: [],
      audioTones: [],
      storyboardAudio: [],
      resultFilm: [],
    };

    Object.keys(phaseMessageMap).forEach(key => {
      switch (key) {
        case VideoGeneratorTaskPhase.PhaseRoleDescription: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseRoleDescription(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.uniqueKey);
              if (index === -1) {
                assemblyData.push({
                  key: item.uniqueKey,
                  versions: [item.content],
                  extra: {
                    storyRole: item.storyRole,
                  },
                });
              } else {
                assemblyData[index].versions.push(item.content);
              }
            });
          });
          resultData.roleDescription = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseRoleImage: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseRoleImage(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [...item.images],
                  extra: {
                    localAssets: item.local_assets,
                    downloadUrl: item.download_url,
                    archiveUrl: item.archive_url,
                  },
                });
              } else {
                assemblyData[index].versions.push(...item.images);
                assemblyData[index].extra = {
                  ...assemblyData[index].extra,
                  localAssets: item.local_assets || assemblyData[index].extra?.localAssets,
                  downloadUrl: item.download_url || assemblyData[index].extra?.downloadUrl,
                  archiveUrl: item.archive_url || assemblyData[index].extra?.archiveUrl,
                };
              }
            });
          });
          // 需要排序
          assemblyData.sort((a, b) => Number(a.key) - Number(b.key));
          resultData.roleImage = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseFirstFrameDescription: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseFirstFrameDescription(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.uniqueKey);
              if (index === -1) {
                assemblyData.push({
                  key: item.uniqueKey,
                  versions: [item.content],
                  extra: {
                    storyRole: item.storyRole,
                  },
                });
              } else {
                assemblyData[index].versions.push(item.content);
              }
            });
          });
          resultData.firstFrameDescription = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseFirstFrameImage: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseFirstFrameImage(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [...unique<string>(item.images)],
                  extra: {
                    localAssets: item.local_assets,
                    downloadUrl: item.download_url,
                    archiveUrl: item.archive_url,
                  },
                });
              } else {
                assemblyData[index].versions = unique<string>([...assemblyData[index].versions, ...item.images]).slice(
                  -4,
                );
                assemblyData[index].extra = {
                  ...assemblyData[index].extra,
                  localAssets: item.local_assets || assemblyData[index].extra?.localAssets,
                  downloadUrl: item.download_url || assemblyData[index].extra?.downloadUrl,
                  archiveUrl: item.archive_url || assemblyData[index].extra?.archiveUrl,
                };
              }
            });
          });
          // 需要排序
          assemblyData.sort((a, b) => Number(a.key) - Number(b.key));
          resultData.firstFrameImage = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseVideoDescription: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseVideoDescription(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.uniqueKey);
              if (index === -1) {
                assemblyData.push({
                  key: item.uniqueKey,
                  versions: [item.content],
                  extra: {
                    storyRole: item.storyRole,
                  },
                });
              } else {
                assemblyData[index].versions.push(item.content);
              }
            });
          });
          resultData.videoDescription = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseVideo: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseVideo(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [item.videoId],
                  extra: {
                    downloadUrl: item.downloadUrl,
                    videoUrl: item.videoUrl,
                    localAssets: item.localAssets,
                  },
                });
              } else {
                assemblyData[index].versions.push(item.videoId);
                assemblyData[index].extra = {
                  ...assemblyData[index].extra,
                  downloadUrl: item.downloadUrl || assemblyData[index].extra?.downloadUrl,
                  videoUrl: item.videoUrl || assemblyData[index].extra?.videoUrl,
                  localAssets: item.localAssets || assemblyData[index].extra?.localAssets,
                };
              }
            });
          });
          // 需要排序
          assemblyData.sort((a, b) => Number(a.key) - Number(b.key));
          resultData.storyboardVideo = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseTone: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseTones(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [item],
                });
              } else {
                assemblyData[index].versions.push(item);
              }
            });
          });
          // 需要排序
          assemblyData.sort((a, b) => Number(a.key) - Number(b.key));
          resultData.audioTones = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseAudio: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseAudio(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [item.url],
                  extra: {
                    errorCode: item.error_code,
                    errorMessage: item.error_message,
                    logId: item.log_id,
                  },
                });
              } else {
                assemblyData[index].versions.push(item.url);
                assemblyData[index].extra = {
                  errorCode: item.error_code,
                  errorMessage: item.error_message,
                  logId: item.log_id,
                };
              }
            });
          });
          // 需要排序
          assemblyData.sort((a, b) => Number(a.key) - Number(b.key));
          resultData.storyboardAudio = assemblyData;
          break;
        }
        case VideoGeneratorTaskPhase.PhaseFilm: {
          const parsedData = compact(phaseMessageMap[key].map(item => parsePhaseFilm(item)));
          const assemblyData: ParsedOriginData[] = [];
          parsedData.forEach(version => {
            version.forEach(item => {
              const index = assemblyData.findIndex(assemblyItem => assemblyItem.key === item.index);
              if (index === -1) {
                assemblyData.push({
                  key: item.index,
                  versions: [item.url],
                });
              } else {
                assemblyData[index].versions.push(item.url);
              }
            });
          });
          resultData.resultFilm = assemblyData;
          break;
        }
        default:
          break;
      }
    });

    setParsedData(resultData);
  }, [messages]);

  return parsedData;
};
