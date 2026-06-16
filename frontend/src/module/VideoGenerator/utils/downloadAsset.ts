import { getDesktopAPI, resolveBackendUrl } from '@/utils/desktopRuntime';
import { Message } from '@arco-design/web-react';

const getFilenameFromDisposition = (contentDisposition: string | null) => {
  if (!contentDisposition) {
    return '';
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return filenameMatch?.[1] || '';
};

const getFilenameFromUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    const filename = parsedUrl.pathname.split('/').filter(Boolean).pop();
    return filename || 'asset';
  } catch {
    return 'asset';
  }
};

export const resolveAssetUrl = (url?: string) => {
  if (!url) {
    return '';
  }
  return resolveBackendUrl(url);
};

export const downloadAsset = async (url?: string) => {
  const resolvedUrl = resolveAssetUrl(url);
  if (!resolvedUrl) {
    Message.warning('素材还未归档，暂时无法下载');
    return;
  }

  try {
    const desktopAPI = getDesktopAPI();
    if (desktopAPI) {
      const result = await desktopAPI.saveUrlAsFile(
        resolvedUrl,
        getFilenameFromUrl(resolvedUrl),
      );
      if (result?.filePath) {
        Message.success('文件已保存');
      }
      return;
    }

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download =
      getFilenameFromDisposition(response.headers.get('Content-Disposition')) ||
      getFilenameFromUrl(resolvedUrl);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
  }
};
