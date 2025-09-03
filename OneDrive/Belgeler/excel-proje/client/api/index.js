import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import multer from 'multer';
import sql from 'mssql';
import pg from 'pg';
import mysql from 'mysql2/promise';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// CORS ayarları
app.use(cors({
  origin: ['http://localhost:5173', 'https://excelproje1.vercel.app', 'https://excelproje1-git-main-cerenmencutekins-projects.vercel.app'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Veritabanı konfigürasyonları
const MSSQL_CONFIG = {
  server: process.env.MSSQL_SERVER || 'localhost',
  database: process.env.MSSQL_DATABASE || 'ExcelDemo',
  user: process.env.MSSQL_USER || 'appuser',
  password: process.env.MSSQL_PASSWORD || '9876.',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const POSTGRES_CONFIG = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DATABASE || 'ExcelDemoPG',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '1234'
};

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  database: process.env.MYSQL_DATABASE || 'ExcelDemoMySQL',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '1234'
};

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend API çalışıyor!', timestamp: new Date().toISOString() });
});

// Sütun analizi endpoint'i
app.post('/api/analyze-columns', (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const columns = Object.keys(data[0]);
    const analysis = {};

    columns.forEach(column => {
      const values = data.map(row => row[column]).filter(val => val !== null && val !== undefined && val !== '');
      const sampleValues = values.slice(0, 5);
      
      let type = 'string';
      let confidence = 0;
      let nullPercentage = ((data.length - values.length) / data.length) * 100;
      
      // Tip analizi
      if (values.length > 0) {
        const firstValue = values[0];
        
        // Sayı kontrolü
        if (!isNaN(firstValue) && firstValue !== '') {
          type = 'number';
          confidence = 90;
        }
        // Tarih kontrolü
        else if (!isNaN(Date.parse(firstValue))) {
          type = 'date';
          confidence = 85;
        }
        // Boolean kontrolü
        else if (['true', 'false', '1', '0'].includes(String(firstValue).toLowerCase())) {
          type = 'boolean';
          confidence = 80;
        }
        else {
          type = 'string';
          confidence = 95;
        }
      }

      analysis[column] = {
        type,
        confidence,
        nullPercentage: Math.round(nullPercentage * 100) / 100,
        sampleValues,
        description: getTypeDescription(type)
      };
    });

    res.json({ analysis });
  } catch (error) {
    console.error('Sütun analizi hatası:', error);
    res.status(500).json({ error: 'Sütun analizi sırasında hata oluştu' });
  }
});

// Veri dönüştürme endpoint'i
app.post('/api/transform-data', (req, res) => {
  try {
    const { data, transformations } = req.body;
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const transformedData = data.map(row => {
      const newRow = { ...row };
      
      Object.keys(transformations).forEach(column => {
        const rules = transformations[column];
        
        rules.forEach(rule => {
          const value = newRow[column];
          
          switch (rule.type) {
            case 'TRIM':
              if (typeof value === 'string') {
                newRow[column] = value.trim();
              }
              break;
            case 'UPPER':
              if (typeof value === 'string') {
                newRow[column] = value.toUpperCase();
              }
              break;
            case 'LOWER':
              if (typeof value === 'string') {
                newRow[column] = value.toLowerCase();
              }
              break;
            case 'DATE_FORMAT':
              if (value && !isNaN(Date.parse(value))) {
                const date = new Date(value);
                newRow[column] = date.toISOString().split('T')[0];
              }
              break;
            case 'CONSTANT':
              newRow[column] = rule.value;
              break;
          }
        });
      });
      
      return newRow;
    });

    res.json({ transformedData });
  } catch (error) {
    console.error('Veri dönüştürme hatası:', error);
    res.status(500).json({ error: 'Veri dönüştürme sırasında hata oluştu' });
  }
});

// Excel export endpoint'i
app.post('/api/export-excel', (req, res) => {
  try {
    const { data, filename = 'exported_data.xlsx' } = req.body;
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Excel export hatası:', error);
    res.status(500).json({ error: 'Excel export sırasında hata oluştu' });
  }
});

