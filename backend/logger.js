function ts() {
  return new Date().toISOString();
}

function format(level, args) {
  const prefix = `[${ts()}] [${level}]`;
  return [prefix, ...args];
}

const logger = {
  info: (...args) => console.log(...format('INFO', args)),
  warn: (...args) => console.warn(...format('WARN', args)),
  error: (...args) => console.error(...format('ERROR', args)),
  debug: (...args) => console.debug(...format('DEBUG', args)),
};

module.exports = logger;
