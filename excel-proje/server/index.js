// server/index.js — Excel → DB (MSSQL)  |  dosya/sayfa/batch etiketli kayıt
const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");

// MSSQL
const sql = require("mssql");

// PostgreSQL
const { Pool } = require("pg");

// MySQL
const mysql = require("mysql2");

// SQLite
const Database = require("better-sqlite3");

// Oracle
const oracledb = require("oracledb");

// ======= MSSQL AYARLARI (kendine göre) =======
const MSSQL_ENABLED  = true;
const MSSQL_SERVER   = "localhost";          // SQLEXPRESS ise: "localhost\\SQLEXPRESS"
const MSSQL_DATABASE = "ExcelDemo";
const MSSQL_USER     = "appuser";
const MSSQL_PASSWORD = "9876.";
// =============================================

// ======= POSTGRESQL AYARLARI =======

const POSTGRES_ENABLED = true;
const POSTGRES_HOST = "localhost";
const POSTGRES_PORT = 5432;
const POSTGRES_DATABASE = "ExcelDemoPG";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "1234";
// =============================================

// ======= MYSQL AYARLARI =======
const MYSQL_ENABLED = true;
const MYSQL_HOST = "localhost";
const MYSQL_PORT = 3306;
const MYSQL_DATABASE = "ExcelDemoMySQL";
const MYSQL_USER = "root";
const MYSQL_PASSWORD = "1234";
// =============================================

// ======= SQLITE AYARLARI =======
const SQLITE_ENABLED = true;
const SQLITE_DATABASE = "./excel_demo.sqlite";
// =============================================

// ======= ORACLE AYARLARI =======
const ORACLE_ENABLED = false;
const ORACLE_HOST = "localhost";
const ORACLE_PORT = 1521;
const ORACLE_SERVICE = "XEPDB1";
const ORACLE_USER = "system";
const ORACLE_PASSWORD = "password";
// =============================================

// ---------- Yardımcı Fonksiyonlar ----------
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50);
}

