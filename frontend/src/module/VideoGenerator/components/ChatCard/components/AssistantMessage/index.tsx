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

import { useContext, useEffect, useMemo, useState } from 'react';

import { Alert, Button, Message, Modal, Switch } from '@arco-design/web-react';
import { IconEdit, IconRefresh } from '@arco-design/web-react/icon';
import clsx from 'classnames';

import MessageContent from '@/components/Chat/components/MessageItem/components/MessageContent';
import {
  ChatWindowContext,
  type Message as ChatMessage,
} from '@/components/ChatWindowV2/context';
import { responseForTextRiskReplace } from '@/constant';
import DoubaoImg from '@/images/assets/doubao.png';
import { ReactComponent as IconAiBulb } from '@/images/icon_ai_bulb.svg';
import { ReactComponent as IconAiEdit } from '@/images/icon_ai_edit.svg';
import type { Assistant } from '@/types/assistant';

import { BotMessageContext } from '../../../../store/BotMessage/context';
import { RenderedMessagesContext } from '../../../../store/RenderedMessages/context';
import { RunningPhaseStatus, VideoGeneratorTaskPhase } from '../../../../types';
import { UserConfirmationDataKey } from '../../../../types';
import {
  hasStoryboardEnglishLines,
  hideStoryboardEnglishLines,
} from '../../../../utils';
import ColorfulButton from '../../../ColorfulButton';
import { MessageBranchChecker } from '../../../Conversation/components/MessageBranchChecker';
import styles from './index.module.less';

interface AssistantMessageProps extends ChatMessage {
  phase?: string;
}

interface AssistantModelInfo {
  Icon?: string;
  ModelName?: string;
  Name?: string;
  Used?: string[];
}

interface VideoGeneratorAssistantExtra {
  Models?: AssistantModelInfo[];
}