// MSSQL kaydetme endpoint'i
app.post('/api/save', async (req, res) => {
  try {
    const { data, tableName, createTable = false } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const pool = await sql.connect(MSSQL_CONFIG);
    
    if (createTable) {
      const columns = Object.keys(data[0]);
      const createTableSQL = `CREATE TABLE ${tableName} (${columns.map(col => `[${col}] NVARCHAR(MAX)`).join(', ')})`;
      await pool.request().query(createTableSQL);
    }

    const columns = Object.keys(data[0]);
    const insertSQL = `INSERT INTO ${tableName} (${columns.map(col => `[${col}]`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    
    for (const row of data) {
      await pool.request()
        .input('values', sql.NVarChar, Object.values(row))
        .query(insertSQL.replace(/\?/g, '@values'));
    }

    await pool.close();
    res.json({ message: `${data.length} satır başarıyla kaydedildi` });
  } catch (error) {
    console.error('MSSQL kaydetme hatası:', error);
    res.status(500).json({ error: 'Veritabanına kaydetme sırasında hata oluştu' });
  }
});

// PostgreSQL kaydetme endpoint'i
app.post('/api/save-pg', async (req, res) => {
  try {
    const { data, tableName, createTable = false } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const client = new pg.Client(POSTGRES_CONFIG);
    await client.connect();
    
    if (createTable) {
      const columns = Object.keys(data[0]);
      const createTableSQL = `CREATE TABLE ${tableName} (${columns.map(col => `"${col}" TEXT`).join(', ')})`;
      await client.query(createTableSQL);
    }

    const columns = Object.keys(data[0]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const insertSQL = `INSERT INTO ${tableName} (${columns.map(col => `"${col}"`).join(', ')}) VALUES (${placeholders})`;
    
    for (const row of data) {
      await client.query(insertSQL, Object.values(row));
    }

    await client.end();
    res.json({ message: `${data.length} satır başarıyla kaydedildi` });
  } catch (error) {
    console.error('PostgreSQL kaydetme hatası:', error);
    res.status(500).json({ error: 'Veritabanına kaydetme sırasında hata oluştu' });
  }
});

// MySQL kaydetme endpoint'i
app.post('/api/save-mysql', async (req, res) => {
  try {
    const { data, tableName, createTable = false } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const connection = await mysql.createConnection(MYSQL_CONFIG);
    
    if (createTable) {
      const columns = Object.keys(data[0]);
      const createTableSQL = `CREATE TABLE ${tableName} (${columns.map(col => `\`${col}\` TEXT`).join(', ')})`;
      await connection.execute(createTableSQL);
    }

    const columns = Object.keys(data[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const insertSQL = `INSERT INTO ${tableName} (${columns.map(col => `\`${col}\``).join(', ')}) VALUES (${placeholders})`;
    
    for (const row of data) {
      await connection.execute(insertSQL, Object.values(row));
    }

    await connection.end();
    res.json({ message: `${data.length} satır başarıyla kaydedildi` });
  } catch (error) {
    console.error('MySQL kaydetme hatası:', error);
    res.status(500).json({ error: 'Veritabanına kaydetme sırasında hata oluştu' });
  }
});

// SQLite kaydetme endpoint'i
app.post('/api/save-sqlite', async (req, res) => {
  try {
    const { data, tableName, createTable = false } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Geçerli veri bulunamadı' });
    }

    const db = new sqlite3.Database('./data.sqlite');
    
    return new Promise((resolve, reject) => {
      if (createTable) {
        const columns = Object.keys(data[0]);
        const createTableSQL = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.map(col => `"${col}" TEXT`).join(', ')})`;
        db.run(createTableSQL, (err) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }
          
          const columns = Object.keys(data[0]);
          const placeholders = columns.map(() => '?').join(', ');
          const insertSQL = `INSERT INTO ${tableName} (${columns.map(col => `"${col}"`).join(', ')}) VALUES (${placeholders})`;
          
          let completed = 0;
          for (const row of data) {
            db.run(insertSQL, Object.values(row), (err) => {
              if (err) {
                db.close();
                reject(err);
                return;
              }
              completed++;
              if (completed === data.length) {
                db.close();
                resolve();
              }
            });
          }
        });
      } else {
        const columns = Object.keys(data[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insertSQL = `INSERT INTO ${tableName} (${columns.map(col => `"${col}"`).join(', ')}) VALUES (${placeholders})`;
        
        let completed = 0;
        for (const row of data) {
          db.run(insertSQL, Object.values(row), (err) => {
            if (err) {
              db.close();
              reject(err);
              return;
            }
            completed++;
            if (completed === data.length) {
              db.close();
              resolve();
            }
          });
        }
      }
    }).then(() => {
      res.json({ message: `${data.length} satır başarıyla kaydedildi` });
    }).catch((error) => {
      console.error('SQLite kaydetme hatası:', error);
      res.status(500).json({ error: 'Veritabanına kaydetme sırasında hata oluştu' });
    });
  } catch (error) {
    console.error('SQLite kaydetme hatası:', error);
    res.status(500).json({ error: 'Veritabanına kaydetme sırasında hata oluştu' });
  }
});

// Yardımcı fonksiyonlar
function getTypeDescription(type) {
  const descriptions = {
    'string': 'Metin verisi',
    'number': 'Sayısal veri',
    'date': 'Tarih verisi',
    'boolean': 'Mantıksal veri (true/false)'
  };
  return descriptions[type] || 'Bilinmeyen veri tipi';
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

export default app;
