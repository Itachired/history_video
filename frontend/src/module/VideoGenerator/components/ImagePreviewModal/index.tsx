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

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { IconClose } from '@arco-design/web-react/icon';

import styles from './index.module.less';

interface ImagePreviewModalProps {
  open: boolean;
  src?: string;
  title?: string;
  onClose: () => void;
}

const ImagePreviewModal = ({
  open,
  src,
  title,
  onClose,
}: ImagePreviewModalProps) => {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !src) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title || '图片预览'}
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-label="关闭图片预览"
        onClick={onClose}
      />
      <button
        type="button"
        className={styles.closeButton}
        aria-label="关闭图片预览"
        onClick={onClose}
      >
        <IconClose />
      </button>
      <img src={src} alt={title || '图片预览'} className={styles.image} />
    </div>,
    document.body,
  );
};

export default ImagePreviewModal;
