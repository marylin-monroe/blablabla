import winston from 'winston';
import path from 'path';
import fs from 'fs';

export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME;
    
    // Only create logs directory in development
    if (!isProduction && !isRender) {
      const logsDir = './logs';
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
    }

    // 🔧 ИСПРАВЛЕНО: Упрощенный формат для production/Render
    const productionFormat = winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        const levelSymbol = this.getLevelSymbol(level);
        const logMessage = stack || message;
        return `${levelSymbol} ${timestamp} ${logMessage}`;
      })
    );

    // Development format - detailed with colors
    const developmentFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        const logMessage = stack || message;
        return `${timestamp} [${level}] ${logMessage}`;
      })
    );

    // 🔧 ИСПРАВЛЕНО: Упрощенная конфигурация транспортов
    const transports: winston.transport[] = [];

    if (isProduction || isRender) {
      // 🚀 PRODUCTION/RENDER: Только консоль с упрощенным форматом
      transports.push(
        new winston.transports.Console({
          format: productionFormat,
          handleExceptions: true,
          handleRejections: true
        })
      );
    } else {
      // 🛠️ DEVELOPMENT: Консоль + файлы
      transports.push(
        new winston.transports.Console({
          format: developmentFormat,
          handleExceptions: true,
          handleRejections: true
        }),
        new winston.transports.File({
          filename: path.join('./logs', 'error.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          ),
          handleExceptions: true
        }),
        new winston.transports.File({
          filename: path.join('./logs', 'combined.log'),
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          )
        })
      );
    }

    // 🔧 ИСПРАВЛЕНО: Создаем логгер с явными транспортами
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'), // 🔧 В продакшене тоже info
      format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.splat()
      ),
      transports,
      exitOnError: false,
      silent: false // 🔧 ВАЖНО: Явно указываем что не молчим
    });

    // 🔧 ИСПРАВЛЕНО: Принудительно добавляем консоль если нет транспортов
    if (this.logger.transports.length === 0) {
      console.warn('⚠️ No transports found, adding Console transport');
      this.logger.add(new winston.transports.Console({
        format: productionFormat,
        handleExceptions: true,
        handleRejections: true
      }));
    }

    // 🔧 ИСПРАВЛЕНО: Тест логгера при инициализации
    this.testLogger();
  }

  private testLogger(): void {
    try {
      // Проверяем что логгер работает
      this.logger.info('🧪 Logger initialized successfully');
    } catch (error) {
      // Fallback на console если winston не работает
      console.log('⚠️ Winston logger failed, using console fallback:', error);
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
    try {
      // 🔧 ИСПРАВЛЕНО: В production фильтруем только откровенно debug сообщения
      if (process.env.NODE_ENV === 'production' && this.isVerboseDebugMessage(message)) {
        return;
      }
      this.logger.info(message, ...meta);
    } catch (error) {
      // Fallback на console
      console.log('ℹ️', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  error(message: string, ...meta: any[]): void {
    try {
      this.logger.error(message, ...meta);
    } catch (error) {
      // Fallback на console
      console.error('❌', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  warn(message: string, ...meta: any[]): void {
    try {
      this.logger.warn(message, ...meta);
    } catch (error) {
      // Fallback на console
      console.warn('⚠️', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  debug(message: string, ...meta: any[]): void {
    try {
      // 🔧 ИСПРАВЛЕНО: debug логи только в development
      if (process.env.NODE_ENV !== 'production') {
        this.logger.debug(message, ...meta);
      }
    } catch (error) {
      // В development показываем debug через console
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔧', new Date().toLocaleTimeString(), message, ...meta);
      }
    }
  }

  // 🔧 ИСПРАВЛЕНО: Более строгая фильтрация - только самые verbose сообщения
  private isVerboseDebugMessage(message: string): boolean {
    const verbosePatterns = [
      /🐛 DEBUGGING/,
      /🐛 Param \d+:/,
      /🐛 Processing wallet:/,
      /🐛 wallet\.address:/,
      /🐛 config:/,
      /🔧 Debug:/,
      /Detailed analysis/,
      /Cache hit for/,
      /Cache miss for/
    ];
    
    return verbosePatterns.some(pattern => pattern.test(message));
  }

  // Critical logs that should always appear
  critical(message: string, ...meta: any[]): void {
    try {
      this.logger.error(`🚨 CRITICAL: ${message}`, ...meta);
    } catch (error) {
      console.error('🚨 CRITICAL:', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  // System logs for startup/infrastructure
  system(message: string, ...meta: any[]): void {
    try {
      this.logger.info(`🚀 SYSTEM: ${message}`, ...meta);
    } catch (error) {
      console.log('🚀 SYSTEM:', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  // 🆕 НОВЫЙ МЕТОД: Для важных операционных логов
  operation(message: string, ...meta: any[]): void {
    try {
      this.logger.info(`⚙️ ${message}`, ...meta);
    } catch (error) {
      console.log('⚙️', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  // 🆕 НОВЫЙ МЕТОД: Для производительности и метрик
  performance(message: string, ...meta: any[]): void {
    try {
      // Показываем метрики производительности даже в production
      this.logger.info(`📊 ${message}`, ...meta);
    } catch (error) {
      console.log('📊', new Date().toLocaleTimeString(), message, ...meta);
    }
  }

  // 🆕 НОВЫЙ МЕТОД: Для получения статистики логгера
  getLoggerInfo(): any {
    return {
      level: this.logger.level,
      transportsCount: this.logger.transports.length,
      transports: this.logger.transports.map(t => t.constructor.name),
      isProduction: process.env.NODE_ENV === 'production',
      isRender: !!(process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME)
    };
  }
}