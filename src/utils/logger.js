const LOG_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

/**
 * Ẩn tự động mọi chuỗi giống Discord Token hoặc GitHub Token nếu vô tình xuất hiện trong thông báo lỗi.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g, '[REDACTED_DISCORD_TOKEN]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]');
}

function getCurrentThreshold() {
  const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LOG_PRIORITY[envLevel] ?? LOG_PRIORITY.info;
}

function formatMessage(level, scope, message, meta) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;
  const cleanMsg = redactSecrets(message);

  if (meta === undefined) {
    return `${prefix} ${cleanMsg}`;
  }

  let metaStr = '';
  if (meta instanceof Error) {
    metaStr = ` | ${redactSecrets(meta.stack || meta.message)}`;
  } else if (typeof meta === 'object' && meta !== null) {
    try {
      metaStr = ` | ${redactSecrets(JSON.stringify(meta))}`;
    } catch {
      metaStr = ' | [Unserializable Object]';
    }
  } else {
    metaStr = ` | ${redactSecrets(String(meta))}`;
  }

  return `${prefix} ${cleanMsg}${metaStr}`;
}

export const logger = {
  debug(scope, message, meta) {
    if (getCurrentThreshold() <= LOG_PRIORITY.debug) {
      console.debug(formatMessage('debug', scope, message, meta));
    }
  },
  info(scope, message, meta) {
    if (getCurrentThreshold() <= LOG_PRIORITY.info) {
      console.info(formatMessage('info', scope, message, meta));
    }
  },
  warn(scope, message, meta) {
    if (getCurrentThreshold() <= LOG_PRIORITY.warn) {
      console.warn(formatMessage('warn', scope, message, meta));
    }
  },
  error(scope, message, meta) {
    if (getCurrentThreshold() <= LOG_PRIORITY.error) {
      console.error(formatMessage('error', scope, message, meta));
    }
  },
};
