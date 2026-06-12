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

import { useContext, useMemo, useRef, useState } from 'react';

import { Button, Message, Modal, Radio } from '@arco-design/web-react';
import { IconDelete, IconFile, IconImage, IconUpload } from '@arco-design/web-react/icon';

import { IconClean } from '@/images/iconBox';
import { ChatWindowContext } from '@/components/ChatWindowV2/context';
import { WatchAndChat } from '@/module/WatchAndChat';
import { useStartChatWithVideo } from '@/module/WatchAndChat/providers/WatchAndChatProvider/hooks/useStartChatWithVideo';
import documentaryPreview from '@/images/assets/knowledge-style-documentary.svg';
import classroomPreview from '@/images/assets/knowledge-style-classroom.svg';
import museumPreview from '@/images/assets/knowledge-style-museum.svg';
import infographicPreview from '@/images/assets/knowledge-style-infographic.svg';

import { RenderedMessagesContext } from '../../store/RenderedMessages/context';
import styles from './index.module.less';
import ChatArea from '../ChatArea';
import {
  AspectRatio,
  BackgroundReferenceStrength,
  ContentMode,
  KnowledgeStyle,
  ReferenceImage,
  RunningPhaseStatus,
  ScriptMode,
  UserConfirmationDataKey,
  VideoGeneratorMessageType,
  VideoGeneratorTaskPhase,
} from '../../types';
import { usePlaceholderInfo } from './hooks/usePlaceholderInfo';
import { useScrollToBottom } from '../../hooks/useScrollToBottom';
import { Placeholder } from './components/Placeholder';
import { MessageInput } from './components/MessageInput';
import { InjectContext } from '../../store/Inject/context';
import { uploadReferenceImage } from '../../utils/uploadReferenceImage';

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

const WORKFLOW_STEPS = [
  {
    label: '文案',
    phase: VideoGeneratorTaskPhase.PhaseScript,
  },
  {
    label: '分镜脚本',
    phase: VideoGeneratorTaskPhase.PhaseStoryBoard,
  },
  {
    label: '角色',
    phase: VideoGeneratorTaskPhase.PhaseRoleImage,
  },
  {
    label: '分镜画面',
    phase: VideoGeneratorTaskPhase.PhaseFirstFrameImage,
  },
  {
    label: '视频片段',
    phase: VideoGeneratorTaskPhase.PhaseVideo,
  },
  {
    label: '配音',
    phase: VideoGeneratorTaskPhase.PhaseAudio,
  },
  {
    label: '成片',
    phase: VideoGeneratorTaskPhase.PhaseFilm,
  },
];

type ContentOptionsOverrides = {
  contentMode?: ContentMode;
  knowledgeStyle?: KnowledgeStyle;
  knowledgeStylePrompt?: string;
  aspectRatio?: AspectRatio;
  backgroundReference?: ReferenceImage;
  backgroundReferenceStrength?: BackgroundReferenceStrength;
  roleReference?: ReferenceImage;
};

