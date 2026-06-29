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

import { useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Message, Modal, Popover, Radio } from '@arco-design/web-react';
import {
  IconDelete,
  IconFile,
  IconFolder,
  IconImage,
  IconRefresh,
  IconUpload,
} from '@arco-design/web-react/icon';

import { ChatWindowContext } from '@/components/ChatWindowV2/context';
import classroomPreview from '@/images/assets/knowledge-style-classroom.svg';
import documentaryPreview from '@/images/assets/knowledge-style-documentary.svg';
import infographicPreview from '@/images/assets/knowledge-style-infographic.svg';
import museumPreview from '@/images/assets/knowledge-style-museum.svg';
import { IconClean } from '@/images/iconBox';
import { WatchAndChat } from '@/module/WatchAndChat';
import { useStartChatWithVideo } from '@/module/WatchAndChat/providers/WatchAndChatProvider/hooks/useStartChatWithVideo';
import {
  getDesktopProjects,
  type DesktopProjectSummary,
  type DesktopProjectsResponse,
} from '@/module/VideoGenerator/services/desktopStatus';
import { syncStoryboardVideos } from '@/module/VideoGenerator/utils/syncStoryboardVideos';
import { getDesktopAPI, resolveBackendUrl } from '@/utils/desktopRuntime';
import { formatLocalDateTime } from '@/utils/time';

import { useScrollToBottom } from '../../hooks/useScrollToBottom';
import { InjectContext } from '../../store/Inject/context';
import { RenderedMessagesContext } from '../../store/RenderedMessages/context';
import {
  AspectRatio,
  BackgroundReferenceStrength,
  ContentMode,
  FlowPhase,
  KnowledgeStyle,
  type ReferenceImage,
  RunningPhaseStatus,
  ScriptMode,
  UserConfirmationDataKey,
  VideoGeneratorMessageType,
  VideoGeneratorTaskPhase,
} from '../../types';
import { uploadReferenceImage } from '../../utils/uploadReferenceImage';
import { getProjectManifest, type ProjectAsset } from '../../utils/projectManifest';
import ChatArea from '../ChatArea';
import { DesktopStatusPanel } from './components/DesktopStatusPanel';
import { MessageInput } from './components/MessageInput';
import { Placeholder, type PlaceholderProps } from './components/Placeholder';
import { usePlaceholderInfo } from './hooks/usePlaceholderInfo';
import styles from './index.module.less';

