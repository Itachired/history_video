export const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:8889';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const isDesktopRuntime = () =>
  typeof window !== 'undefined' && Boolean(window.desktopAPI);

export const getBackendOrigin = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_BACKEND_ORIGIN;
  }
  return trimTrailingSlash(
    window.desktopAPI?.runtimeInfo?.backendOrigin || DEFAULT_BACKEND_ORIGIN,
  );
};

export const resolveBackendUrl = (pathOrUrl: string) => {
  if (!pathOrUrl) {
    return '';
  }
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }
  return `${getBackendOrigin()}${
    pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  }`;
};

export const getBotCompletionUrl = () =>
  resolveBackendUrl('/api/v3/bots/chat/completions');

export const getDesktopAPI = () =>
  typeof window === 'undefined' ? undefined : window.desktopAPI;