const AssistantMessage = (message: AssistantMessageProps) => {
  const { content, finish_reason, phase } = message;
  const [isLengthExceed, setIsLengthExceed] = useState(false);
  const [isContentFilter, setIsContentFilter] = useState(false);
  const [showStoryboardEnglish, setShowStoryboardEnglish] = useState(false);
  const [storyboardEditVisible, setStoryboardEditVisible] = useState(false);
  const [storyboardDraft, setStoryboardDraft] = useState(content);
  // 通过topMessage的finish 来判断是否可以操作
  const topMessage = useContext(BotMessageContext);
  const { assistantInfo, retryMessage, sending } =
    useContext(ChatWindowContext);
  const {
    correctPhaseText,
    proceedNextPhase,
    runningPhaseStatus,
    updateAutoNext,
    updateConfirmationMessage,
  } = useContext(RenderedMessagesContext);
  const assistantData = assistantInfo as Assistant & {
    Extra?: VideoGeneratorAssistantExtra;
  };
  const findModelInfo = assistantData?.Extra?.Models?.find(
    (item: AssistantModelInfo) => item.Used?.includes(phase ?? ''),
  );
  const modelInfo = {
    displayName: findModelInfo?.Name || '',
    modelName: findModelInfo?.ModelName || '',
    imgSrc: findModelInfo?.Icon || '',
  };
  const nextDisabled =
    sending || runningPhaseStatus === RunningPhaseStatus.Pending;
  const hasHiddenStoryboardEnglish =
    phase === VideoGeneratorTaskPhase.PhaseStoryBoard &&
    hasStoryboardEnglishLines(content);
  const canEditStoryboard =
    phase === VideoGeneratorTaskPhase.PhaseStoryBoard &&
    topMessage.finish &&
    topMessage.isLastMessage;
  const displayContent = useMemo(() => {
    if (isContentFilter) {
      return responseForTextRiskReplace.modelResponse;
    }
    if (hasHiddenStoryboardEnglish && !showStoryboardEnglish) {
      return hideStoryboardEnglishLines(content);
    }
    return content;
  }, [
    content,
    hasHiddenStoryboardEnglish,
    isContentFilter,
    showStoryboardEnglish,
  ]);

  const handleNext = async () => {
    if (nextDisabled) {
      return;
    }
    updateAutoNext(false);
    if (topMessage.phase) {
      proceedNextPhase(topMessage.phase);
    }
  };

  const validateStoryboardDraft = (value: string) => {
    const draft = value.trim();
    if (!draft) {
      return '分镜脚本不能为空';
    }
    if (!draft.includes('phase=StoryBoard')) {
      return '请保留 phase=StoryBoard 前缀';
    }
    if (!/分镜\s*1[：:]/.test(draft)) {
      return '请至少保留“分镜1：”结构';
    }
    if (!/角色[：:]/.test(draft)) {
      return '请保留“角色：”字段';
    }
    if (!/画面[：:]/.test(draft)) {
      return '请保留“画面：”字段';
    }
    if (!/中文台词[：:]/.test(draft)) {
      return '请保留“中文台词：”字段';
    }
    return '';
  };

  const handleOpenStoryboardEditor = () => {
    setStoryboardDraft(content);
    setStoryboardEditVisible(true);
  };

  const handleSaveStoryboard = () => {
    const errorMessage = validateStoryboardDraft(storyboardDraft);
    if (errorMessage) {
      Message.warning(errorMessage);
      return;
    }
    const nextContent = storyboardDraft.trim();
    updateAutoNext(false);
    updateConfirmationMessage({
      [UserConfirmationDataKey.StoryBoards]: nextContent,
    });
    correctPhaseText(VideoGeneratorTaskPhase.PhaseStoryBoard, nextContent);
    setStoryboardEditVisible(false);
    Message.success('分镜脚本已更新，后续角色、画面和视频建议重新生成');
  };

  useEffect(() => {
    if (finish_reason === 'length') {
      setIsLengthExceed(true);
    } else if (finish_reason === 'content_filter') {
      setIsContentFilter(true);
    }
  }, [finish_reason]);

  return (
    <div
      className={clsx(
        `mb-[20px] break-all assistant-message-container bg-white rounded-lg border p-[16px] ${styles.assistantMdBoxContainer}`,
      )}
    >
      <MessageContent message={displayContent} isAnimate={!topMessage.finish} />
      {isLengthExceed ? (
        <Alert
          className="mt-[8px]"
          type="warning"
          content={
            '当前对话前后文信息已达该模型 tokens 数上限，输出文本可能不完整。建议您可以减少输入文本长度'
          }
        />
      ) : null}
      <div className={styles.footWrapper}>
        <div className={styles.operation}>
          {hasHiddenStoryboardEnglish ? (
            <div className={styles.storyboardEnglishToggle}>
              <span>{'英文台词'}</span>
              <Switch
                size="small"
                checked={showStoryboardEnglish}
                onChange={setShowStoryboardEnglish}
              />
            </div>
          ) : null}
          {canEditStoryboard ? (
            <Button
              size="mini"
              type="text"
              className={styles.storyboardEditButton}
              icon={<IconEdit />}
              onClick={handleOpenStoryboardEditor}
            >
              {'编辑分镜脚本'}
            </Button>
          ) : null}
          {topMessage.finish && topMessage.isLastMessage ? (
            <div className={styles.button}>
              <MessageBranchChecker message={message} />
              <IconRefresh
                fontSize={16}
                onClick={retryMessage}
                style={{ cursor: 'pointer' }}
              />
            </div>
          ) : null}
        </div>
        <div className={styles.info}>
          {modelInfo?.modelName ? (
            <div className={styles.model}>
              <img
                src={modelInfo?.imgSrc || DoubaoImg}
                alt={modelInfo?.displayName || '模型'}
              />
              <div className={styles.name}>{modelInfo?.displayName}</div>
            </div>
          ) : null}
        </div>
      </div>
      {topMessage.finish && topMessage.isLastMessage && topMessage.phase ? (
        <ColorfulButton
          className={styles.operateButton}
          mode={nextDisabled ? 'default' : 'active'}
          disabled={nextDisabled}
          onClick={handleNext}
        >
          {topMessage.phase === VideoGeneratorTaskPhase.PhaseScript ? (
            <div className={styles.operateWrapper}>
              <IconAiEdit className={styles.operateIcon} />
              {'生成分镜脚本'}
            </div>
          ) : (
            <div className={styles.operateWrapper}>
              <IconAiBulb className={styles.operateIcon} />
              {'开始生成视频'}
            </div>
          )}
        </ColorfulButton>
      ) : null}
      <Modal
        title="编辑分镜脚本"
        visible={storyboardEditVisible}
        okText="保存修改"
        cancelText="取消"
        className={styles.storyboardEditModal}
        onOk={handleSaveStoryboard}
        onCancel={() => {
          setStoryboardEditVisible(false);
        }}
      >
        <Alert
          type="warning"
          content="保存后会更新当前分镜脚本。已生成的角色、画面和视频不会自动删除，但可能需要按需重新生成。"
        />
        <textarea
          className={styles.storyboardTextarea}
          value={storyboardDraft}
          onChange={event => {
            setStoryboardDraft(event.target.value);
          }}
        />
      </Modal>
    </div>
  );
};

export default AssistantMessage;
