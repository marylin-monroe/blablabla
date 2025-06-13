import winston from 'winston';
import path from 'path';
import fs from 'fs';

export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Only create logs directory in development
    if (!isProduction) {
      const logsDir = './logs';
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
    }

    // Production format - clean and concise
    const productionFormat = winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp }) => {
        const levelSymbol = this.getLevelSymbol(level);
        return `${levelSymbol} ${timestamp} ${message}`;
      })
    );

    // Development format - detailed with colors
    const developmentFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} [${level}] ${message}`;
      })
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info'),
      format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.splat()
      ),
      transports: isProduction ? [
        // Production: only console output, no file logging
        new winston.transports.Console({
          format: productionFormat,
          silent: false
        })
      ] : [
        // Development: console + file logging
        new winston.transports.Console({
          format: developmentFormat
        }),
        new winston.transports.File({
          filename: path.join('./logs', 'error.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        }),
        new winston.transports.File({
          filename: path.join('./logs', 'combined.log'),
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      ]
    });

    // Add production-specific optimizations
    if (isProduction) {
      // Reduce log buffer to prevent memory issues
      this.logger.configure({
        exitOnError: false,
        silent: false
      });
    }
  }

  private getLevelSymbol(level: string): string {
    const symbols: { [key: string]: string } = {
      'error': '❌',
      'warn': '⚠️',
      'info': 'ℹ️',
      'debug': '🔧',
      'verbose': '📝'
    };
    return symbols[level] || 'ℹ️';
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  info(message: string, ...meta: any[]): void {
    // In production, filter out debug-like messages to reduce noise
    if (process.env.NODE_ENV === 'production' && this.isDebugMessage(message)) {
      return;
    }
    this.logger.info(message, ...meta);
  }

  error(message: string, ...meta: any[]): void {
    this.logger.error(message, ...meta);
  }

  warn(message: string, ...meta: any[]): void {
    this.logger.warn(message, ...meta);
  }

  debug(message: string, ...meta: any[]): void {
    // Only log debug in development
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(message, ...meta);
    }
  }

  // Helper method to identify debug-like messages
  private isDebugMessage(message: string): boolean {
    const debugPatterns = [
      /🐛 DEBUGGING/,
      /🐛 Param \d+:/,
      /🐛 Processing wallet:/,
      /🐛 wallet\.address:/,
      /🐛 config:/
    ];
    
    return debugPatterns.some(pattern => pattern.test(message));
  }

  // New method for critical logs that should always appear
  critical(message: string, ...meta: any[]): void {
    this.logger.error(`🚨 CRITICAL: ${message}`, ...meta);
  }

  // New method for startup/system logs
  system(message: string, ...meta: any[]): void {
    this.logger.info(`🚀 SYSTEM: ${message}`, ...meta);
  }
}