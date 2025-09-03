// server/logger.js - Gelişmiş Log Sistemi

const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  getClientIP(req) {
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.connection.socket?.remoteAddress || 
           'unknown';
  }

  formatLogEntry(level, message, req = null, data = null) {
    const timestamp = this.getTimestamp();
    const ip = req ? this.getClientIP(req) : 'system';
    const userAgent = req ? req.get('User-Agent') || 'unknown' : 'system';
    
    const entry = {
      timestamp,
      level,
      message,
      ip,
      userAgent,
      data: data || null
    };

    return JSON.stringify(entry);
  }

  writeToFile(filename, content) {
    const filePath = path.join(this.logDir, filename);
    fs.appendFileSync(filePath, content + '\n');
  }

  log(level, message, req = null, data = null) {
    const entry = this.formatLogEntry(level, message, req, data);
    
    // Console'a yazdır
    console.log(`[${level.toUpperCase()}] ${message}`);
    
    // Dosyaya yazdır
    const today = new Date().toISOString().split('T')[0];
    this.writeToFile(`${today}.log`, entry);
    
    // Hata logları için ayrı dosya
    if (level === 'error') {
      this.writeToFile(`${today}_errors.log`, entry);
    }
  }

  info(message, req = null, data = null) {
    this.log('info', message, req, data);
  }

  success(message, req = null, data = null) {
    this.log('success', message, req, data);
  }

  warning(message, req = null, data = null) {
    this.log('warning', message, req, data);
  }

  error(message, req = null, data = null) {
    this.log('error', message, req, data);
  }

  // Analiz raporları için özel log
  analysis(operation, results, req = null) {
    const message = `Analiz tamamlandı: ${operation}`;
    const data = {
      operation,
      results,
      summary: {
        totalRows: results.totalRows || 0,
        totalColumns: results.totalColumns || 0,
        qualityScore: results.qualityScore || 0
      }
    };
    
    this.log('analysis', message, req, data);
  }

  // Veri dönüştürme raporları
  transformation(operation, before, after, req = null) {
    const message = `Veri dönüştürme: ${operation}`;
    const data = {
      operation,
      before: {
        rows: before.length,
        columns: before.length > 0 ? Object.keys(before[0]).length : 0
      },
      after: {
        rows: after.length,
        columns: after.length > 0 ? Object.keys(after[0]).length : 0
      },
      changes: {
        rowsChanged: before.length - after.length,
        columnsChanged: before.length > 0 && after.length > 0 ? 
          Object.keys(before[0]).length - Object.keys(after[0]).length : 0
      }
    };
    
    this.log('transformation', message, req, data);
  }

  // Validation raporları
  validation(operation, results, req = null) {
    const message = `Doğrulama: ${operation}`;
    const data = {
      operation,
      results,
      summary: {
        totalRows: results.totalRows || 0,
        validRows: results.validRows || 0,
        invalidRows: results.invalidRows || 0,
        totalErrors: results.totalErrors || 0,
        qualityScore: results.qualityScore || 0
      }
    };
    
    this.log('validation', message, req, data);
  }

  // Kullanıcı işlemleri
  userAction(action, details, req = null) {
    const message = `Kullanıcı işlemi: ${action}`;
    this.log('user', message, req, { action, details });
  }

  // Sistem işlemleri
  systemAction(action, details) {
    const message = `Sistem işlemi: ${action}`;
    this.log('system', message, null, { action, details });
  }

  // Log dosyalarını listele
  getLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir);
      return files.filter(file => file.endsWith('.log'));
    } catch (error) {
      return [];
    }
  }

  // Belirli bir tarihin loglarını oku
  getLogsByDate(date) {
    try {
      const filePath = path.join(this.logDir, `${date}.log`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  // Son N log kaydını getir
  getRecentLogs(limit = 100) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const filePath = path.join(this.logDir, `${today}.log`);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        
        return lines.slice(-limit);
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  // Log istatistikleri
  getLogStats() {
    try {
      const files = this.getLogFiles();
      const stats = {
        totalFiles: files.length,
        totalLogs: 0,
        byLevel: {},
        byDate: {}
      };

      files.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        stats.totalLogs += lines.length;
        
        lines.forEach(line => {
          try {
            const log = JSON.parse(line);
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            
            const date = log.timestamp.split('T')[0];
            stats.byDate[date] = (stats.byDate[date] || 0) + 1;
          } catch (e) {
            // Skip invalid JSON
          }
        });
      });

      return stats;
    } catch (error) {
      return { totalFiles: 0, totalLogs: 0, byLevel: {}, byDate: {} };
    }
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;