const SCRIPT_FILE_MAX_SIZE = 500 * 1024;
const SCRIPT_TEXT_MAX_LENGTH = 12000;
const SCRIPT_TEXT_WARN_LENGTH = 8000;
const SCRIPT_TEXT_MIN_LENGTH = 20;
const SCRIPT_FILE_EXTENSIONS = ['txt', 'md', 'text'];
const KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH = 500;
const BACKGROUND_IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const BACKGROUND_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const createProjectId = () =>
  `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const KNOWLEDGE_STYLE_OPTIONS = [
  {
    label: '纪录片半写实',
    value: KnowledgeStyle.Documentary,
    description: '档案感、低饱和、历史建筑',
    preview: documentaryPreview,
  },
  {
    label: '课堂图解',
    value: KnowledgeStyle.ClassroomDiagram,
    description: '时间线、箭头、地图标注',
    preview: classroomPreview,
  },
  {
    label: '博物馆展陈',
    value: KnowledgeStyle.MuseumExhibit,
    description: '展柜、手稿、旧照片',
    preview: museumPreview,
  },
  {
    label: '信息图短视频',
    value: KnowledgeStyle.Infographic,
    description: '标题卡、图标、数据对比',
    preview: infographicPreview,
  },
];

const BACKGROUND_REFERENCE_STRENGTH_OPTIONS = [
  {
    label: '普通参考',
    value: BackgroundReferenceStrength.Normal,
  },
  {
    label: '强参考',
    value: BackgroundReferenceStrength.Strong,
  },
  {
    label: '严格参考',
    value: BackgroundReferenceStrength.Strict,
  },
];

const ASPECT_RATIO_OPTIONS = [
  {
    label: '16:9 横屏',
    value: AspectRatio.Landscape,
  },
  {
    label: '9:16 竖屏',
    value: AspectRatio.Portrait,
  },
];

type WorkflowStep = {
  label: string;
  phase: VideoGeneratorTaskPhase;
  statusPhases?: VideoGeneratorTaskPhase[];
  retryPhase?: VideoGeneratorTaskPhase;
  tab: WorkspaceTab;
  anchorId?: string;
};

type WorkspaceTab = 'chat' | 'script' | 'storyboard' | 'media' | 'film';
type AppSection = 'workspace' | 'projects' | 'assets';

const APP_SECTIONS: { label: string; value: AppSection; description: string }[] = [
  { label: '工作台', value: 'workspace', description: '当前视频生产现场' },
  { label: '项目', value: 'projects', description: '最近项目和状态' },
  { label: '资产', value: 'assets', description: '当前项目素材' },
];

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    label: '文案',
    phase: VideoGeneratorTaskPhase.PhaseScript,
    tab: 'script',
  },
  {
    label: '分镜脚本',
    phase: VideoGeneratorTaskPhase.PhaseStoryBoard,
    tab: 'storyboard',
  },
  {
    label: '角色',
    phase: VideoGeneratorTaskPhase.PhaseRoleImage,
    statusPhases: [
      VideoGeneratorTaskPhase.PhaseRoleDescription,
      VideoGeneratorTaskPhase.PhaseRoleImage,
    ],
    retryPhase: VideoGeneratorTaskPhase.PhaseRoleDescription,
    tab: 'media',
    anchorId: FlowPhase.GenerateRole,
  },
  {
    label: '分镜画面',
    phase: VideoGeneratorTaskPhase.PhaseFirstFrameImage,
    statusPhases: [
      VideoGeneratorTaskPhase.PhaseFirstFrameDescription,
      VideoGeneratorTaskPhase.PhaseFirstFrameImage,
    ],
    retryPhase: VideoGeneratorTaskPhase.PhaseFirstFrameDescription,
    tab: 'media',
    anchorId: FlowPhase.GenerateStoryBoardImage,
  },
  {
    label: '视频片段',
    phase: VideoGeneratorTaskPhase.PhaseVideo,
    statusPhases: [
      VideoGeneratorTaskPhase.PhaseVideoDescription,
      VideoGeneratorTaskPhase.PhaseVideo,
    ],
    retryPhase: VideoGeneratorTaskPhase.PhaseVideoDescription,
    tab: 'media',
    anchorId: FlowPhase.GenerateStoryBoardVideo,
  },
  {
    label: '配音',
    phase: VideoGeneratorTaskPhase.PhaseAudio,
    statusPhases: [
      VideoGeneratorTaskPhase.PhaseTone,
      VideoGeneratorTaskPhase.PhaseAudio,
    ],
    retryPhase: VideoGeneratorTaskPhase.PhaseTone,
    tab: 'media',
    anchorId: FlowPhase.GenerateStoryBoardAudio,
  },
  {
    label: '成片',
    phase: VideoGeneratorTaskPhase.PhaseFilm,
    retryPhase: VideoGeneratorTaskPhase.PhaseFilm,
    tab: 'film',
    anchorId: FlowPhase.Result,
  },
];

const WORKSPACE_TABS: { label: string; value: WorkspaceTab }[] = [
  { label: '对话', value: 'chat' },
  { label: '文案', value: 'script' },
  { label: '分镜', value: 'storyboard' },
  { label: '画面', value: 'media' },
  { label: '成片', value: 'film' },
];

const WORKFLOW_ORDER = Object.values(VideoGeneratorTaskPhase);

const ASSET_PHASE_LABELS: Record<string, string> = {
  reference_images: '参考图',
  role_images: '角色图',
  storyboard_images: '分镜画面',
  storyboard_videos: '分镜视频',
  audios: '配音',
  film: '成片',
};

type ContentOptionsOverrides = {
  contentMode?: ContentMode;
  knowledgeStyle?: KnowledgeStyle;
  knowledgeStylePrompt?: string;
  aspectRatio?: AspectRatio;
  backgroundReference?: ReferenceImage;
  backgroundReferenceStrength?: BackgroundReferenceStrength;
  roleReference?: ReferenceImage;
};

type ReferenceImageInput =
  | File
  | {
      dataUrl: string;
      fileName: string;
      mimeType: string;
      size: number;
    };

const getReferenceImageName = (file: ReferenceImageInput) =>
  file instanceof File ? file.name : file.fileName;

interface ConversationProps {
  orgContext?: {
    tenantId?: string;
    workspaceId?: string;
  };
}

const getReferenceImageType = (file: ReferenceImageInput) =>
  file instanceof File ? file.type : file.mimeType;

const getReferenceImageSize = (file: ReferenceImageInput) => file.size;

const Conversation = ({ orgContext }: ConversationProps) => {
  const { slots } = useContext(InjectContext);
  const { LimitIndicator } = slots;
  const {
    messages,
    sending,
    assistantInfo,
    sendMessageFromInput,
    sendMessageImplicitly,
    startReply,
    insertBotEmptyMessage,
  } = useContext(ChatWindowContext);
  const {
    miniMapRef,
    renderedMessages,
    runningPhase,
    runningPhaseStatus,
    finishPhase,
    autoNext,
    resetMessages,
    updateConfirmationMessage,
    proceedNextPhase,
    retryFromPhase,
    userConfirmData,
  } = useContext(RenderedMessagesContext);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  const roleFileInputRef = useRef<HTMLInputElement>(null);
  const [scriptUploadVisible, setScriptUploadVisible] = useState(false);
  const [scriptUploadFileName, setScriptUploadFileName] = useState('');
  const [scriptUploadText, setScriptUploadText] = useState('');
  const [contentMode, setContentMode] = useState(ContentMode.HistoryKnowledge);
  const [knowledgeStyle, setKnowledgeStyle] = useState(
    KnowledgeStyle.Documentary,
  );
  const [knowledgeStylePrompt, setKnowledgeStylePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(AspectRatio.Landscape);
  const [backgroundReference, setBackgroundReference] =
    useState<ReferenceImage>();
  const [roleReference, setRoleReference] = useState<ReferenceImage>();
  const [backgroundReferenceStrength, setBackgroundReferenceStrength] =
    useState(BackgroundReferenceStrength.Strict);
  const [projectId, setProjectId] = useState(() => createProjectId());
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [roleUploading, setRoleUploading] = useState(false);
  const [activeScriptFileName, setActiveScriptFileName] = useState('');
  const [activeScriptTextLength, setActiveScriptTextLength] = useState(0);
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<WorkspaceTab>('chat');
  const [activeAppSection, setActiveAppSection] =
    useState<AppSection>('workspace');
  const [readyFilmAsset, setReadyFilmAsset] = useState<ProjectAsset>();
  const [desktopProjects, setDesktopProjects] =
    useState<DesktopProjectsResponse>();
  const [currentManifest, setCurrentManifest] = useState<{
    project_id: string;
    assets: ProjectAsset[];
    created_at?: string;
    updated_at?: string;
  }>();
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');
  const [hubRefreshKey, setHubRefreshKey] = useState(0);
  const manifestProjectId =
    userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.project_id;
  const effectiveProjectId =
    manifestProjectId || projectId;

  const placeholderInfoShow = usePlaceholderInfo({ assistant: assistantInfo });

  const showMessageList = useMemo(() => messages.length > 0, [messages]);
  const settingsLocked = showMessageList || sending;
  const visualLockPhases = [
    VideoGeneratorTaskPhase.PhaseRoleImage,
    VideoGeneratorTaskPhase.PhaseFirstFrameImage,
    VideoGeneratorTaskPhase.PhaseVideo,
    VideoGeneratorTaskPhase.PhaseTone,
    VideoGeneratorTaskPhase.PhaseAudio,
    VideoGeneratorTaskPhase.PhaseFilm,
  ];
  const visualSettingsLocked = visualLockPhases.includes(
    finishPhase as VideoGeneratorTaskPhase,
  );
  const hasUsableMediaUrl = (url?: string) => Boolean(url?.startsWith('http'));
  const hasGeneratedVisualAssets = Boolean(
    userConfirmData?.[UserConfirmationDataKey.RoleImage]?.some(item =>
      item?.images?.some((url: string) => hasUsableMediaUrl(url)),
    ) ||
      userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]?.some(item =>
        item?.images?.some((url: string) => hasUsableMediaUrl(url)),
      ) ||
      userConfirmData?.[UserConfirmationDataKey.Videos]?.some(
        item => item?.video_gen_task_id,
      ) ||
      userConfirmData?.[UserConfirmationDataKey.Film]?.url,
  );
  const referenceUploadLocked =
    hasGeneratedVisualAssets ||
    (runningPhaseStatus === RunningPhaseStatus.Pending &&
      visualLockPhases.includes(runningPhase as VideoGeneratorTaskPhase));

  const { scrollRef: chatMessageListRef, setAutoScroll } = useScrollToBottom(
    !autoNext,
  );

  const normalizePhaseText = (value?: string, phase?: VideoGeneratorTaskPhase) => {
    const text = value?.trim() || '';
    if (!phase || !text) {
      return text;
    }
    return text.startsWith(`phase=${phase}`)
      ? text.replace(new RegExp(`^phase=${phase}\\s*`), '').trim()
      : text;
  };

  const countStoryboards = (value?: string) => {
    const matches = normalizePhaseText(value, VideoGeneratorTaskPhase.PhaseStoryBoard).match(/分镜\s*\d+[：:]/g);
    return matches?.length || 0;
  };

  const countReadyMedia = (items?: Record<string, any>[]) =>
    items?.filter(item => {
      if (item?.url || item?.download_url || item?.video_url || item?.video_gen_task_id) {
        return true;
      }
      if (item?.images?.some((url: string) => Boolean(url))) {
        return true;
      }
      return item?.local_assets?.some((asset: Record<string, any>) => asset.status === 'ready');
    }).length || 0;

  const isOriginalVoiceMode =
    userConfirmData?.[UserConfirmationDataKey.VoiceOptions]?.mode === 'original' ||
    userConfirmData?.[UserConfirmationDataKey.Film]?.local_assets?.[0]?.metadata?.voice_mode === 'original' ||
    readyFilmAsset?.metadata?.voice_mode === 'original';
  const hasReadyFilm =
    Boolean(userConfirmData?.[UserConfirmationDataKey.Film]?.url) ||
    Boolean(userConfirmData?.[UserConfirmationDataKey.Film]?.download_url) ||
    userConfirmData?.[UserConfirmationDataKey.Film]?.local_assets?.some(
      (asset: Record<string, any>) => asset.status === 'ready',
    ) ||
    readyFilmAsset?.status === 'ready';

  const currentProjectAssets = currentManifest?.assets || [];
  const readyAssetCount = currentProjectAssets.filter(
    asset => asset.status === 'ready',
  ).length;
  const failedAssetCount = currentProjectAssets.filter(
    asset => asset.status === 'failed',
  ).length;
  const assetGroups = currentProjectAssets.reduce<Record<string, ProjectAsset[]>>(
    (groups, asset) => {
      const phase = asset.phase || 'unknown';
      groups[phase] = groups[phase] || [];
      groups[phase].push(asset);
      return groups;
    },
    {},
  );

  const getPhaseItemCount = (phase: VideoGeneratorTaskPhase) => {
    switch (phase) {
      case VideoGeneratorTaskPhase.PhaseScript:
        return userConfirmData?.[UserConfirmationDataKey.Script]?.trim()
          ? {
              ready: 1,
              total: 1,
              detail: `${userConfirmData[UserConfirmationDataKey.Script]?.trim().length || 0} 字`,
            }
          : { ready: 0, total: 1, detail: '未导入' };
      case VideoGeneratorTaskPhase.PhaseStoryBoard: {
        const total = countStoryboards(userConfirmData?.[UserConfirmationDataKey.StoryBoards]);
        return {
          ready: total,
          total,
          detail: total ? `${total} 条分镜` : '未生成',
        };
      }
      case VideoGeneratorTaskPhase.PhaseRoleImage: {
        const total =
          userConfirmData?.[UserConfirmationDataKey.RoleDescriptions]?.match(/角色\s*\d+[：:]/g)?.length ||
          userConfirmData?.[UserConfirmationDataKey.RoleImage]?.length ||
          0;
        const ready = countReadyMedia(userConfirmData?.[UserConfirmationDataKey.RoleImage]);
        return {
          ready,
          total,
          detail: total ? `${ready}/${total} 个角色` : '未生成',
        };
      }
      case VideoGeneratorTaskPhase.PhaseFirstFrameImage: {
        const total =
          countStoryboards(userConfirmData?.[UserConfirmationDataKey.StoryBoards]) ||
          userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]?.length ||
          0;
        const ready = countReadyMedia(userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]);
        return {
          ready,
          total,
          detail: total ? `${ready}/${total} 张画面` : '未生成',
        };
      }
      case VideoGeneratorTaskPhase.PhaseVideo: {
        const total =
          countStoryboards(userConfirmData?.[UserConfirmationDataKey.StoryBoards]) ||
          userConfirmData?.[UserConfirmationDataKey.Videos]?.length ||
          0;
        const ready = countReadyMedia(userConfirmData?.[UserConfirmationDataKey.Videos]);
        return {
          ready,
          total,
          detail: total ? `${ready}/${total} 段视频` : '未生成',
        };
      }
      case VideoGeneratorTaskPhase.PhaseAudio: {
        if (isOriginalVoiceMode) {
          return { ready: 1, total: 1, detail: '使用原音频' };
        }
        const total =
          countStoryboards(userConfirmData?.[UserConfirmationDataKey.StoryBoards]) ||
          userConfirmData?.[UserConfirmationDataKey.Audios]?.length ||
          0;
        const ready = countReadyMedia(userConfirmData?.[UserConfirmationDataKey.Audios]);
        return {
          ready,
          total,
          detail: total ? `${ready}/${total} 条配音` : '未生成',
        };
      }
      case VideoGeneratorTaskPhase.PhaseFilm:
        return hasReadyFilm
          ? { ready: 1, total: 1, detail: '成片完成' }
          : { ready: 0, total: 1, detail: '未合成' };
      default:
        return { ready: 0, total: 0, detail: '未开始' };
    }
  };

  useEffect(() => {
    if (!manifestProjectId) {
      setReadyFilmAsset(undefined);
      return undefined;
    }

    let stopped = false;
    const loadReadyFilm = async () => {
      try {
        const manifest = await getProjectManifest(manifestProjectId);
        if (stopped) {
          return;
        }
        const filmAsset = manifest.assets
          ?.filter(asset => asset.phase === 'film' && asset.status === 'ready')
          .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
        setReadyFilmAsset(filmAsset);
      } catch {
        if (!stopped) {
          setReadyFilmAsset(undefined);
        }
      }
    };

    loadReadyFilm();
    const timer = window.setInterval(loadReadyFilm, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [manifestProjectId]);

  useEffect(() => {
    if (!['projects', 'assets'].includes(activeAppSection)) {
      return undefined;
    }

    let stopped = false;
    const loadHubData = async () => {
      setHubLoading(true);
      setHubError('');
      try {
        const [nextProjects, nextManifest] = await Promise.all([
          getDesktopProjects(50),
          activeAppSection === 'assets'
            ? getProjectManifest(effectiveProjectId)
            : Promise.resolve(undefined),
        ]);
        if (stopped) {
          return;
        }
        setDesktopProjects(nextProjects);
        if (nextManifest) {
          setCurrentManifest(nextManifest);
        }
      } catch (error) {
        if (!stopped) {
          setHubError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!stopped) {
          setHubLoading(false);
        }
      }
    };

    loadHubData();
    return () => {
      stopped = true;
    };
  }, [activeAppSection, effectiveProjectId, hubRefreshKey]);

  const handleScroll = (e: HTMLElement) => {
    if (autoNext) {
      return;
    }
    const bottomHeight = e.scrollTop + e.clientHeight;
    const isHitBottom = e.scrollHeight - bottomHeight <= 150;

    setAutoScroll(isHitBottom);
  };

  const handleSend = (value = '') => {
    if (!value || sending) {
      return;
    }
    if (
      value.trim() === '下一步' &&
      userConfirmData?.[UserConfirmationDataKey.ContentOptions]?.mode &&
      [
        VideoGeneratorTaskPhase.PhaseScript,
        VideoGeneratorTaskPhase.PhaseStoryBoard,
      ].includes(finishPhase as VideoGeneratorTaskPhase)
    ) {
      proceedNextPhase(finishPhase);
      return;
    }
    miniMapRef.current?.close();
    // 用户消息加入到列表
    sendMessageFromInput(value);

    // 插入 bot 占位
    setTimeout(() => {
      insertBotEmptyMessage();
      // 请求接口
      startReply();
    }, 10);
  };

  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  const validateScriptText = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) {
      Message.error('文案不能为空');
      return false;
    }
    if (trimmedText.length < SCRIPT_TEXT_MIN_LENGTH) {
      Message.error('文案过短，请补充更完整的故事内容');
      return false;
    }
    if (trimmedText.length > SCRIPT_TEXT_MAX_LENGTH) {
      Message.error(`文案不能超过 ${SCRIPT_TEXT_MAX_LENGTH} 字`);
      return false;
    }
    return true;
  };

  const handleScriptTextSelected = (
    fileName: string,
    text: string,
    size: number,
  ) => {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    if (!SCRIPT_FILE_EXTENSIONS.includes(extension)) {
      Message.error('仅支持 txt、md、text 文本文件');
      return;
    }
    if (size > SCRIPT_FILE_MAX_SIZE) {
      Message.error('文案文件不能超过 500KB');
      return;
    }
    if (!validateScriptText(text)) {
      return;
    }
    if (text.length > SCRIPT_TEXT_WARN_LENGTH) {
      Message.warning('文案较长，建议确认内容精简后再继续');
    }
    setScriptUploadFileName(fileName);
    setScriptUploadText(text);
    setScriptUploadVisible(true);
  };

  const handleSelectScriptFile = async () => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      scriptFileInputRef.current?.click();
      return;
    }
    try {
      const file = await desktopAPI.selectScriptFile();
      if (!file) {
        return;
      }
      handleScriptTextSelected(file.fileName, file.text, file.size);
    } catch {
      Message.error('文案读取失败，请换一个文本文件重试');
    }
  };

  const handleScriptFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SCRIPT_FILE_EXTENSIONS.includes(extension)) {
      Message.error('仅支持 txt、md、text 文本文件');
      return;
    }
    if (file.size > SCRIPT_FILE_MAX_SIZE) {
      Message.error('文案文件不能超过 500KB');
      return;
    }
    try {
      const text = await readFileAsText(file);
      if (!validateScriptText(text)) {
        return;
      }
      handleScriptTextSelected(file.name, text, file.size);
    } catch {
      Message.error('文案读取失败，请换一个文本文件重试');
    }
  };

  const validateKnowledgeStylePrompt = (text: string) => {
    if (text.trim().length > KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH) {
      Message.error(
        `风格提示词不能超过 ${KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH} 字`,
      );
      return false;
    }
    return true;
  };

  const handleBackgroundFile = async (file: ReferenceImageInput) => {
    if (!file) {
      return;
    }
    if (referenceUploadLocked) {
      Message.warning('当前画面已生成，如需更换背景图请先清空当前对话');
      return;
    }
    if (!BACKGROUND_IMAGE_TYPES.includes(getReferenceImageType(file))) {
      Message.error('背景图仅支持 jpg、png、webp');
      return;
    }
    if (getReferenceImageSize(file) > BACKGROUND_IMAGE_MAX_SIZE) {
      Message.error('背景图不能超过 10MB');
      return;
    }
    setBackgroundUploading(true);
    try {
      const { url, object_key } = await uploadReferenceImage(
        file instanceof File
          ? file
          : {
              content_type: file.mimeType,
              data: file.dataUrl,
              file_name: file.fileName,
            },
      );
      const nextBackgroundReference = {
        url,
        object_key,
        file_name: getReferenceImageName(file),
      };
      setBackgroundReference(nextBackgroundReference);
      syncContentOptions({ backgroundReference: nextBackgroundReference });
      Message.success('背景参考图已上传');
    } catch {
      Message.error('背景参考图上传失败');
    } finally {
      setBackgroundUploading(false);
    }
  };

  const handleSelectBackgroundFile = async () => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      backgroundFileInputRef.current?.click();
      return;
    }
    try {
      const file = await desktopAPI.selectReferenceImage();
      if (!file) {
        return;
      }
      await handleBackgroundFile(file);
    } catch {
      Message.error('背景图读取失败，请换一张图片重试');
    }
  };

  const handleBackgroundFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await handleBackgroundFile(file);
  };

  const handleRoleFile = async (file: ReferenceImageInput) => {
    if (referenceUploadLocked) {
      Message.warning(
        '当前角色或画面已生成，如需更换角色参考图请先清空当前对话',
      );
      return;
    }
    if (!BACKGROUND_IMAGE_TYPES.includes(getReferenceImageType(file))) {
      Message.error('角色参考图仅支持 jpg、png、webp');
      return;
    }
    if (getReferenceImageSize(file) > BACKGROUND_IMAGE_MAX_SIZE) {
      Message.error('角色参考图不能超过 10MB');
      return;
    }
    setRoleUploading(true);
    try {
      const { url, object_key } = await uploadReferenceImage(
        file instanceof File
          ? file
          : {
              content_type: file.mimeType,
              data: file.dataUrl,
              file_name: file.fileName,
            },
      );
      const nextRoleReference = {
        url,
        object_key,
        file_name: getReferenceImageName(file),
      };
      setRoleReference(nextRoleReference);
      syncContentOptions({ roleReference: nextRoleReference });
      Message.success('角色参考图已上传');
    } catch {
      Message.error('角色参考图上传失败');
    } finally {
      setRoleUploading(false);
    }
  };

  const handleSelectRoleFile = async () => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      roleFileInputRef.current?.click();
      return;
    }
    try {
      const file = await desktopAPI.selectReferenceImage();
      if (!file) {
        return;
      }
      await handleRoleFile(file);
    } catch {
      Message.error('角色参考图读取失败，请换一张图片重试');
    }
  };

  const handleRoleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await handleRoleFile(file);
  };

  const getContentOptions = (overrides: ContentOptionsOverrides = {}) => {
    const nextContentMode = overrides.contentMode ?? contentMode;
    const nextKnowledgeStyle = overrides.knowledgeStyle ?? knowledgeStyle;
    const nextKnowledgeStylePrompt =
      overrides.knowledgeStylePrompt ?? knowledgeStylePrompt;
    const nextAspectRatio = overrides.aspectRatio ?? aspectRatio;
    const nextBackgroundReference = Object.prototype.hasOwnProperty.call(
      overrides,
      'backgroundReference',
    )
      ? overrides.backgroundReference
      : backgroundReference;
    const nextRoleReference = Object.prototype.hasOwnProperty.call(
      overrides,
      'roleReference',
    )
      ? overrides.roleReference
      : roleReference;
    const nextBackgroundReferenceStrength =
      overrides.backgroundReferenceStrength ?? backgroundReferenceStrength;

    if (nextContentMode !== ContentMode.HistoryKnowledge) {
      return {
        project_id: projectId,
        ...(orgContext?.tenantId ? { tenant_id: orgContext.tenantId } : {}),
        ...(orgContext?.workspaceId ? { workspace_id: orgContext.workspaceId } : {}),
        mode: nextContentMode,
        aspect_ratio: nextAspectRatio,
      };
    }

    const trimmedStylePrompt = nextKnowledgeStylePrompt.trim();
    return {
      project_id: projectId,
      ...(orgContext?.tenantId ? { tenant_id: orgContext.tenantId } : {}),
      ...(orgContext?.workspaceId ? { workspace_id: orgContext.workspaceId } : {}),
      mode: nextContentMode,
      style: nextKnowledgeStyle,
      aspect_ratio: nextAspectRatio,
      ...(trimmedStylePrompt ? { style_prompt: trimmedStylePrompt } : {}),
      ...(nextBackgroundReference
        ? {
            background_reference: nextBackgroundReference,
            background_reference_strength: nextBackgroundReferenceStrength,
          }
        : {}),
      ...(nextRoleReference ? { role_reference: nextRoleReference } : {}),
    };
  };

  const syncContentOptions = (overrides: ContentOptionsOverrides = {}) => {
    if (
      !showMessageList &&
      !userConfirmData?.[UserConfirmationDataKey.ContentOptions]
    ) {
      return;
    }
    updateConfirmationMessage({
      [UserConfirmationDataKey.ContentOptions]: getContentOptions(overrides),
    });
  };

  const handleConfirmUploadedScript = () => {
    const script = scriptUploadText.trim();
    if (!validateScriptText(script)) {
      return;
    }
    if (
      contentMode === ContentMode.HistoryKnowledge &&
      !validateKnowledgeStylePrompt(knowledgeStylePrompt)
    ) {
      return;
    }
    if (backgroundUploading || roleUploading) {
      Message.warning('参考图还在上传，请稍后再继续');
      return;
    }
    const contentOptions = getContentOptions();
    miniMapRef.current?.close();
    const content = `CONFIRMATION ${JSON.stringify({
      [UserConfirmationDataKey.ScriptOptions]: {
        mode: ScriptMode.Uploaded,
        file_name: scriptUploadFileName,
      },
      [UserConfirmationDataKey.ContentOptions]: contentOptions,
      [UserConfirmationDataKey.Script]: script,
    })}`;
    updateConfirmationMessage({
      [UserConfirmationDataKey.ScriptOptions]: {
        mode: ScriptMode.Uploaded,
        file_name: scriptUploadFileName,
      },
      [UserConfirmationDataKey.ContentOptions]: contentOptions,
      [UserConfirmationDataKey.Script]: script,
    });
    setActiveScriptFileName(scriptUploadFileName);
    setActiveScriptTextLength(script.length);
    sendMessageImplicitly(content);
    setScriptUploadVisible(false);
    setScriptUploadFileName('');
    setScriptUploadText('');

    setTimeout(() => {
      insertBotEmptyMessage();
      startReply();
    }, 10);
  };

  const getPlaceHolderProps = (): PlaceholderProps => {
    const placeholder = Array.isArray(placeholderInfoShow)
      ? placeholderInfoShow[0]
      : placeholderInfoShow;
    return {
      avatar: placeholder.avatar,
      chatStarted: showMessageList,
      disabled: false,
      name: placeholder.name,
      onQuestionClick: handleSend,
      openingRemark: placeholder.openingRemark,
      preQuestions: placeholder.preQuestions ?? [],
    };
  };

  const { visible: isFullScreen } = useStartChatWithVideo();

  const resetWorkflow = () => {
    resetMessages();
    setProjectId(createProjectId());
    setActiveScriptFileName('');
    setActiveScriptTextLength(0);
  };

  const handleOpenProjectFolder = async () => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      Message.info('浏览器模式下请在项目 assets/generated 目录查看素材');
      return;
    }
    try {
      await desktopAPI.openProjectFolder(projectId);
    } catch {
      Message.error('打开素材目录失败');
    }
  };

  const handleOpenProjectFolderById = async (targetProjectId: string) => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) {
      Message.info('浏览器模式下请在项目 assets/generated 目录查看素材');
      return;
    }
    try {
      await desktopAPI.openProjectFolder(targetProjectId);
    } catch {
      Message.error('打开素材目录失败');
    }
  };

  const handleSyncProjectAssets = async (targetProjectId: string) => {
    setHubLoading(true);
    try {
      await syncStoryboardVideos(targetProjectId);
      Message.success('分镜视频同步完成');
      setHubRefreshKey(key => key + 1);
    } catch {
      Message.error('分镜视频同步失败，请查看后端日志');
    } finally {
      setHubLoading(false);
    }
  };

  const formatHubTime = (value?: string) =>
    formatLocalDateTime(value, '未知');

  const getProjectStatusText = (project: DesktopProjectSummary) => {
    if (project.status === 'manifest_error') {
      return 'manifest 异常';
    }
    if (project.film_ready) {
      return '成片完成';
    }
    if (project.asset_count > 0) {
      return '生成中/待处理';
    }
    return '未开始';
  };

  const getProjectSummaryText = (project: DesktopProjectSummary) => {
    const roleReady = project.phase_counts.role_images?.ready || 0;
    const imageReady = project.phase_counts.storyboard_images?.ready || 0;
    const videoReady = project.phase_counts.storyboard_videos?.ready || 0;
    return `素材 ${project.ready_asset_count || 0}/${project.asset_count || 0}，角色 ${roleReady}，画面 ${imageReady}，视频 ${videoReady}`;
  };

  const handleContentModeChange = (value: ContentMode) => {
    setContentMode(value);
    syncContentOptions({ contentMode: value });
  };

  const handleKnowledgeStyleChange = (value: KnowledgeStyle) => {
    setKnowledgeStyle(value);
    syncContentOptions({ knowledgeStyle: value });
  };

  const handleKnowledgeStylePromptChange = (value: string) => {
    setKnowledgeStylePrompt(value);
    syncContentOptions({ knowledgeStylePrompt: value });
  };

  const handleAspectRatioChange = (value: AspectRatio) => {
    setAspectRatio(value);
    syncContentOptions({ aspectRatio: value });
  };

  const handleBackgroundReferenceStrengthChange = (
    value: BackgroundReferenceStrength,
  ) => {
    setBackgroundReferenceStrength(value);
    syncContentOptions({ backgroundReferenceStrength: value });
  };

  const handleClearBackgroundReference = () => {
    setBackgroundReference(undefined);
    syncContentOptions({ backgroundReference: undefined });
  };

  const handleClearRoleReference = () => {
    setRoleReference(undefined);
    syncContentOptions({ roleReference: undefined });
  };

  const getStepStatus = (step: WorkflowStep) => {
    const statusPhases = step.statusPhases ?? [step.phase];
    if (statusPhases.includes(runningPhase as VideoGeneratorTaskPhase) && runningPhaseStatus === RunningPhaseStatus.Pending) {
      return '生成中';
    }
    if (statusPhases.includes(runningPhase as VideoGeneratorTaskPhase) && runningPhaseStatus === RunningPhaseStatus.RequestError) {
      return '失败';
    }

    const finishedIndex = WORKFLOW_ORDER.findIndex(item => item === finishPhase);
    const stepIndex = Math.max(...statusPhases.map(phase => WORKFLOW_ORDER.findIndex(item => item === phase)));

    if (finishedIndex >= stepIndex && finishedIndex !== -1) {
      const count = getPhaseItemCount(step.phase);
      if (count.total > 0 && count.ready > 0 && count.ready < count.total) {
        return '部分完成';
      }
      return count.ready > 0 || step.phase === VideoGeneratorTaskPhase.PhaseStoryBoard ? '完成' : '已处理';
    }
    if ((sending || runningPhaseStatus === RunningPhaseStatus.Pending) && stepIndex === finishedIndex + 1) {
      return '生成中';
    }
    if (stepIndex === finishedIndex + 1) {
      return '待处理';
    }
    return '未开始';
  };

  const canRetryWorkflowStep = (retryPhase?: VideoGeneratorTaskPhase) => {
    if (!retryPhase || runningPhaseStatus === RunningPhaseStatus.Pending) {
      return false;
    }
    const finishIndex = WORKFLOW_ORDER.findIndex(item => item === finishPhase);
    const retryIndex = WORKFLOW_ORDER.findIndex(item => item === retryPhase);
    return finishIndex >= retryIndex && retryIndex !== -1;
  };

  const handleWorkflowStepClick = (item: WorkflowStep) => {
    setActiveWorkspaceTab(item.tab);
    window.setTimeout(() => {
      const element = item.anchorId ? document.getElementById(item.anchorId) : undefined;
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  const handleWorkflowRetry = (
    event: { stopPropagation: () => void },
    retryPhase?: VideoGeneratorTaskPhase,
  ) => {
    event.stopPropagation();
    if (!canRetryWorkflowStep(retryPhase)) {
      return;
    }
    if (retryPhase) {
      retryFromPhase(retryPhase);
    }
  };

  const renderProjectSettings = () => (
    <aside className={styles.projectSidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarTitle}>项目设置</div>
        <div className={styles.sidebarMeta}>
          {settingsLocked
            ? visualSettingsLocked
              ? '本次任务已锁定'
              : '可调整风格和背景图'
            : '准备阶段'}
        </div>
      </div>
      <div className={styles.settingsSection}>
        <div className={styles.settingsLabel}>内容来源</div>
        <div className={styles.sourceBox}>
          <div className={styles.sourceIcon}>
            <IconFile />
          </div>
          <div className={styles.sourceInfo}>
            <div className={styles.sourceTitle}>
              {activeScriptFileName || scriptUploadFileName || '上传文案'}
            </div>
            <div className={styles.sourceMeta}>
              {activeScriptTextLength
                ? `${activeScriptTextLength} 字`
                : scriptUploadText.trim().length
                  ? `${scriptUploadText.trim().length} 字，待导入`
                  : '支持 txt、md、text'}
            </div>
          </div>
        </div>
        <Button
          className={styles.sidebarActionButton}
          icon={<IconUpload />}
          disabled={settingsLocked}
          onClick={handleSelectScriptFile}
        >
          {activeScriptFileName ? '更换文案' : '上传文案'}
        </Button>
        <Button
          className={styles.sidebarActionButton}
          icon={<IconFolder />}
          onClick={handleOpenProjectFolder}
        >
          打开素材目录
        </Button>
      </div>
      {contentMode === ContentMode.HistoryKnowledge ? (
        <>
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>背景参考图</div>
            {backgroundReference?.url ? (
              <div className={styles.backgroundReferenceCard}>
                <img src={backgroundReference.url} alt="背景参考图" />
                <div className={styles.backgroundReferenceInfo}>
                  <div className={styles.backgroundReferenceName}>
                    {backgroundReference.file_name}
                  </div>
                  <div className={styles.backgroundReferenceHint}>
                    角色、场景、色调和时代氛围
                  </div>
                </div>
                <Button
                  size="mini"
                  type="text"
                  icon={<IconDelete />}
                  disabled={referenceUploadLocked}
                  onClick={handleClearBackgroundReference}
                />
              </div>
            ) : (
              <Button
                className={styles.sidebarActionButton}
                data-testid="background-reference-upload"
                icon={<IconImage />}
                disabled={referenceUploadLocked || backgroundUploading}
                onClick={handleSelectBackgroundFile}
              >
                {backgroundUploading ? '上传中...' : '上传背景图'}
              </Button>
            )}
          </div>
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>角色参考图</div>
            {roleReference?.url ? (
              <div className={styles.backgroundReferenceCard}>
                <img src={roleReference.url} alt="角色参考图" />
                <div className={styles.backgroundReferenceInfo}>
                  <div className={styles.backgroundReferenceName}>
                    {roleReference.file_name}
                  </div>
                  <div className={styles.backgroundReferenceHint}>
                    角色外观、服饰、人物质感
                  </div>
                </div>
                <Button
                  size="mini"
                  type="text"
                  icon={<IconDelete />}
                  disabled={referenceUploadLocked}
                  onClick={handleClearRoleReference}
                />
              </div>
            ) : (
              <Button
                className={styles.sidebarActionButton}
                data-testid="role-reference-upload"
                icon={<IconImage />}
                disabled={referenceUploadLocked || roleUploading}
                onClick={handleSelectRoleFile}
              >
                {roleUploading ? '上传中...' : '上传角色参考图'}
              </Button>
            )}
          </div>
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>风格提示词</div>
            <textarea
              className={styles.knowledgePromptTextarea}
              value={knowledgeStylePrompt}
              disabled={visualSettingsLocked}
              placeholder="低饱和、纪录片感、使用地图和文献，不要Q版人物。"
              onChange={event =>
                handleKnowledgeStylePromptChange(event.target.value)
              }
            />
            <div className={styles.knowledgePromptCount}>
              {knowledgeStylePrompt.trim().length}/
              {KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH}
            </div>
          </div>
          {backgroundReference?.url ? (
            <>
              <div className={styles.settingsSection}>
                <div className={styles.settingsLabel}>背景图参考强度</div>
                <Radio.Group
                  className={styles.inlineRadioGroup}
                  type="button"
                  value={backgroundReferenceStrength}
                  disabled={visualSettingsLocked}
                  onChange={handleBackgroundReferenceStrengthChange}
                >
                  {BACKGROUND_REFERENCE_STRENGTH_OPTIONS.map(item => (
                    <Radio key={item.value} value={item.value}>
                      {item.label}
                    </Radio>
                  ))}
                </Radio.Group>
              </div>
            </>
          ) : null}
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>科普视频风格</div>
            <div className={styles.knowledgeStyleGrid}>
              {KNOWLEDGE_STYLE_OPTIONS.map(item => (
                <button
                  key={item.value}
                  type="button"
                  className={styles.knowledgeStyleCard}
                  data-selected={knowledgeStyle === item.value}
                  disabled={visualSettingsLocked}
                  onClick={() => handleKnowledgeStyleChange(item.value)}
                >
                  <img src={item.preview} alt={item.label} />
                  <div className={styles.knowledgeStyleText}>
                    <div className={styles.knowledgeStyleTitle}>
                      {item.label}
                    </div>
                    <div className={styles.knowledgeStyleDesc}>
                      {item.description}
                    </div>
                  </div>
                  <span className={styles.knowledgeStyleCheck} />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <div className={styles.settingsSection}>
        <div className={styles.settingsLabel}>视频类型</div>
        <Radio.Group
          className={styles.verticalRadioGroup}
          value={contentMode}
          disabled={settingsLocked}
          onChange={handleContentModeChange}
        >
          <Radio value={ContentMode.Story}>儿童睡前故事</Radio>
          <Radio value={ContentMode.HistoryKnowledge}>历史/知识类视频</Radio>
        </Radio.Group>
      </div>
      <div className={styles.settingsSection}>
        <div className={styles.settingsLabel}>画面比例</div>
        <Radio.Group
          className={styles.inlineRadioGroup}
          type="button"
          value={aspectRatio}
          disabled={visualSettingsLocked}
          onChange={handleAspectRatioChange}
        >
          {ASPECT_RATIO_OPTIONS.map(item => (
            <Radio key={item.value} value={item.value}>
              {item.label}
            </Radio>
          ))}
        </Radio.Group>
      </div>
    </aside>
  );

  const renderWorkflowSidebar = () => (
    <aside className={styles.workflowSidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarTitle}>工作流</div>
        <div className={styles.sidebarMeta}>
          {finishPhase ? '进行中' : '未开始'}
        </div>
      </div>
      <div className={styles.workflowList}>
        {WORKFLOW_STEPS.map(item => {
          const status = getStepStatus(item);
          const count = getPhaseItemCount(item.phase);
          const retryable = canRetryWorkflowStep(item.retryPhase);
          return (
            <div
              key={item.phase}
              role="button"
              tabIndex={0}
              className={styles.workflowItem}
              data-active={activeWorkspaceTab === item.tab}
              onClick={() => handleWorkflowStepClick(item)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleWorkflowStepClick(item);
                }
              }}
            >
              <div className={styles.workflowDot} data-status={status} />
              <div className={styles.workflowContent}>
                <div className={styles.workflowItemTop}>
                  <div className={styles.workflowLabel}>{item.label}</div>
                  <div className={styles.workflowStatus} data-status={status}>
                    {status}
                  </div>
                </div>
                <div className={styles.workflowMeta}>{count.detail}</div>
              </div>
              {item.retryPhase ? (
                <Popover content={retryable ? '从本阶段重新生成' : '当前阶段暂不可重试'}>
                  <Button
                    size="mini"
                    type="text"
                    icon={<IconRefresh />}
                    disabled={!retryable}
                    className={styles.workflowRetryButton}
                    onClick={event => handleWorkflowRetry(event, item.retryPhase)}
                  />
                </Popover>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles.workflowFooter}>
        <div className={styles.workflowFooterTitle}>当前阶段</div>
        <div className={styles.workflowFooterValue}>
          {finishPhase || '等待输入'}
        </div>
      </div>
    </aside>
  );

  const renderEmptyWorkspace = (title: string, description: string) => (
    <div className={styles.workspaceEmpty}>
      <div className={styles.workspaceEmptyTitle}>{title}</div>
      <div className={styles.workspaceEmptyDesc}>{description}</div>
    </div>
  );

  const renderTextWorkspace = (
    title: string,
    content?: string,
    phase?: VideoGeneratorTaskPhase,
  ) => {
    const normalizedContent = normalizePhaseText(content, phase);
    if (!normalizedContent) {
      return renderEmptyWorkspace(title, '当前阶段还没有生成内容。');
    }
    return (
      <div className={styles.workspaceDetail}>
        <div className={styles.workspaceDetailHeader}>
          <div>
            <div className={styles.workspaceDetailTitle}>{title}</div>
            <div className={styles.workspaceDetailMeta}>
              {normalizedContent.length} 字
            </div>
          </div>
        </div>
        <pre className={styles.workspaceTextBlock}>{normalizedContent}</pre>
      </div>
    );
  };

  const renderChatWorkspace = () => (
    <>
      <div
        className={styles.conversationChatAreaContainer}
        ref={chatMessageListRef}
        onScroll={e => handleScroll(e.currentTarget)}
      >
        <div className="h-full">
          <Placeholder {...getPlaceHolderProps()} />
          <ChatArea messages={renderedMessages} />
        </div>
      </div>
      {!renderedMessages.find(
        item => item.type === VideoGeneratorMessageType.Multiple,
      ) &&
        !isFullScreen && (
          <div className={styles.conversationInputContainer}>
            <>
              {!finishPhase ||
                ([
                  VideoGeneratorTaskPhase.PhaseScript,
                  VideoGeneratorTaskPhase.PhaseStoryBoard,
                ].includes(finishPhase as VideoGeneratorTaskPhase) && (
                  <div className={styles.resetBtnWrapper}>
                    <Button
                      className={styles.resetBtn}
                      size="small"
                      icon={<IconClean />}
                      onClick={() => {
                        resetWorkflow();
                      }}
                    >
                      {'清空当前对话'}
                    </Button>
                  </div>
                ))}
            </>
            <MessageInput
              activeSendBtn={true}
              autoFocus
              placeholder={'输入修改要求，例如：把画面改成博物馆展陈风格'}
              canSendMessage={!sending}
              sendMessage={handleSend}
              extra={inputValue =>
                LimitIndicator && <LimitIndicator text={inputValue} />
              }
              actions={
                !showMessageList
                  ? [
                      <Button
                        key="upload-script"
                        size="mini"
                        type="text"
                        icon={<IconUpload />}
                        disabled={sending}
                        onClick={event => {
                          event.stopPropagation();
                          handleSelectScriptFile();
                        }}
                      >
                        上传文案
                      </Button>,
                    ]
                  : undefined
              }
            />
          </div>
        )}
      <WatchAndChat />
    </>
  );

  const renderMediaWorkspace = () => {
    const flowMessage = renderedMessages.find(
      item => item.type === VideoGeneratorMessageType.Multiple,
    );
    if (!flowMessage) {
      return renderEmptyWorkspace('画面与视频', '角色、分镜画面和视频片段生成后会显示在这里。');
    }
    return (
      <div className={styles.workspaceFlowView}>
        <ChatArea messages={[flowMessage]} />
      </div>
    );
  };

  const renderFilmWorkspace = () => {
    if (userConfirmData?.[UserConfirmationDataKey.Film]?.url) {
      return renderMediaWorkspace();
    }
    return renderEmptyWorkspace('成片', '最终视频合成后会显示在这里。');
  };

  const renderWorkspaceContent = () => {
    switch (activeWorkspaceTab) {
      case 'script':
        return renderTextWorkspace(
          '文案',
          userConfirmData?.[UserConfirmationDataKey.Script],
          VideoGeneratorTaskPhase.PhaseScript,
        );
      case 'storyboard':
        return renderTextWorkspace(
          '分镜脚本',
          userConfirmData?.[UserConfirmationDataKey.StoryBoards],
          VideoGeneratorTaskPhase.PhaseStoryBoard,
        );
      case 'media':
        return renderMediaWorkspace();
      case 'film':
        return renderFilmWorkspace();
      case 'chat':
      default:
        return renderChatWorkspace();
    }
  };

  const renderWorkspaceSection = () => (
    <div
      className={`${styles.conversationWrapper} ${isFullScreen ? styles.conversationWrapperFullscreen : ''}`}
    >
      {renderProjectSettings()}
      <div className={styles.conversationContainer}>
        <div className={styles.workspaceTopbar}>
          <div>
            <div className={styles.workspaceTitle}>视频生成工作台</div>
            <div className={styles.workspaceSubtitle}>
              {contentMode === ContentMode.HistoryKnowledge
                ? '历史/知识类视频'
                : '儿童睡前故事'}
            </div>
          </div>
          <div className={styles.workspaceTopbarActions}>
            <DesktopStatusPanel currentProjectId={effectiveProjectId} />
            <div className={styles.workspaceTabs}>
              {WORKSPACE_TABS.map(item => (
                <button
                  key={item.value}
                  type="button"
                  className={
                    activeWorkspaceTab === item.value
                      ? styles.workspaceTabActive
                      : undefined
                  }
                  onClick={() => setActiveWorkspaceTab(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {renderWorkspaceContent()}
      </div>
      {renderWorkflowSidebar()}
    </div>
  );

  const renderHubHeader = (
    title: string,
    subtitle: string,
    action?: React.ReactNode,
  ) => (
    <div className={styles.hubHeader}>
      <div>
        <div className={styles.hubTitle}>{title}</div>
        <div className={styles.hubSubtitle}>{subtitle}</div>
      </div>
      <div className={styles.hubHeaderActions}>{action}</div>
    </div>
  );

  const renderProjectSection = () => (
    <div className={styles.hubPage}>
      {renderHubHeader(
        '项目',
        '查看最近生成项目、素材数量和成片状态。',
        <Button loading={hubLoading} onClick={() => setHubRefreshKey(key => key + 1)}>
          刷新
        </Button>,
      )}
      {hubError ? <div className={styles.hubError}>{hubError}</div> : null}
      {desktopProjects?.projects.length ? (
        <div className={styles.projectCards}>
          {desktopProjects.projects.map(project => {
            const isCurrent = project.project_id === effectiveProjectId;
            return (
              <div
                key={project.project_id}
                className={styles.projectCard}
                data-current={isCurrent}
              >
                <div className={styles.projectCardMain}>
                  <div className={styles.projectCardTitle}>
                    {project.project_id}
                  </div>
                  <div className={styles.projectCardMeta}>
                    {getProjectSummaryText(project)}
                  </div>
                  <div className={styles.projectCardMeta}>
                    更新于 {formatHubTime(project.updated_at)}
                  </div>
                </div>
                <div className={styles.projectCardStatus}>
                  {getProjectStatusText(project)}
                </div>
                <div className={styles.projectCardActions}>
                  <Button
                    size="small"
                    type={isCurrent ? 'primary' : 'secondary'}
                    onClick={() => {
                      if (isCurrent) {
                        setActiveAppSection('workspace');
                        return;
                      }
                      handleOpenProjectFolderById(project.project_id);
                    }}
                  >
                    {isCurrent ? '继续编辑' : '打开目录'}
                  </Button>
                  <Button
                    size="small"
                    disabled={!project.storyboard_video_task_count}
                    loading={hubLoading}
                    onClick={() => handleSyncProjectAssets(project.project_id)}
                  >
                    同步视频
                  </Button>
                  <Button
                    size="small"
                    href={resolveBackendUrl(
                      `/v1/assets/projects/${project.project_id}/archive-all`,
                    )}
                  >
                    导出资产
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.hubEmpty}>
          {hubLoading ? '正在读取项目...' : '还没有可读取的项目 manifest。'}
        </div>
      )}
    </div>
  );

  const renderAssetSection = () => (
    <div className={styles.hubPage}>
      {renderHubHeader(
        '资产',
        `当前项目：${effectiveProjectId}`,
        <div className={styles.hubButtonGroup}>
          <Button loading={hubLoading} onClick={() => setHubRefreshKey(key => key + 1)}>
            刷新
          </Button>
          <Button onClick={() => handleOpenProjectFolderById(effectiveProjectId)}>
            打开目录
          </Button>
          <Button
            href={resolveBackendUrl(
              `/v1/assets/projects/${effectiveProjectId}/archive-all`,
            )}
          >
            导出全部
          </Button>
        </div>,
      )}
      {hubError ? <div className={styles.hubError}>{hubError}</div> : null}
      <div className={styles.assetSummary}>
        <div>
          <span>{currentProjectAssets.length}</span>
          <label>全部素材</label>
        </div>
        <div>
          <span>{readyAssetCount}</span>
          <label>已完成</label>
        </div>
        <div>
          <span>{failedAssetCount}</span>
          <label>失败</label>
        </div>
      </div>
      {currentProjectAssets.length ? (
        <div className={styles.assetGroups}>
          {Object.entries(assetGroups).map(([phase, assets]) => (
            <section key={phase} className={styles.assetGroup}>
              <div className={styles.assetGroupHeader}>
                <div className={styles.assetGroupTitle}>
                  {ASSET_PHASE_LABELS[phase] || phase}
                </div>
                <div className={styles.assetGroupMeta}>{assets.length} 项</div>
              </div>
              <div className={styles.assetList}>
                {assets.map(asset => (
                  <div key={asset.asset_id} className={styles.assetItem}>
                    <div className={styles.assetItemMain}>
                      <div className={styles.assetItemTitle}>
                        {asset.filename || asset.asset_id}
                      </div>
                      <div className={styles.assetItemMeta}>
                        #{asset.index + 1} · {asset.status}
                        {asset.updated_at
                          ? ` · ${formatHubTime(asset.updated_at)}`
                          : ''}
                      </div>
                    </div>
                    <div className={styles.assetItemActions}>
                      <Button
                        size="mini"
                        href={resolveBackendUrl(
                          `/v1/assets/projects/${effectiveProjectId}/files/${asset.asset_id}`,
                        )}
                      >
                        下载
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.hubEmpty}>
          {hubLoading ? '正在读取资产...' : '当前项目还没有归档素材。'}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`${styles.appShell} ${isFullScreen ? styles.appShellFullscreen : ''}`}
    >
      {!isFullScreen ? (
        <nav className={styles.appNav} aria-label="视频生成入口">
          <div className={styles.appNavBrand}>历史视频</div>
          <div className={styles.appNavList}>
            {APP_SECTIONS.map(item => (
              <button
                key={item.value}
                type="button"
                className={styles.appNavItem}
                data-active={activeAppSection === item.value}
                onClick={() => setActiveAppSection(item.value)}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
        </nav>
      ) : null}
      <div className={styles.appMain}>
        <div
          className={
            activeAppSection === 'workspace'
              ? styles.appSectionVisible
              : styles.appSectionHidden
          }
        >
          {renderWorkspaceSection()}
        </div>
        {activeAppSection === 'projects' ? renderProjectSection() : null}
        {activeAppSection === 'assets' ? renderAssetSection() : null}
      </div>
      <Modal
        title="上传文案"
        visible={scriptUploadVisible}
        okText="导入文案"
        cancelText="取消"
        onOk={handleConfirmUploadedScript}
        onCancel={() => setScriptUploadVisible(false)}
        style={{ width: 640 }}
      >
        <div className={styles.scriptUploadMeta}>
          <span>{scriptUploadFileName}</span>
          <span>{scriptUploadText.trim().length} 字</span>
        </div>
        <textarea
          className={styles.scriptUploadTextarea}
          value={scriptUploadText}
          onChange={event => setScriptUploadText(event.target.value)}
        />
      </Modal>
      <input
        ref={scriptFileInputRef}
        type="file"
        accept=".txt,.md,.text,text/plain,text/markdown"
        style={{ display: 'none' }}
        onChange={handleScriptFileChange}
      />
      <input
        ref={backgroundFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={referenceUploadLocked || backgroundUploading}
        style={{ display: 'none' }}
        onChange={handleBackgroundFileChange}
      />
      <input
        ref={roleFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={referenceUploadLocked || roleUploading}
        style={{ display: 'none' }}
        onChange={handleRoleFileChange}
      />
    </div>
  );
};

export default Conversation;