function yyyymmdd_HHmmss(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function getAllKeys(rows) {
  const keys = new Set();
  rows.forEach(row => {
    if (typeof row === 'object' && row !== null) {
      Object.keys(row).forEach(key => keys.add(key));
    }
  });
  return Array.from(keys);
}

// ---------- MSSQL Tablo Yönetimi ----------
async function ensureBatchUploadsTable(pool) {
      await pool.request().query(`
      IF OBJECT_ID('dbo.BatchUploads','U') IS NULL
      BEGIN
        CREATE TABLE dbo.BatchUploads(
          Id             INT IDENTITY(1,1) PRIMARY KEY,
          TableName      NVARCHAR(255) NOT NULL,
          OriginalFileName NVARCHAR(255) NOT NULL,
          [RowCount]     INT NOT NULL,
          CreatedAt      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IX_BatchUploads_CreatedAt ON dbo.BatchUploads(CreatedAt DESC);
        CREATE INDEX IX_BatchUploads_FileName ON dbo.BatchUploads(OriginalFileName);
      END
    `);
}

async function ensureDynamicTable(pool, tableName, columns) {
  const columnDefs = columns.map(col => {
    const sanitizedCol = sanitizeName(col);
    return `[${sanitizedCol}] NVARCHAR(MAX) NULL`;
  }).join(',\n    ');
  
  await pool.request().query(`
    IF OBJECT_ID('dbo.${tableName}','U') IS NULL
    BEGIN
      CREATE TABLE dbo.${tableName}(
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ${columnDefs}
      );
    END
  `);
}

async function insertRowsDynamic(pool, tableName, columns, rows, batchSize = 1000) {
  if (rows.length === 0) return 0;
  
  const sanitizedColumns = columns.map(col => `[${sanitizeName(col)}]`);
  
  let inserted = 0;
  const totalRows = rows.length;
  
  // Batch'ler halinde işle
  for (let i = 0; i < totalRows; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    console.log(`Batch işleniyor: ${i + 1}-${Math.min(i + batchSize, totalRows)} / ${totalRows}`);
    
    // Batch içindeki her satır için
    for (const row of batch) {
      // Her satır için parametreli sorgu oluştur
      const paramNames = columns.map((col, index) => `@param${index}`).join(', ');
      const insertQuery = `
        INSERT INTO dbo.${tableName} (${sanitizedColumns.join(', ')})
        VALUES (${paramNames})
      `;
      
      // Request oluştur ve parametreleri ekle
      const request = pool.request();
      columns.forEach((col, index) => {
        let value = row[col];
        // Değeri açıkça string'e çevir veya null bırak
        if (value !== null && value !== undefined) {
          value = String(value); // Sayı, boolean vb. değerleri string'e çevir
        } else {
          value = null; // null veya undefined ise null olarak kalır
        }
        // Parametreyi NVarChar olarak açıkça belirt
        request.input(`param${index}`, sql.NVarChar(sql.MAX), value);
      });
      
      await request.query(insertQuery);
      inserted++;
    }
  }
  
  console.log(`Toplam ${inserted} satır ${Math.ceil(totalRows / batchSize)} batch halinde kaydedildi`);
  return inserted;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // büyük Exceller için

// ---- MSSQL pool ----
let mssqlPool = null;
async function getMssqlPool() {
  if (!MSSQL_ENABLED) throw new Error("MSSQL disabled");
  if (mssqlPool) return mssqlPool;

  const cfg = {
    user: MSSQL_USER,
    password: MSSQL_PASSWORD,
    server: MSSQL_SERVER,
    database: MSSQL_DATABASE,
    options: { encrypt: false, trustServerCertificate: true },
  };
  mssqlPool = await sql.connect(cfg);

  // BatchUploads tablosunu oluştur
  await ensureBatchUploadsTable(mssqlPool);

  return mssqlPool;
}

// ---- PostgreSQL pool ----
let postgresPool = null;
async function getPostgresPool() {
  if (!POSTGRES_ENABLED) throw new Error("PostgreSQL disabled");
  if (postgresPool) return postgresPool;

  const cfg = {
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    database: POSTGRES_DATABASE,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
  };
  postgresPool = new Pool(cfg);

  return postgresPool;
}

// ---- MySQL pool ----
let mysqlPool = null;
async function getMysqlPool() {
  if (!MYSQL_ENABLED) throw new Error("MySQL disabled");
  if (mysqlPool) return mysqlPool;

  const cfg = {
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  };
  mysqlPool = mysql.createPool(cfg);

  return mysqlPool;
}

// ---- SQLite database ----
let sqliteDb = null;
async function getSqliteDb() {
  if (!SQLITE_ENABLED) throw new Error("SQLite disabled");
  if (sqliteDb) return sqliteDb;

  sqliteDb = new Database(SQLITE_DATABASE);
  return sqliteDb;
}

// ---------- ROUTES ----------
app.get("/test", (req, res) => res.send("Backend çalışıyor 🚀"));

// Sağlık
app.get("/health", async (req, res) => {
  try {
    const pool = await getMssqlPool();
    await pool.request().query("SELECT 1");
    return res.json({ ok: true, db: "mssql" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Test MSSQL connection
app.get("/test-mssql", async (req, res) => {
  try {
    const pool = await getMssqlPool();
    await pool.request().query("SELECT 1 AS ok");
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test PostgreSQL connection
app.get("/test-postgres", async (req, res) => {
  try {
    const pool = await getPostgresPool();
    await pool.query("SELECT 1 AS ok");
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test MySQL connection
app.get("/test-mysql", async (req, res) => {
  try {
    const pool = await getMysqlPool();
    await pool.promise().query("SELECT 1 AS ok");
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Kaydet: Her Excel için yeni tablo oluştur
app.post("/save", async (req, res) => {
  const rows = req.body.rows || [];
  const fileName = req.body.fileName || req.query.fileName;
  const sheetName = req.body.sheetName || req.query.sheetName;
  const tableName = req.body.tableName; // Mevcut tablo adı (opsiyonel)
  const mode = req.body.mode || 'new'; // 'new' veya 'append'
  const batchSize = req.body.batchSize || 1000; // Batch boyutu

  try {
    const pool = await getMssqlPool();
    
    let finalTableName = tableName;
    let columns = getAllKeys(rows);
    
    if (mode === 'new' || !tableName) {
      // Yeni tablo oluştur
      const timestamp = yyyymmdd_HHmmss();
      const sanitizedFileName = sanitizeName(fileName || "unknown");
      finalTableName = `${sanitizedFileName}_${timestamp}`;
      
      // Dinamik tabloyu oluştur
      await ensureDynamicTable(pool, finalTableName, columns);
    } else {
      // Mevcut tabloya ekle - sütunları kontrol et
      try {
        const { recordset } = await pool.request().query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = '${tableName}'
        `);
        const existingColumns = recordset.map(col => col.COLUMN_NAME);
        columns = columns.filter(col => existingColumns.includes(sanitizeName(col)));
      } catch (e) {
        return res.status(400).json({ ok: false, error: `Tablo bulunamadı: ${tableName}` });
      }
    }
    
    // Satırları ekle (batch boyutu ile)
    const inserted = await insertRowsDynamic(pool, finalTableName, columns, rows, batchSize);
    
    // BatchUploads tablosuna kayıt ekle (sadece yeni tablo için)
    if (mode === 'new' || !tableName) {
      await pool.request()
        .input("TableName", sql.NVarChar(255), finalTableName)
        .input("OriginalFileName", sql.NVarChar(255), fileName || "unknown")
        .input("RowCount", sql.Int, inserted)
        .query(`
          INSERT INTO dbo.BatchUploads (TableName, OriginalFileName, [RowCount], CreatedAt)
          VALUES (@TableName, @OriginalFileName, @RowCount, SYSUTCDATETIME())
        `);
    }
    
    res.json({ 
      ok: true, 
      db: "mssql", 
      saved: inserted, 
      tableName: finalTableName, 
      fileName, 
      sheetName,
      columns: columns.length,
      mode: mode
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Oku: table parametresi ile belirli tablodan oku
app.get("/rows", async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const table = req.query.table;

  try {
    if (table) {
      // Belirli tablodan oku
      const pool = await getMssqlPool();
      
      const { recordset } = await pool.request()
        .input("LIMIT", sql.Int, limit)
        .query(`
          SELECT TOP(@LIMIT) *
          FROM dbo.${table}
          ORDER BY Id DESC
        `);
      
      res.json({ ok: true, db: "mssql", count: recordset.length, data: recordset, table });
    } else {
      res.status(400).json({ ok: false, error: "table parametresi gerekli" });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Son yüklemeler (BatchUploads tablosundan)
app.get("/batches", async (req, res) => {
  const take = Number(req.query.take || 50);
  try {
    const pool = await getMssqlPool();
    
    const { recordset } = await pool.request()
      .input("TAKE", sql.Int, take)
      .query(`
        SELECT TOP(@TAKE)
          TableName,
          OriginalFileName,
          [RowCount],
          CreatedAt
        FROM dbo.BatchUploads
        ORDER BY CreatedAt DESC
      `);
    
    res.json({ ok: true, db: "mssql", batches: recordset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// PostgreSQL Destek Rotaları
// ======================
async function pgEnsureBatchUploadsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS batch_uploads (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_batch_uploads_created_at ON batch_uploads(created_at DESC);
  `);
}

async function pgEnsureDynamicTable(pool, tableName, columns) {
  const columnDefs = columns
    .map(col => `"${sanitizeName(col)}" TEXT NULL`)
    .join(',\n    ');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      id SERIAL PRIMARY KEY,
      ${columnDefs}
    );
  `);
}

async function pgInsertRowsDynamic(pool, tableName, columns, rows, batchSize = 1000) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const totalRows = rows.length;
  
  // Batch'ler halinde işle
  for (let i = 0; i < totalRows; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    console.log(`PostgreSQL Batch işleniyor: ${i + 1}-${Math.min(i + batchSize, totalRows)} / ${totalRows}`);
    
    for (const row of batch) {
      const colNames = columns.map(c => `"${sanitizeName(c)}"`).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const values = columns.map(c => {
        const v = row[c];
        return v === null || v === undefined ? null : String(v);
      });
      await pool.query(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`, values);
      inserted++;
    }
  }
  
  console.log(`PostgreSQL: Toplam ${inserted} satır ${Math.ceil(totalRows / batchSize)} batch halinde kaydedildi`);
  return inserted;
}

app.post("/save-pg", async (req, res) => {
  const rows = req.body.rows || [];
  const fileName = req.body.fileName || req.query.fileName;
  const sheetName = req.body.sheetName || req.query.sheetName;
  const batchSize = req.body.batchSize || 1000;
  try {
    const pool = await getPostgresPool();
    await pgEnsureBatchUploadsTable(pool);

    const timestamp = yyyymmdd_HHmmss();
    const sanitizedFileName = sanitizeName(fileName || "unknown");
    const tableName = `${sanitizedFileName}_${timestamp}`;

    const columns = getAllKeys(rows);
    await pgEnsureDynamicTable(pool, tableName, columns);
    const inserted = await pgInsertRowsDynamic(pool, tableName, columns, rows, batchSize);

    await pool.query(
      `INSERT INTO batch_uploads (table_name, original_file_name, row_count, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [tableName, fileName || "unknown", inserted]
    );

    res.json({ ok: true, db: "postgres", saved: inserted, tableName, fileName, sheetName, columns: columns.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/rows-pg", async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const table = req.query.table;
  try {
    if (!table) return res.status(400).json({ ok: false, error: "table parametresi gerekli" });
    const pool = await getPostgresPool();
    const { rows } = await pool.query(`SELECT * FROM "${table}" ORDER BY id DESC LIMIT $1`, [limit]);
    res.json({ ok: true, db: "postgres", count: rows.length, data: rows, table });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/batches-pg", async (req, res) => {
  const take = Number(req.query.take || 50);
  try {
    const pool = await getPostgresPool();
    await pgEnsureBatchUploadsTable(pool);
    const { rows } = await pool.query(
      `SELECT table_name AS "TableName", original_file_name AS "OriginalFileName", row_count AS "RowCount", created_at AS "CreatedAt"
       FROM batch_uploads
       ORDER BY created_at DESC
       LIMIT $1`,
      [take]
    );
    res.json({ ok: true, db: "postgres", batches: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// MySQL Destek Rotaları
// ======================
async function myEnsureBatchUploadsTable(pool) {
  // MySQL'de CREATE INDEX IF NOT EXISTS desteklenmez; index'i tablo tanımında oluştur.
  await pool.promise().query(`
    CREATE TABLE IF NOT EXISTS BatchUploads (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      TableName VARCHAR(255) NOT NULL,
      OriginalFileName VARCHAR(255) NOT NULL,
      RowCount INT NOT NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX IX_BatchUploads_CreatedAt (CreatedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function myEnsureDynamicTable(pool, tableName, columns) {
  const columnDefs = columns
    .map(col => `\`${sanitizeName(col)}\` TEXT NULL`)
    .join(',\n    ');
  await pool.promise().query(`
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      ${columnDefs}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function myInsertRowsDynamic(pool, tableName, columns, rows, batchSize = 1000) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const totalRows = rows.length;
  
  // Batch'ler halinde işle
  for (let i = 0; i < totalRows; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    console.log(`MySQL Batch işleniyor: ${i + 1}-${Math.min(i + batchSize, totalRows)} / ${totalRows}`);
    
    for (const row of batch) {
      const colNames = columns.map(c => `\`${sanitizeName(c)}\``).join(', ');
      const placeholders = columns.map(() => `?`).join(', ');
      const values = columns.map(c => {
        const v = row[c];
        return v === null || v === undefined ? null : String(v);
      });
      await pool.promise().query(`INSERT INTO \`${tableName}\` (${colNames}) VALUES (${placeholders})`, values);
      inserted++;
    }
  }
  
  console.log(`MySQL: Toplam ${inserted} satır ${Math.ceil(totalRows / batchSize)} batch halinde kaydedildi`);
  return inserted;
}

app.post("/save-mysql", async (req, res) => {
  const rows = req.body.rows || [];
  const fileName = req.body.fileName || req.query.fileName;
  const sheetName = req.body.sheetName || req.query.sheetName;
  const batchSize = req.body.batchSize || 1000;
  try {
    const pool = await getMysqlPool();
    await myEnsureBatchUploadsTable(pool);

    const timestamp = yyyymmdd_HHmmss();
    const sanitizedFileName = sanitizeName(fileName || "unknown");
    const tableName = `${sanitizedFileName}_${timestamp}`;

    const columns = getAllKeys(rows);
    await myEnsureDynamicTable(pool, tableName, columns);
    const inserted = await myInsertRowsDynamic(pool, tableName, columns, rows, batchSize);

    await pool.promise().query(
      `INSERT INTO BatchUploads (TableName, OriginalFileName, RowCount, CreatedAt) VALUES (?, ?, ?, NOW())`,
      [tableName, fileName || "unknown", inserted]
    );

    res.json({ ok: true, db: "mysql", saved: inserted, tableName, fileName, sheetName, columns: columns.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/rows-mysql", async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const table = req.query.table;
  try {
    if (!table) return res.status(400).json({ ok: false, error: "table parametresi gerekli" });
    const pool = await getMysqlPool();
    const [rows] = await pool.promise().query(`SELECT * FROM \`${table}\` ORDER BY Id DESC LIMIT ?`, [limit]);
    res.json({ ok: true, db: "mysql", count: rows.length, data: rows, table });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/batches-mysql", async (req, res) => {
  const take = Number(req.query.take || 50);
  try {
    const pool = await getMysqlPool();
    await myEnsureBatchUploadsTable(pool);
    const [rows] = await pool.promise().query(
      `SELECT TableName, OriginalFileName, RowCount, CreatedAt FROM BatchUploads ORDER BY CreatedAt DESC LIMIT ?`,
      [take]
    );
    res.json({ ok: true, db: "mysql", batches: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// SQLite Destek Rotaları
// ======================
async function sqEnsureBatchUploadsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS BatchUploads (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      TableName TEXT NOT NULL,
      OriginalFileName TEXT NOT NULL,
      RowCount INTEGER NOT NULL,
      CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS IX_BatchUploads_CreatedAt ON BatchUploads (CreatedAt DESC);
  `);
}

async function sqEnsureDynamicTable(db, tableName, columns) {
  const columnDefs = columns
    .map(col => `"${sanitizeName(col)}" TEXT NULL`)
    .join(',\n    ');
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${columnDefs}
    );
  `);
}

async function sqInsertRowsDynamic(db, tableName, columns, rows, batchSize = 1000) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const totalRows = rows.length;
  const colNames = columns.map(c => `"${sanitizeName(c)}"`).join(', ');
  const placeholders = columns.map(() => `?`).join(', ');
  
  // Batch'ler halinde işle
  for (let i = 0; i < totalRows; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    console.log(`SQLite Batch işleniyor: ${i + 1}-${Math.min(i + batchSize, totalRows)} / ${totalRows}`);
    
    const stmt = db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`);
    for (const row of batch) {
      const values = columns.map(c => {
        const v = row[c];
        return v === null || v === undefined ? null : String(v);
      });
      stmt.run(values);
      inserted++;
    }
    stmt.free?.();
  }
  
  console.log(`SQLite: Toplam ${inserted} satır ${Math.ceil(totalRows / batchSize)} batch halinde kaydedildi`);
  return inserted;
}

app.post("/save-sqlite", async (req, res) => {
  const rows = req.body.rows || [];
  const fileName = req.body.fileName || req.query.fileName;
  const sheetName = req.body.sheetName || req.query.sheetName;
  const batchSize = req.body.batchSize || 1000;
  try {
    const db = await getSqliteDb();
    await sqEnsureBatchUploadsTable(db);

    const timestamp = yyyymmdd_HHmmss();
    const sanitizedFileName = sanitizeName(fileName || "unknown");
    const tableName = `${sanitizedFileName}_${timestamp}`;

    const columns = getAllKeys(rows);
    await sqEnsureDynamicTable(db, tableName, columns);
    const inserted = await sqInsertRowsDynamic(db, tableName, columns, rows, batchSize);

    db.prepare(`INSERT INTO BatchUploads (TableName, OriginalFileName, RowCount, CreatedAt) VALUES (?, ?, ?, datetime('now'))`)
      .run(tableName, fileName || "unknown", inserted);

    res.json({ ok: true, db: "sqlite", saved: inserted, tableName, fileName, sheetName, columns: columns.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/rows-sqlite", async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const table = req.query.table;
  try {
    if (!table) return res.status(400).json({ ok: false, error: "table parametresi gerekli" });
    const db = await getSqliteDb();
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY Id DESC LIMIT ?`).all(limit);
    res.json({ ok: true, db: "sqlite", count: rows.length, data: rows, table });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/batches-sqlite", async (req, res) => {
  const take = Number(req.query.take || 50);
  try {
    const db = await getSqliteDb();
    await sqEnsureBatchUploadsTable(db);
    const rows = db.prepare(`SELECT TableName, OriginalFileName, RowCount, CreatedAt FROM BatchUploads ORDER BY CreatedAt DESC LIMIT ?`).all(take);
    res.json({ ok: true, db: "sqlite", batches: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Logging System
// ======================
const logger = require('./logger');

// ======================
// Validation System
// ======================
const { 
  validateDataset, 
  generateValidationRules, 
  cleanData,
  VALIDATION_TYPES 
} = require('./validation');

// ======================
// Sütun Analizi ve Tip Tahmini
// ======================
function analyzeColumnType(values) {
  if (values.length === 0) return { type: "string", confidence: 0 };
  
  let stringCount = 0, numberCount = 0, dateCount = 0, booleanCount = 0, nullCount = 0;
  const sampleValues = [];
  
  for (let i = 0; i < Math.min(values.length, 100); i++) {
    const value = values[i];
    if (value === null || value === undefined || value === "") {
      nullCount++;
      continue;
    }
    
    const strValue = String(value).trim();
    if (strValue === "") {
      nullCount++;
      continue;
    }
    
    sampleValues.push(strValue);
    
    // Boolean kontrolü
    if (/^(true|false|yes|no|1|0|evet|hayır|tamam|ok)$/i.test(strValue)) {
      booleanCount++;
    }
    // Tarih kontrolü
    else if (/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4}$/.test(strValue) || 
             /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4}$/.test(strValue) ||
             /^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
      dateCount++;
    }
    // Sayı kontrolü
    else if (!isNaN(Number(strValue)) && strValue !== "") {
      numberCount++;
    }
    // String (varsayılan)
    else {
      stringCount++;
    }
  }
  
  const total = stringCount + numberCount + dateCount + booleanCount;
  if (total === 0) return { type: "string", confidence: 0 };
  
  const percentages = {
    string: stringCount / total,
    number: numberCount / total,
    date: dateCount / total,
    boolean: booleanCount / total
  };
  
  let bestType = "string";
  let bestConfidence = percentages.string;
  
  if (percentages.number > bestConfidence) {
    bestType = "number";
    bestConfidence = percentages.number;
  }
  if (percentages.date > bestConfidence) {
    bestType = "date";
    bestConfidence = percentages.date;
  }
  if (percentages.boolean > bestConfidence) {
    bestType = "boolean";
    bestConfidence = percentages.boolean;
  }
  
  return {
    type: bestType,
    confidence: Math.round(bestConfidence * 100),
    sampleValues: sampleValues.slice(0, 5),
    nullPercentage: Math.round((nullCount / values.length) * 100),
    // Tip tahmini açıklaması
    typeExplanation: bestType === 'number' ? 'Sayısal değerler tespit edildi' :
                    bestType === 'date' ? 'Tarih formatı tespit edildi' :
                    bestType === 'boolean' ? 'Evet/Hayır değerleri tespit edildi' :
                    'Metin formatı tespit edildi'
  };
}

app.post("/analyze-columns", async (req, res) => {
  const rows = req.body.rows || [];
  
  try {
    logger.info('Sütun analizi başlatıldı', req, { 
      totalRows: rows.length,
      fileName: req.body.fileName || 'unknown'
    });

    if (rows.length === 0) {
      logger.warning('Analiz için veri bulunamadı', req);
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    const columns = getAllKeys(rows);
    const analysis = {};
    
    for (const column of columns) {
      const values = rows.map(row => row[column]);
      analysis[column] = analyzeColumnType(values);
    }
    
    const results = {
      totalRows: rows.length,
      totalColumns: columns.length,
      analysis
    };

    logger.analysis('Sütun analizi', results, req);
    
    res.json({
      ok: true,
      ...results
    });
    
  } catch (e) {
    logger.error('Sütun analizi hatası', req, { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Veri Dönüştürme ve İşleme
// ======================
function applyTransformation(value, transformation) {
  if (value === null || value === undefined) return value;
  
  let result = String(value);
  
  switch (transformation.type) {
    case 'trim':
      result = result.trim();
      break;
    case 'uppercase':
      result = result.toUpperCase();
      break;
    case 'lowercase':
      result = result.toLowerCase();
      break;
    case 'date_format':
      if (transformation.format) {
        try {
          const date = new Date(result);
          if (!isNaN(date.getTime())) {
            // Farklı tarih formatları
            switch (transformation.format) {
              case 'YYYY-MM-DD':
                result = date.toISOString().split('T')[0];
                break;
              case 'DD/MM/YYYY':
                result = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
                break;
              case 'MM/DD/YYYY':
                result = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
                break;
              default:
                result = date.toISOString().split('T')[0];
            }
          }
        } catch (e) {
          // Tarih parse edilemezse orijinal değeri koru
        }
      }
      break;
    case 'regex_replace':
      if (transformation.pattern && transformation.replacement) {
        try {
          const regex = new RegExp(transformation.pattern, 'g');
          result = result.replace(regex, transformation.replacement);
        } catch (e) {
          // Regex hatası varsa orijinal değeri koru
        }
      }
      break;
    case 'constant':
      result = transformation.value || '';
      break;
    case 'formula':
      if (transformation.expression) {
        try {
          // Formül değerlendirme
          const formula = transformation.expression;
          
          // CONCAT formülü
          if (formula.toUpperCase().includes('CONCAT')) {
            const matches = formula.match(/CONCAT\(([^)]+)\)/i);
            if (matches) {
              const parts = matches[1].split(',').map(part => {
                part = part.trim();
                if (part.startsWith('"') && part.endsWith('"')) {
                  return part.slice(1, -1);
                } else if (part.startsWith("'") && part.endsWith("'")) {
                  return part.slice(1, -1);
                }
                return part;
              });
              result = parts.join('');
            }
          }
          // UPPER formülü
          else if (formula.toUpperCase().includes('UPPER')) {
            const matches = formula.match(/UPPER\(([^)]+)\)/i);
            if (matches) {
              result = String(result).toUpperCase();
            }
          }
          // LOWER formülü
          else if (formula.toUpperCase().includes('LOWER')) {
            const matches = formula.match(/LOWER\(([^)]+)\)/i);
            if (matches) {
              result = String(result).toLowerCase();
            }
          }
          // TRIM formülü
          else if (formula.toUpperCase().includes('TRIM')) {
            const matches = formula.match(/TRIM\(([^)]+)\)/i);
            if (matches) {
              result = String(result).trim();
            }
          }
          // LENGTH formülü
          else if (formula.toUpperCase().includes('LENGTH')) {
            const matches = formula.match(/LENGTH\(([^)]+)\)/i);
            if (matches) {
              result = String(result).length;
            }
          }
          // SUBSTRING formülü
          else if (formula.toUpperCase().includes('SUBSTRING')) {
            const matches = formula.match(/SUBSTRING\(([^)]+)\)/i);
            if (matches) {
              const params = matches[1].split(',').map(p => p.trim());
              const start = parseInt(params[1]) - 1;
              const length = parseInt(params[2]);
              result = String(result).substring(start, start + length);
            }
          }
          // REPLACE formülü
          else if (formula.toUpperCase().includes('REPLACE')) {
            const matches = formula.match(/REPLACE\(([^)]+)\)/i);
            if (matches) {
              const params = matches[1].split(',').map(p => p.trim());
              const search = params[1].replace(/['"]/g, '');
              const replace = params[2].replace(/['"]/g, '');
              result = String(result).replace(new RegExp(search, 'g'), replace);
            }
          }
          // DATE_FORMAT formülü
          else if (formula.toUpperCase().includes('DATE_FORMAT')) {
            const matches = formula.match(/DATE_FORMAT\(([^)]+)\)/i);
            if (matches) {
              const params = matches[1].split(',').map(p => p.trim());
              const format = params[1].replace(/['"]/g, '');
              const date = new Date(result);
              if (!isNaN(date.getTime())) {
                switch (format) {
                  case 'DD/MM/YYYY':
                    result = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
                    break;
                  case 'MM/DD/YYYY':
                    result = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
                    break;
                  default:
                    result = date.toISOString().split('T')[0];
                }
              }
            }
          }
        } catch (e) {
          // Formül hatası varsa orijinal değeri koru
          console.log('Formül hatası:', e.message);
        }
      }
      break;
    case 'concat':
      if (transformation.prefix || transformation.suffix) {
        result = (transformation.prefix || '') + result + (transformation.suffix || '');
      }
      break;
    case 'extract':
      if (transformation.start && transformation.end) {
        result = result.substring(transformation.start, transformation.end);
      }
      break;
    case 'replace_text':
      if (transformation.search && transformation.replace) {
        result = result.replace(new RegExp(transformation.search, 'g'), transformation.replace);
      }
      break;
  }
  
  return result;
}

app.post("/transform-data", async (req, res) => {
  const { rows, transformations, targetType } = req.body;
  
  try {
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    const transformedRows = [];
    const errors = [];
    
    for (let i = 0; i < rows.length; i++) {
      const originalRow = rows[i];
      const transformedRow = {};
      
      for (const [columnName, transformation] of Object.entries(transformations)) {
        try {
          let value = originalRow[columnName];
          
          // Dönüştürme uygula
          if (transformation && transformation.enabled) {
            value = applyTransformation(value, transformation);
          }
          
          // Tip dönüştürme
          if (targetType && targetType[columnName]) {
            switch (targetType[columnName]) {
              case 'number':
                value = isNaN(Number(value)) ? value : Number(value);
                break;
              case 'boolean':
                value = /^(true|false|1|0|yes|no|evet|hayır)$/i.test(String(value)) ? 
                       /^(true|1|yes|evet)$/i.test(String(value)) : value;
                break;
              case 'date':
                const date = new Date(value);
                value = isNaN(date.getTime()) ? value : date.toISOString();
                break;
              default:
                value = String(value);
            }
          }
          
          transformedRow[columnName] = value;
        } catch (error) {
          errors.push({
            row: i + 1,
            column: columnName,
            error: error.message,
            originalValue: originalRow[columnName]
          });
        }
      }
      
      transformedRows.push(transformedRow);
    }
    
    res.json({
      ok: true,
      transformedRows,
      totalRows: transformedRows.length,
      errors,
      errorCount: errors.length
    });
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Excel Export
// ======================
app.post("/export-excel", async (req, res) => {
  const { rows, fileName, sheetName, preserveFormat, originalColumns } = req.body;
  
  try {
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    // XLSX kütüphanesini dinamik olarak import et
    const XLSX = require('xlsx');
    
    // Workbook oluştur
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    
    // Excel stilini uygula
    const columns = Object.keys(rows[0] || {});
    
    // Sütun genişliklerini ayarla
    ws['!cols'] = columns.map(() => ({ width: 20 }));
    
    // Başlık satırını stilize et
    Object.keys(ws).forEach(key => {
      if (key.match(/^[A-Z]+1$/)) {
        ws[key].s = {
          font: { 
            bold: true, 
            color: { rgb: "FFFFFF" },
            size: 12
          },
          fill: { 
            fgColor: { rgb: "4472C4" },
            patternType: "solid"
          },
          alignment: { 
            horizontal: "center", 
            vertical: "center" 
          },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }
    });
    
    // Veri hücrelerini stilize et
    Object.keys(ws).forEach(key => {
      if (!key.match(/^[A-Z]+1$/) && key.match(/^[A-Z]+\d+$/)) {
        ws[key].s = {
          font: { 
            size: 11,
            color: { rgb: "000000" }
          },
          fill: { 
            fgColor: { rgb: "FFFFFF" }
          },
          alignment: { 
            horizontal: "left", 
            vertical: "center" 
          },
          border: {
            top: { style: "thin", color: { rgb: "CCCCCC" } },
            bottom: { style: "thin", color: { rgb: "CCCCCC" } },
            left: { style: "thin", color: { rgb: "CCCCCC" } },
            right: { style: "thin", color: { rgb: "CCCCCC" } }
          }
        };
      }
    });
    
    // Sheet'i workbook'a ekle
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    
    // Buffer olarak yaz
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Base64'e çevir
    const base64 = buffer.toString('base64');
    
    logger.info('Excel export tamamlandı', req, { 
      fileName, 
      rowCount: rows.length, 
      preserveFormat: !!preserveFormat 
    });
    
    res.json({
      ok: true,
      fileName: fileName || 'exported_data.xlsx',
      base64,
      size: buffer.length
    });
    
  } catch (e) {
    logger.error('Excel export hatası', req, { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Hata Raporlama ve Retry
// ======================
app.post("/retry-failed-rows", async (req, res) => {
  const { failedRows, transformations, targetType, dbType } = req.body;
  
  try {
    if (!failedRows || failedRows.length === 0) {
      return res.status(400).json({ ok: false, error: "Başarısız satır bulunamadı" });
    }
    
    const retryResults = [];
    const stillFailed = [];
    
    for (const failedRow of failedRows) {
      try {
        // Satırı tekrar dönüştür
        const transformedRow = {};
        for (const [columnName, transformation] of Object.entries(transformations)) {
          let value = failedRow.originalRow[columnName];
          
          if (transformation && transformation.enabled) {
            value = applyTransformation(value, transformation);
          }
          
          if (targetType && targetType[columnName]) {
            switch (targetType[columnName]) {
              case 'number':
                value = isNaN(Number(value)) ? value : Number(value);
                break;
              case 'boolean':
                value = /^(true|false|1|0|yes|no|evet|hayır)$/i.test(String(value)) ? 
                       /^(true|1|yes|evet)$/i.test(String(value)) : value;
                break;
              case 'date':
                const date = new Date(value);
                value = isNaN(date.getTime()) ? value : date.toISOString();
                break;
              default:
                value = String(value);
            }
          }
          
          transformedRow[columnName] = value;
        }
        
        retryResults.push({
          originalRow: failedRow.originalRow,
          transformedRow,
          success: true
        });
        
      } catch (error) {
        stillFailed.push({
          originalRow: failedRow.originalRow,
          error: error.message,
          retryCount: (failedRow.retryCount || 0) + 1
        });
      }
    }
    
    res.json({
      ok: true,
      retryResults,
      stillFailed,
      successCount: retryResults.length,
      failureCount: stillFailed.length
    });
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Validation Endpoints
// ======================
app.post("/validate-data", async (req, res) => {
  const { rows, rules, autoGenerate = false } = req.body;
  
  try {
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    let validationRules = rules;
    
    // Auto-generate rules from column analysis if requested
    if (autoGenerate && !rules) {
      const columns = getAllKeys(rows);
      const analysis = {};
      
      for (const column of columns) {
        const values = rows.map(row => row[column]);
        analysis[column] = analyzeColumnType(values);
      }
      
      validationRules = generateValidationRules(analysis);
    }
    
    if (!validationRules || Object.keys(validationRules).length === 0) {
      return res.status(400).json({ ok: false, error: "Validation rules bulunamadı" });
    }
    
    const results = validateDataset(rows, validationRules);
    
    res.json({
      ok: true,
      validationResults: results,
      rules: validationRules,
      qualityScore: Math.round(((results.validRows / results.totalRows) * 100) || 0)
    });
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/clean-data", async (req, res) => {
  const { rows, validationResults, options = {} } = req.body;
  
  try {
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    if (!validationResults) {
      return res.status(400).json({ ok: false, error: "Validation results bulunamadı" });
    }
    
    const cleaningOptions = {
      removeInvalidRows: options.removeInvalidRows || false,
      fixCommonIssues: options.fixCommonIssues !== false,
      defaultValues: options.defaultValues || {}
    };
    
    const cleanedData = cleanData(rows, validationResults, cleaningOptions);
    
    res.json({
      ok: true,
      cleanedData,
      originalCount: rows.length,
      cleanedCount: cleanedData.cleanedRows.length,
      removedCount: cleanedData.removedCount
    });
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/validation-types", (req, res) => {
  res.json({
    ok: true,
    validationTypes: VALIDATION_TYPES,
    examples: {
      required: { type: 'required', message: 'This field is required' },
      email: { type: 'email', message: 'Must be a valid email address' },
      min_length: { type: 'min_length', params: 5, message: 'Must be at least 5 characters' },
      max_value: { type: 'max_value', params: 100, message: 'Must be less than or equal to 100' },
      regex: { type: 'regex', params: '^[A-Z]{2}\\d{4}$', message: 'Must match pattern XX0000' }
    }
  });
});

// ======================
// Log Management Endpoints
// ======================
app.get("/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = logger.getRecentLogs(limit);
    res.json({ ok: true, logs });
  } catch (e) {
    logger.error('Log getirme hatası', req, { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/logs/stats", (req, res) => {
  try {
    const stats = logger.getLogStats();
    res.json({ ok: true, stats });
  } catch (e) {
    logger.error('Log istatistik hatası', req, { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/logs/:date", (req, res) => {
  try {
    const { date } = req.params;
    const logs = logger.getLogsByDate(date);
    res.json({ ok: true, logs });
  } catch (e) {
    logger.error('Tarih bazlı log hatası', req, { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Batch İşlem Ayarları
// ======================
app.post("/batch-process", async (req, res) => {
  const { rows, transformations, targetType, batchSize = 1000, dbType } = req.body;
  
  try {
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Veri bulunamadı" });
    }
    
    const results = {
      totalRows: rows.length,
      processedRows: 0,
      successCount: 0,
      errorCount: 0,
      errors: [],
      batches: []
    };
    
    // Veriyi batch'lere böl
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      try {
        // Batch'i işle
        const transformedBatch = [];
        const batchErrors = [];
        
        for (let j = 0; j < batch.length; j++) {
          try {
            const originalRow = batch[j];
            const transformedRow = {};
            
            for (const [columnName, transformation] of Object.entries(transformations)) {
              let value = originalRow[columnName];
              
              if (transformation && transformation.enabled) {
                value = applyTransformation(value, transformation);
              }
              
              if (targetType && targetType[columnName]) {
                switch (targetType[columnName]) {
                  case 'number':
                    value = isNaN(Number(value)) ? value : Number(value);
                    break;
                  case 'boolean':
                    value = /^(true|false|1|0|yes|no|evet|hayır)$/i.test(String(value)) ? 
                           /^(true|1|yes|evet)$/i.test(String(value)) : value;
                    break;
                  case 'date':
                    const date = new Date(value);
                    value = isNaN(date.getTime()) ? value : date.toISOString();
                    break;
                  default:
                    value = String(value);
                }
              }
              
              transformedRow[columnName] = value;
            }
            
            transformedBatch.push(transformedRow);
            results.successCount++;
            
          } catch (error) {
            batchErrors.push({
              rowIndex: i + j + 1,
              error: error.message,
              originalRow: batch[j]
            });
            results.errorCount++;
          }
        }
        
        results.processedRows += batch.length;
        results.batches.push({
          batchNumber,
          size: batch.length,
          successCount: transformedBatch.length,
          errorCount: batchErrors.length,
          errors: batchErrors
        });
        
        if (batchErrors.length > 0) {
          results.errors.push(...batchErrors);
        }
        
      } catch (error) {
        results.errors.push({
          batchNumber,
          error: error.message
        });
      }
    }
    
    res.json({
      ok: true,
      ...results
    });
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================
// Tablo Listesi
// ======================
app.get('/tables', (req, res) => {
  try {
    // SQLite veritabanındaki tabloları al
    const tableQuery = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    db.all(tableQuery, [], (err, rows) => {
      if (err) {
        logger.error('Tablo listesi alınamadı', req, { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      // Her tablo için satır sayısını al
      const tablePromises = rows.map(table => {
        return new Promise((resolve) => {
          db.get(`SELECT COUNT(*) as count FROM "${table.name}"`, (err, result) => {
            if (err) {
              resolve({ name: table.name, rows: 0 });
            } else {
              resolve({ name: table.name, rows: result.count });
            }
          });
        });
      });
      
      Promise.all(tablePromises).then(tablesWithCounts => {
        logger.info('Tablolar listelendi', req, { tableCount: tablesWithCounts.length });
        res.json({ tables: tablesWithCounts });
      });
    });
  } catch (error) {
    logger.error('Tablo listesi hatası', req, { error: error.message });
    res.status(500).json({ error: error.message });
  }
});



const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Server ${PORT} portunda`));
