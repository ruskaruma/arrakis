export interface LogContext {
  storeId?: string;
  namespace?: string;
  [key: string]: unknown;
}

function emit(level: string, event: string, message: string, ctx?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...ctx,
  };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export const log = {
  info: (event: string, msg: string, ctx?: LogContext) => emit('info', event, msg, ctx),
  warn: (event: string, msg: string, ctx?: LogContext) => emit('warn', event, msg, ctx),
  error: (event: string, msg: string, ctx?: LogContext) => emit('error', event, msg, ctx),
};
