const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(level = 'INFO') {
    this.level = logLevels[level] || logLevels.INFO;
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };
    return JSON.stringify(logEntry);
  }

  writeToFile(filename, message) {
    const logFile = path.join(logsDir, filename);
    fs.appendFileSync(logFile, message + '\n');
  }

  log(level, message, meta = {}) {
    if (logLevels[level] <= this.level) {
      const formattedMessage = this.formatMessage(level, message, meta);
      console.log(formattedMessage);
      
      // Write to appropriate log file
      const today = new Date().toISOString().split('T')[0];
      this.writeToFile(`${today}.log`, formattedMessage);
      
      if (level === 'ERROR') {
        this.writeToFile('error.log', formattedMessage);
      }
    }
  }

  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }

  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }

  debug(message, meta = {}) {
    this.log('DEBUG', message, meta);
  }
}

module.exports = new Logger(process.env.LOG_LEVEL || 'INFO');