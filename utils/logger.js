import {createLogger, transports, format} from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({timestamp, level, message, label}) => {
      return `[${timestamp}] [${level.toUpperCase()}]${label ? ` [${label}]` : ''}: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({filename: 'logs/error.log', level: 'error'}),
    new transports.File({filename: 'logs/combined.log'})
  ]
});

export default logger;
