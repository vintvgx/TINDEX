/**
 * Log Service
 * 
 * Captures and stores console logs, warnings, and errors for in-app viewing.
 * Intercepts console methods to capture all log output.
 */

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: any[];
}

class LogService {
  private logs: LogEntry[] = [];
  private maxLogs: number = 100000; // Maximum number of logs to keep
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
    debug: typeof console.debug;
  };

  constructor() {
    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    // Intercept console methods
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Intercept console.log
    console.log = (...args: any[]) => {
      this.addLog('log', args);
      this.originalConsole.log(...args);
    };

    // Intercept console.warn
    console.warn = (...args: any[]) => {
      this.addLog('warn', args);
      this.originalConsole.warn(...args);
    };

    // Intercept console.error
    console.error = (...args: any[]) => {
      this.addLog('error', args);
      this.originalConsole.error(...args);
    };

    // Intercept console.info
    console.info = (...args: any[]) => {
      this.addLog('info', args);
      this.originalConsole.info(...args);
    };

    // Intercept console.debug
    console.debug = (...args: any[]) => {
      this.addLog('debug', args);
      this.originalConsole.debug(...args);
    };
  }

  private addLog(level: LogEntry['level'], args: any[]) {
    try {
      // Format the message
      const message = args
        .map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      // Create log entry
      const logEntry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        level,
        message,
        data: args.length > 1 ? args.slice(1) : undefined,
      };

      // Add to logs array
      this.logs.push(logEntry);

      // Keep only the most recent logs
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
    } catch (error) {
      // Silently fail if logging fails to prevent infinite loops
      this.originalConsole.error('Error in LogService.addLog:', error);
    }
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get log count
   */
  getLogCount(): number {
    return this.logs.length;
  }

  /**
   * Get error count
   */
  getErrorCount(): number {
    return this.logs.filter((log) => log.level === 'error').length;
  }

  /**
   * Get warning count
   */
  getWarningCount(): number {
    return this.logs.filter((log) => log.level === 'warn').length;
  }
}

// Export singleton instance
export const logService = new LogService();