const Conversation = () => {
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
  } =
    useContext(ChatWindowContext);
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
    userConfirmData,
  } =
    useContext(RenderedMessagesContext);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  const roleFileInputRef = useRef<HTMLInputElement>(null);
  const [scriptUploadVisible, setScriptUploadVisible] = useState(false);
  const [scriptUploadFileName, setScriptUploadFileName] = useState('');
  const [scriptUploadText, setScriptUploadText] = useState('');
  const [contentMode, setContentMode] = useState(ContentMode.HistoryKnowledge);
  const [knowledgeStyle, setKnowledgeStyle] = useState(KnowledgeStyle.Documentary);
  const [knowledgeStylePrompt, setKnowledgeStylePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(AspectRatio.Landscape);
  const [backgroundReference, setBackgroundReference] = useState<ReferenceImage>();
  const [roleReference, setRoleReference] = useState<ReferenceImage>();
  const [backgroundReferenceStrength, setBackgroundReferenceStrength] = useState(
    BackgroundReferenceStrength.Strict,
  );
  const [projectId, setProjectId] = useState(() => createProjectId());
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [roleUploading, setRoleUploading] = useState(false);
  const [activeScriptFileName, setActiveScriptFileName] = useState('');
  const [activeScriptTextLength, setActiveScriptTextLength] = useState(0);

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
  const visualSettingsLocked = visualLockPhases.includes(finishPhase as VideoGeneratorTaskPhase);
  const hasUsableMediaUrl = (url?: string) => Boolean(url && url.startsWith('http'));
  const hasGeneratedVisualAssets = Boolean(
    userConfirmData?.[UserConfirmationDataKey.RoleImage]?.some(item =>
      item?.images?.some((url: string) => hasUsableMediaUrl(url)),
    ) ||
      userConfirmData?.[UserConfirmationDataKey.FirstFrameImages]?.some(item =>
        item?.images?.some((url: string) => hasUsableMediaUrl(url)),
      ) ||
      userConfirmData?.[UserConfirmationDataKey.Videos]?.some(item => item?.video_gen_task_id) ||
      userConfirmData?.[UserConfirmationDataKey.Film]?.url,
  );
  const referenceUploadLocked =
    hasGeneratedVisualAssets ||
    (
      runningPhaseStatus === RunningPhaseStatus.Pending &&
      visualLockPhases.includes(runningPhase as VideoGeneratorTaskPhase)
    );

  const { scrollRef: chatMessageListRef, setAutoScroll } = useScrollToBottom(!autoNext);

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
      [VideoGeneratorTaskPhase.PhaseScript, VideoGeneratorTaskPhase.PhaseStoryBoard].includes(
        finishPhase as VideoGeneratorTaskPhase,
      )
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

  const handleScriptFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
      if (text.length > SCRIPT_TEXT_WARN_LENGTH) {
        Message.warning('文案较长，建议确认内容精简后再继续');
      }
      setScriptUploadFileName(file.name);
      setScriptUploadText(text);
      setScriptUploadVisible(true);
    } catch {
      Message.error('文案读取失败，请换一个文本文件重试');
    }
  };

  const validateKnowledgeStylePrompt = (text: string) => {
    if (text.trim().length > KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH) {
      Message.error(`风格提示词不能超过 ${KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH} 字`);
      return false;
    }
    return true;
  };

  const handleBackgroundFile = async (file: File) => {
    if (!file) {
      return;
    }
    if (referenceUploadLocked) {
      Message.warning('当前画面已生成，如需更换背景图请先清空当前对话');
      return;
    }
    if (!BACKGROUND_IMAGE_TYPES.includes(file.type)) {
      Message.error('背景图仅支持 jpg、png、webp');
      return;
    }
    if (file.size > BACKGROUND_IMAGE_MAX_SIZE) {
      Message.error('背景图不能超过 10MB');
      return;
    }
    setBackgroundUploading(true);
    try {
      const { url, object_key } = await uploadReferenceImage(file);
      const nextBackgroundReference = {
        url,
        object_key,
        file_name: file.name,
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

  const handleBackgroundFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await handleBackgroundFile(file);
  };

  const handleRoleFile = async (file: File) => {
    if (referenceUploadLocked) {
      Message.warning('当前角色或画面已生成，如需更换角色参考图请先清空当前对话');
      return;
    }
    if (!BACKGROUND_IMAGE_TYPES.includes(file.type)) {
      Message.error('角色参考图仅支持 jpg、png、webp');
      return;
    }
    if (file.size > BACKGROUND_IMAGE_MAX_SIZE) {
      Message.error('角色参考图不能超过 10MB');
      return;
    }
    setRoleUploading(true);
    try {
      const { url, object_key } = await uploadReferenceImage(file);
      const nextRoleReference = {
        url,
        object_key,
        file_name: file.name,
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

  const handleRoleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
    const nextKnowledgeStylePrompt = overrides.knowledgeStylePrompt ?? knowledgeStylePrompt;
    const nextAspectRatio = overrides.aspectRatio ?? aspectRatio;
    const nextBackgroundReference = Object.prototype.hasOwnProperty.call(overrides, 'backgroundReference')
      ? overrides.backgroundReference
      : backgroundReference;
    const nextRoleReference = Object.prototype.hasOwnProperty.call(overrides, 'roleReference')
      ? overrides.roleReference
      : roleReference;
    const nextBackgroundReferenceStrength = overrides.backgroundReferenceStrength ?? backgroundReferenceStrength;

    if (nextContentMode !== ContentMode.HistoryKnowledge) {
      return {
        project_id: projectId,
        mode: nextContentMode,
        aspect_ratio: nextAspectRatio,
      };
    }

    const trimmedStylePrompt = nextKnowledgeStylePrompt.trim();
    return {
      project_id: projectId,
      mode: nextContentMode,
      style: nextKnowledgeStyle,
      aspect_ratio: nextAspectRatio,
      ...(trimmedStylePrompt ? { style_prompt: trimmedStylePrompt } : {}),
      ...(nextBackgroundReference ? {
        background_reference: nextBackgroundReference,
        background_reference_strength: nextBackgroundReferenceStrength,
      } : {}),
      ...(nextRoleReference ? { role_reference: nextRoleReference } : {}),
    };
  };

  const syncContentOptions = (overrides: ContentOptionsOverrides = {}) => {
    if (!showMessageList && !userConfirmData?.[UserConfirmationDataKey.ContentOptions]) {
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
    if (contentMode === ContentMode.HistoryKnowledge && !validateKnowledgeStylePrompt(knowledgeStylePrompt)) {
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

  const getPlaceHolderProps = () => ({
    chatStarted: showMessageList,
    onQuestionClick: handleSend,
    ...placeholderInfoShow,
  });

  const { visible: isFullScreen } = useStartChatWithVideo();

  const resetWorkflow = () => {
    resetMessages();
    setProjectId(createProjectId());
    setActiveScriptFileName('');
    setActiveScriptTextLength(0);
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

  const handleBackgroundReferenceStrengthChange = (value: BackgroundReferenceStrength) => {
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

  const getStepStatus = (phase: VideoGeneratorTaskPhase) => {
    const finishedIndex = WORKFLOW_STEPS.findIndex(item => item.phase === finishPhase);
    const stepIndex = WORKFLOW_STEPS.findIndex(item => item.phase === phase);

    if (finishedIndex >= stepIndex && finishedIndex !== -1) {
      return '完成';
    }
    if (sending && stepIndex === finishedIndex + 1) {
      return '生成中';
    }
    if (stepIndex === finishedIndex + 1) {
      return '待处理';
    }
    return '未开始';
  };

  const renderProjectSettings = () => (
    <aside className={styles.projectSidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarTitle}>项目设置</div>
        <div className={styles.sidebarMeta}>
          {settingsLocked ? (visualSettingsLocked ? '本次任务已锁定' : '可调整风格和背景图') : '准备阶段'}
        </div>
      </div>
      <div className={styles.settingsSection}>
        <div className={styles.settingsLabel}>内容来源</div>
        <div className={styles.sourceBox}>
          <div className={styles.sourceIcon}><IconFile /></div>
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
          onClick={() => scriptFileInputRef.current?.click()}
        >
          {activeScriptFileName ? '更换文案' : '上传文案'}
        </Button>
      </div>
      {contentMode === ContentMode.HistoryKnowledge ? (
        <>
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>背景参考图</div>
            {backgroundReference?.url ? (
              <div className={styles.backgroundReferenceCard}>
                <img src={backgroundReference.url} />
                <div className={styles.backgroundReferenceInfo}>
                  <div className={styles.backgroundReferenceName}>{backgroundReference.file_name}</div>
                  <div className={styles.backgroundReferenceHint}>角色、场景、色调和时代氛围</div>
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
                onClick={() => backgroundFileInputRef.current?.click()}
              >
                {backgroundUploading ? '上传中...' : '上传背景图'}
              </Button>
            )}
          </div>
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>角色参考图</div>
            {roleReference?.url ? (
              <div className={styles.backgroundReferenceCard}>
                <img src={roleReference.url} />
                <div className={styles.backgroundReferenceInfo}>
                  <div className={styles.backgroundReferenceName}>{roleReference.file_name}</div>
                  <div className={styles.backgroundReferenceHint}>角色外观、服饰、人物质感</div>
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
                onClick={() => roleFileInputRef.current?.click()}
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
	              onChange={event => handleKnowledgeStylePromptChange(event.target.value)}
            />
            <div className={styles.knowledgePromptCount}>
              {knowledgeStylePrompt.trim().length}/{KNOWLEDGE_STYLE_PROMPT_MAX_LENGTH}
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
                    <div className={styles.knowledgeStyleTitle}>{item.label}</div>
                    <div className={styles.knowledgeStyleDesc}>{item.description}</div>
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
        <div className={styles.sidebarMeta}>{finishPhase ? '进行中' : '未开始'}</div>
      </div>
      <div className={styles.workflowList}>
        {WORKFLOW_STEPS.map(item => {
          const status = getStepStatus(item.phase);
          return (
            <div key={item.phase} className={styles.workflowItem}>
              <div className={styles.workflowDot} data-status={status} />
              <div className={styles.workflowContent}>
                <div className={styles.workflowLabel}>{item.label}</div>
                <div className={styles.workflowStatus}>{status}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.workflowFooter}>
        <div className={styles.workflowFooterTitle}>当前阶段</div>
        <div className={styles.workflowFooterValue}>{finishPhase || '等待输入'}</div>
      </div>
    </aside>
  );

  return (
    <div className={`${styles.conversationWrapper} ${isFullScreen ? styles.conversationWrapperFullscreen : ''}`}>
      {renderProjectSettings()}
      <div className={styles.conversationContainer}>
        <div className={styles.workspaceTopbar}>
          <div>
            <div className={styles.workspaceTitle}>视频生成工作台</div>
            <div className={styles.workspaceSubtitle}>
              {contentMode === ContentMode.HistoryKnowledge ? '历史/知识类视频' : '儿童睡前故事'}
            </div>
          </div>
          <div className={styles.workspaceTabs}>
            <button className={styles.workspaceTabActive}>对话</button>
            <button>文案</button>
            <button>分镜</button>
            <button>画面</button>
            <button>成片</button>
          </div>
        </div>
        <div
          className={styles.conversationChatAreaContainer}
          ref={chatMessageListRef}
          onScroll={e => handleScroll(e.currentTarget)}
        >
          <div className="h-full">
            <Placeholder {...(getPlaceHolderProps() as any)} />
            <ChatArea messages={renderedMessages} />
          </div>
        </div>
        {!renderedMessages.find(item => item.type === VideoGeneratorMessageType.Multiple) && !isFullScreen && (
          <div className={styles.conversationInputContainer}>
            <>
              {!finishPhase ||
                ([VideoGeneratorTaskPhase.PhaseScript, VideoGeneratorTaskPhase.PhaseStoryBoard].includes(
                  finishPhase as VideoGeneratorTaskPhase,
                ) && (
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
              placeholder={
                '输入修改要求，例如：把画面改成博物馆展陈风格'
              }
              canSendMessage={!sending}
              sendMessage={handleSend}
              extra={inputValue => LimitIndicator && <LimitIndicator text={inputValue} />}
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
                          scriptFileInputRef.current?.click();
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
      </div>
      {renderWorkflowSidebar()}
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
