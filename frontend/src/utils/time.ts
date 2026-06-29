const normalizeIsoValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  return hasTimezone ? trimmed : `${trimmed}Z`;
};

export const formatLocalDateTime = (
  value?: string,
  fallback = '-',
  options: Intl.DateTimeFormatOptions = {},
) => {
  if (!value) {
    return fallback;
  }
  const date = new Date(normalizeIsoValue(value));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options,
  });
};

export const formatShortLocalDateTime = (value?: string, fallback = '-') =>
  formatLocalDateTime(value, fallback, {
    year: undefined,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: undefined,
  });
