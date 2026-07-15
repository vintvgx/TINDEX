/**
 * Log Service
 * 
 * Captures and stores console logs, warnings, and errors for in-app viewing.
 * Intercepts console methods to capture all log output.
 * Persists logs to file system for persistence across app restarts.
 */

import * as FileSystem from 'expo-file-system';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: any[];
}

/**
 * Serialized log entry format for file storage
 */
interface SerializedLogEntry {
  id: string;
  timestamp: string; // ISO string
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: any[];
}

class LogService {
  private logs: LogEntry[] = [];
  // Was 100,000 — the whole array gets JSON.stringify'd and rewritten to
  // disk on every debounced save, and read back in full on every launch.
  // At 100k entries that read (kicked off from the constructor, before
  // almost anything else has run) can take long enough to widen the
  // startup race window that used to make initialize() silently discard
  // logs (see initialize()). 3,000 is still far more than a debug session
  // needs and keeps that read fast.
  private maxLogs: number = 3000;
  private logFilePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
    debug: typeof console.debug;
  };

  constructor() {
    // Set up log file path in document directory (persistent storage)
    this.logFilePath = `${FileSystem.documentDirectory}app_logs.json`;

    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    // Initialize file persistence (load existing logs)
    this.initializationPromise = this.initialize();

    // Intercept console methods
    this.setupInterceptors();

    // Proof-of-life entry, written directly to the in-memory array —
    // deliberately bypassing console.* entirely. If this line never shows
    // up in the Log Viewer, the bug is upstream of console interception
    // (the modal isn't reading this same singleton instance, or the
    // array/render path itself is broken) rather than in setupInterceptors().
    // If it DOES show up but nothing else does, console.log/warn/error/info/
    // debug calls genuinely aren't reaching addLog() — see setupInterceptors.
    this.addLog('info', ['[LogService] singleton constructed']);
  }

  /**
   * Initialize the log service by loading existing logs from file
   */
  private async initialize(): Promise<void> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(this.logFilePath);

      if (fileInfo.exists) {
        const fileContent = await FileSystem.readAsStringAsync(this.logFilePath);
        const serializedLogs: SerializedLogEntry[] = JSON.parse(fileContent);

        // Deserialize logs (convert ISO strings back to Date objects)
        const loadedLogs = serializedLogs.map((log) => ({
          ...log,
          timestamp: new Date(log.timestamp),
        }));

        // MERGE, do not replace: getInfoAsync + readAsStringAsync are async
        // bridge calls, and console.log/warn/error calls made anywhere in
        // the app during this window (which can genuinely take a while once
        // the persisted file has grown large — see maxLogs) were already
        // pushed onto this.logs by addLog(). Overwriting this.logs here, as
        // this used to do, silently discarded every one of those — which on
        // a real device is most of the app's startup logging, since this
        // read is kicked off from the constructor before almost anything
        // else has had a chance to run.
        this.logs = [...loadedLogs, ...this.logs];

        // Ensure we don't exceed maxLogs
        if (this.logs.length > this.maxLogs) {
          this.logs = this.logs.slice(-this.maxLogs);
          // Save the trimmed logs back to file
          await this.saveLogsToFile();
        }
      }
    } catch (error) {
      // If the file doesn't exist or is corrupted, just skip loading history —
      // do NOT reset this.logs to [] here, that would wipe out everything
      // captured since construction for the same reason overwriting did above.
      // Silently fail to prevent breaking app initialization
      this.originalConsole.error('Error initializing LogService from file:', error);
    } finally {
      this.isInitialized = true;
    }
  }

  /**
   * Serialize logs for file storage
   */
  private serializeLogs(): SerializedLogEntry[] {
    return this.logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      level: log.level,
      message: log.message,
      data: log.data,
    }));
  }

  /**
   * Save logs to file (with debouncing for performance)
   */
  private async saveLogsToFile(): Promise<void> {
    try {
      const serializedLogs = this.serializeLogs();
      const jsonContent = JSON.stringify(serializedLogs, null, 2);
      await FileSystem.writeAsStringAsync(this.logFilePath, jsonContent);
    } catch (error) {
      // Silently fail to prevent infinite loops
      this.originalConsole.error('Error saving logs to file:', error);
    }
  }

  /**
   * Debounced save to file (waits 1 second after last log addition)
   */
  private scheduleSave(): void {
    // Clear existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Schedule save after 1 second of inactivity
    this.saveTimeout = setTimeout(() => {
      this.saveLogsToFile();
      this.saveTimeout = null;
    }, 1000);
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

      // Schedule save to file (debounced)
      if (this.isInitialized) {
        this.scheduleSave();
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
   * Clear all logs (also clears file)
   */
  async clearLogs(): Promise<void> {
    this.logs = [];
    
    // Clear the save timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    // Clear the file
    try {
      const fileInfo = await FileSystem.getInfoAsync(this.logFilePath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(this.logFilePath, { idempotent: true });
      }
    } catch (error) {
      // Silently fail
      this.originalConsole.error('Error clearing log file:', error);
    }
  }

  /**
   * Ensure logs are saved to file (useful before app close)
   */
  async flushLogs(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.saveLogsToFile();
  }

  /**
   * Wait for initialization to complete (useful for testing or ensuring logs are loaded)
   */
  async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
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

