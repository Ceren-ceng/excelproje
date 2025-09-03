// ==== React + Excel → DB (MSSQL) ====
// Bu component backend'teki /test, /health, /save, /rows, /batches endpoint'leriyle uyumludur.
// Amaç: Excel seç → JSON'a çevir → MSSQL veritabanına yaz. Her Excel için ayrı tablo oluştur.

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";      // Excel'i JSON'a çevirmek için
import axios from "axios";         // Backend'e HTTP istekler için
import { useDropzone } from "react-dropzone"; // Drag and drop için
// Basit HTML elementleri kullanıyoruz (Tailwind kurulumu tamamlanana kadar)

// Backend adresi (Vercel'de API routes kullanıyoruz)
const BACKEND_URL = process.env.NODE_ENV === 'production' 
  ? 'https://excelproje1.vercel.app/api' 
  : 'http://localhost:5000';

export default function App() {
  // ------------------ STATE'LER ------------------
  const [fileName, setFileName] = useState("");    // Seçilen dosyanın adı (örn: data.xlsx)
  const [sheetName, setSheetName] = useState("");  // İlk sayfanın (sheet) adı (örn: Sheet1)
  const [rows, setRows] = useState([]);            // Excel'den okunan satırlar (Array<object>)
  const [columns, setColumns] = useState([]);      // Excel sütun başlıkları
  const [previewRows, setPreviewRows] = useState([]); // İlk 5 satır önizleme için
  const [error, setError] = useState("");          // Kullanıcıya gösterilecek hata metni

  const [backendMsg, setBackendMsg] = useState(""); // /test sonucunu gösterir
  const [dbHealth, setDbHealth] = useState("");     // MSSQL /health sonucu
  const [pgHealth, setPgHealth] = useState("");     // PostgreSQL test sonucu
  const [myHealth, setMyHealth] = useState("");     // MySQL test sonucu
  const [sqHealth, setSqHealth] = useState("");     // SQLite test sonucu

  // Her Excel yüklemesi için ayrı tablo oluşturulur
  const [lastTableName, setLastTableName] = useState(""); // Son kaydettiğimiz tablo adı
  const [lastRows, setLastRows] = useState([]);       // Son tablodan okunan kayıtlar (debug için)
  const [batches, setBatches] = useState([]);         // /batches listesini tutar (yüklenen tablolar)
  const [columnAnalysis, setColumnAnalysis] = useState(null); // Sütun analizi sonucu
  const [columnMappings, setColumnMappings] = useState({}); // Sütun eşleme ayarları
  const [transformedRows, setTransformedRows] = useState([]); // Dönüştürülmüş veriler
  const [showMappingPanel, setShowMappingPanel] = useState(false); // Eşleme paneli görünürlüğü
  const [columnRenames, setColumnRenames] = useState({}); // Sütun yeniden adlandırma
  const [progress, setProgress] = useState(0); // İşlem ilerlemesi
  const [logs, setLogs] = useState([]); // İşlem logları
  const [showConnectionForm, setShowConnectionForm] = useState(false); // Bağlantı formu
  const [targetType, setTargetType] = useState('excel'); // Hedef tip: excel veya database
  const [saveMode, setSaveMode] = useState('new'); // 'new' veya 'append'
  const [selectedTable, setSelectedTable] = useState(''); // Mevcut tablo seçimi
  const [editingMode, setEditingMode] = useState('none'); // 'none', 'columns', 'cells', 'types'
  const [editedRows, setEditedRows] = useState([]); // Düzenlenen satırlar
  const [pendingChanges, setPendingChanges] = useState({}); // Bekleyen değişiklikler

  // Öğrenme amaçlı: kaç satır okundu konsola yaz
  useEffect(() => {
    if (rows.length > 0) console.log("Excel satır sayısı:", rows.length);
  }, [rows]);

  // ------------------ DRAG AND DROP ------------------
  
  const onDrop = useCallback((acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    handleExcelFile(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    multiple: false
  });

  // ------------------ EXCEL PROCESSING ------------------

  // Excel dosyasını işle (hem drag-drop hem file input için)
  const handleExcelFile = async (file) => {
    setError("");
    setRows([]);
    setColumns([]);
    setPreviewRows([]);
    setLastTableName("");       // Yeni dosyada önceki tableName'i sıfırla
    
    if (!file) return;

    setFileName(file.name);

    try {
      // 1) Dosyayı buffer olarak oku
      const data = await file.arrayBuffer();

      // 2) Workbook'u oluştur
      const wb = XLSX.read(data, { type: "array" });

      // 3) İlk sheet adını ve içeriğini al
      const firstSheetName = wb.SheetNames[0];
      const firstSheet = wb.Sheets[firstSheetName];

      // 4) Sheet'i JSON'a çevir
      const json = XLSX.utils.sheet_to_json(firstSheet);

      // 5) State'lere yaz
      setSheetName(firstSheetName);
      setRows(json);
      
      // 6) Sütun başlıklarını ve önizleme satırlarını ayarla
      if (json.length > 0) {
        const columnNames = Object.keys(json[0]);
        setColumns(columnNames);
        setPreviewRows(json.slice(0, 5)); // İlk 5 satır
      }
    } catch (err) {
      console.error(err);
      setError("Excel okunamadı. Geçerli bir .xlsx/.xls seçtiğinden emin ol.");
    }
  };

  // Dosya seçildiğinde: Excel → JSON (ilk sheet) - Fallback için
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleExcelFile(file);
    }
  };

  // ------------------ BACKEND CHECKS ------------------

  // /test → Backend ayakta mı?
  const pingBackend = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/test`);
      setBackendMsg(String(res.data)); // "Backend çalışıyor 🚀"
    } catch (err) {
      setBackendMsg("Bağlanamadı: " + (err?.message || "bilinmiyor"));
    }
  };

  // /health → MSSQL'e gerçekten bağlanabiliyor muyuz?
  const testDbConnection = async () => {
    setDbHealth("Test ediliyor...");
    try {
      const res = await axios.get(`${BACKEND_URL}/health`);
      if (res.data.ok) setDbHealth(`OK (${res.data.db})`);
      else setDbHealth(`HATA: ${res.data.error || "bilinmiyor"}`);
    } catch (err) {
      setDbHealth(`HATA: ${err.response?.data?.error || err.message}`);
    }
  };

  // PostgreSQL test
  const testPg = async () => {
    setPgHealth("Test ediliyor...");
    try {
      const res = await axios.get(`${BACKEND_URL}/test-postgres`);
      setPgHealth(res.data?.ok ? "OK (postgres)" : "HATA");
    } catch (err) {
      setPgHealth(`HATA: ${err.response?.data?.error || err.message}`);
    }
  };

  // MySQL test
  const testMy = async () => {
    setMyHealth("Test ediliyor...");
    try {
      const res = await axios.get(`${BACKEND_URL}/test-mysql`);
      setMyHealth(res.data?.ok ? "OK (mysql)" : "HATA");
    } catch (err) {
      setMyHealth(`HATA: ${err.response?.data?.error || err.message}`);
    }
  };

  // ------------------ KAYDET / OKU ------------------

  // /save → JSON satırlarını MSSQL'e yaz. Her Excel için yeni tablo oluşturur.
  const saveToDb = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    try {
      const res = await axios.post(`${BACKEND_URL}/save`, {
        rows,         // Array<object>
        fileName,     // "dosya.xlsx"
        sheetName,    // "Sheet1"
      });

      // Backend tableName döndürürse saklıyoruz
      setLastTableName(res.data.tableName || "");

      alert(
        `Kaydedildi → db=${res.data.db}, adet=${res.data.saved}, tablo=${res.data.tableName}` +
        `, sütun sayısı=${res.data.columns}`
      );
    } catch (err) {
      console.error(err);
      alert("Kaydetme hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // PostgreSQL'e kaydet
  const saveToPg = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    try {
      const res = await axios.post(`${BACKEND_URL}/save-pg`, { rows, fileName, sheetName });
      setLastTableName(res.data.tableName || "");
      alert(`Kaydedildi → db=${res.data.db}, adet=${res.data.saved}, tablo=${res.data.tableName}, sütun sayısı=${res.data.columns}`);
    } catch (err) {
      alert("PG kaydetme hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // MySQL'e kaydet
  const saveToMy = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    try {
      const res = await axios.post(`${BACKEND_URL}/save-mysql`, { rows, fileName, sheetName });
      setLastTableName(res.data.tableName || "");
      alert(`Kaydedildi → db=${res.data.db}, adet=${res.data.saved}, tablo=${res.data.tableName}, sütun sayısı=${res.data.columns}`);
    } catch (err) {
      alert("MySQL kaydetme hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // SQLite'a kaydet
  const saveToSq = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    try {
      const res = await axios.post(`${BACKEND_URL}/save-sqlite`, { rows, fileName, sheetName });
      setLastTableName(res.data.tableName || "");
      alert(`Kaydedildi → db=${res.data.db}, adet=${res.data.saved}, tablo=${res.data.tableName}, sütun sayısı=${res.data.columns}`);
    } catch (err) {
      alert("SQLite kaydetme hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // /rows → Son oluşturulan tablodan veri getir
  const fetchLastTableRows = async () => {
    if (!lastTableName) return alert("Önce 'Kaydet' yap ki tablo oluşsun.");
    try {
      const url = `${BACKEND_URL}/rows?table=${lastTableName}`;
      const res = await axios.get(url);
      setLastRows(res.data.data || []);
      console.log("Son tablo kayıtları:", res.data);
      alert(`Tablo ${lastTableName} → ${res.data.count} kayıt konsola yazıldı.`);
    } catch (err) {
      console.error(err);
      alert("Okuma hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // /batches → Son yüklenen tabloları listele
  const fetchBatches = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/batches`);
      setBatches(res.data.batches || []);
      console.log("Yüklenen tablolar:", res.data.batches);
    } catch (err) {
      alert("Batches hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // Sütun analizi ve tip tahmini
  const analyzeColumns = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    try {
      const res = await axios.post(`${BACKEND_URL}/analyze-columns`, { rows });
      setColumnAnalysis(res.data);
      
      // Varsayılan eşleme ayarlarını oluştur
      const defaultMappings = {};
      const defaultRenames = {};
      Object.keys(res.data.analysis).forEach(column => {
        defaultMappings[column] = {
          enabled: true,
          targetType: res.data.analysis[column].type,
          transformations: {
            trim: { enabled: false },
            uppercase: { enabled: false },
            lowercase: { enabled: false },
            date_format: { enabled: false, format: 'YYYY-MM-DD' },
            regex_replace: { enabled: false, pattern: '', replacement: '' },
            constant: { enabled: false, value: '' },
            formula: { enabled: false, expression: '' }
          }
        };
        
        // _EMPTY sütunları için varsayılan isim önerisi
        if (column.startsWith('_EMPTY')) {
          defaultRenames[column] = `Sütun_${column.replace('_EMPTY', '').replace('_', '') || '1'}`;
        } else {
          defaultRenames[column] = column;
        }
      });
      setColumnMappings(defaultMappings);
      setColumnRenames(defaultRenames);
      
      console.log("Sütun analizi:", res.data);
      alert(`Analiz tamamlandı: ${res.data.totalColumns} sütun, ${res.data.totalRows} satır`);
    } catch (err) {
      alert("Analiz hatası: " + (err.response?.data?.error || err.message));
        }
  };

  // Veri dönüştürme
  const transformData = async () => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    if (Object.keys(columnMappings).length === 0) return alert("Önce sütun analizi yap.");
    
    try {
      const transformations = {};
      const targetType = {};
      
      // Sadece aktif sütunları işle
      const activeColumns = Object.entries(columnMappings).filter(([col, mapping]) => mapping.enabled);
      
      // Veriyi yeniden adlandırılmış sütunlarla dönüştür
      const renamedRows = rows.map(row => {
        const newRow = {};
        activeColumns.forEach(([oldColumn, mapping]) => {
          const newColumnName = columnRenames[oldColumn] || oldColumn;
          newRow[newColumnName] = row[oldColumn];
        });
        return newRow;
      });
      
      // Dönüştürme kurallarını yeni sütun isimleriyle hazırla
      activeColumns.forEach(([oldColumn, mapping]) => {
        const newColumnName = columnRenames[oldColumn] || oldColumn;
        transformations[newColumnName] = mapping.transformations;
        targetType[newColumnName] = mapping.targetType;
      });
      
      const res = await axios.post(`${BACKEND_URL}/transform-data`, {
        rows: renamedRows,
        transformations,
        targetType
      });
      
      setTransformedRows(res.data.transformedRows);
      console.log("Dönüştürülmüş veriler:", res.data);
      
      if (res.data.errorCount > 0) {
        alert(`Dönüştürme tamamlandı. ${res.data.errorCount} hata oluştu.`);
      } else {
        alert(`Dönüştürme başarılı: ${res.data.totalRows} satır işlendi.`);
      }
    } catch (err) {
      alert("Dönüştürme hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // Excel export
  const exportToExcel = async () => {
    const dataToExport = transformedRows.length > 0 ? transformedRows : rows;
    if (dataToExport.length === 0) return alert("Dışa aktarılacak veri yok.");
    
    setProgress(0);
    setLogs([]);
    
    try {
      setProgress(10);
      addLog("Excel export başlatılıyor...");
      
      const res = await axios.post(`${BACKEND_URL}/export-excel`, {
        rows: dataToExport,
        fileName: `transformed_${fileName}`,
        sheetName: sheetName
      });
      
      setProgress(50);
      addLog("Excel dosyası oluşturuluyor...");
      
      // Base64'ten blob oluştur ve indir
      const byteCharacters = atob(res.data.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setProgress(100);
      addLog(`✅ Excel dosyası başarıyla indirildi: ${res.data.fileName}`);
      
      alert(`Excel dosyası indirildi: ${res.data.fileName}`);
    } catch (err) {
      addLog(`❌ Export hatası: ${err.response?.data?.error || err.message}`);
      alert("Export hatası: " + (err.response?.data?.error || err.message));
    }
  };

  // Detaylı log ekleme fonksiyonu
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleString('tr-TR');
    const logEntry = {
      timestamp,
      message,
      type, // 'info', 'success', 'error', 'warning'
      id: Date.now() + Math.random()
    };
    setLogs(prev => [...prev, logEntry]);
  };

  // İşlem geçmişi logları
  const logOperation = (operation, details) => {
    addLog(`🔄 ${operation}: ${details}`, 'info');
  };

  const logSuccess = (operation, details) => {
    addLog(`✅ ${operation}: ${details}`, 'success');
  };

  const logError = (operation, error) => {
    addLog(`❌ ${operation}: ${error}`, 'error');
  };

  // Genel ayarları uygula
  const applyGeneralSettings = () => {
    setLogs([]);
    logOperation('Genel Ayarlar', 'Uygulanıyor...');
    
    const globalTrim = document.getElementById('global-trim')?.checked;
    const globalUppercase = document.getElementById('global-uppercase')?.checked;
    const globalLowercase = document.getElementById('global-lowercase')?.checked;
    
    if (!globalTrim && !globalUppercase && !globalLowercase) {
      alert('En az bir genel ayar seçin!');
      return;
    }
    
    const newMappings = { ...columnMappings };
    Object.keys(newMappings).forEach(col => {
      if (newMappings[col]) {
        if (globalTrim) {
          newMappings[col].transformations.trim.enabled = true;
        }
        if (globalUppercase) {
          newMappings[col].transformations.uppercase.enabled = true;
          newMappings[col].transformations.lowercase.enabled = false;
        }
        if (globalLowercase) {
          newMappings[col].transformations.lowercase.enabled = true;
          newMappings[col].transformations.uppercase.enabled = false;
        }
      }
    });
    
    setColumnMappings(newMappings);
    logSuccess('Genel Ayarlar', `Trim: ${globalTrim}, Büyük: ${globalUppercase}, Küçük: ${globalLowercase}`);
  };

  // Sütun bazlı ayarları uygula
  const applyColumnSettings = () => {
    if (Object.keys(columnMappings).length === 0) {
      alert('Önce sütun analizi yap!');
      return;
    }
    
    setLogs([]);
    logOperation('Sütun Ayarları', 'Uygulanıyor...');
    
    let appliedCount = 0;
    Object.entries(columnMappings).forEach(([colName, mapping]) => {
      if (mapping.enabled) {
        appliedCount++;
        logSuccess('Sütun Ayarı', `${colName}: ${mapping.targetType} tipi, sabit değer: ${mapping.constantValue || 'yok'}`);
      }
    });
    
    logSuccess('Sütun Ayarları', `${appliedCount} sütun için ayarlar uygulandı`);
  };

  // Veri düzenleme fonksiyonları
  const applyColumnChanges = () => {
    if (Object.keys(pendingChanges).length === 0) {
      alert('Değişiklik yok!');
      return;
    }
    
    setLogs([]);
    logOperation('Sütun Değişiklikleri', 'Uygulanıyor...');
    
    // Sütun adı değişikliklerini uygula
    Object.entries(pendingChanges).forEach(([oldName, newName]) => {
      if (newName && newName !== oldName) {
        columnRenames[oldName] = newName;
        logSuccess('Sütun Adı', `"${oldName}" → "${newName}"`);
      }
    });
    
    setPendingChanges({});
    setEditingMode('none');
    logSuccess('Sütun Değişiklikleri', 'Tüm değişiklikler uygulandı');
  };

  const applyDataTransformations = () => {
    if (Object.keys(columnMappings).length === 0) {
      alert('Önce sütun analizi yap!');
      return;
    }
    
    setLogs([]);
    logOperation('Veri Dönüşümleri', 'Uygulanıyor...');
    
    // Veriyi dönüştür
    const activeColumns = Object.entries(columnMappings).filter(([col, mapping]) => mapping.enabled);
    const transformedRows = rows.map((row, index) => {
      const newRow = {};
      activeColumns.forEach(([oldColumn, mapping]) => {
        const newColumnName = columnRenames[oldColumn] || oldColumn;
        let value = row[oldColumn];
        
        // Sabit değer varsa kullan
        if (mapping.constantValue && mapping.constantValue.trim()) {
          value = mapping.constantValue;
        }
        
        // Tip dönüşümü uygula
        if (mapping.targetType && mapping.targetType !== 'auto') {
          value = convertDataType(value, mapping.targetType);
        }
        
        newRow[newColumnName] = value;
      });
      return newRow;
    });
    
    setTransformedRows(transformedRows);
    logSuccess('Veri Dönüşümleri', `${transformedRows.length} satır dönüştürüldü`);
  };

  const convertDataType = (value, targetType) => {
    if (!value) return value;
    
    switch (targetType) {
      case 'text':
        return String(value).trim();
      case 'number':
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
      case 'date':
        const date = new Date(value);
        return isNaN(date.getTime()) ? value : date.toISOString().split('T')[0];
      case 'boolean':
        return Boolean(value);
      default:
        return value;
    }
  };

  const editCell = (rowIndex, columnName, newValue) => {
    setEditedRows(prev => {
      const newRows = [...prev];
      if (!newRows[rowIndex]) newRows[rowIndex] = {};
      newRows[rowIndex][columnName] = newValue;
      return newRows;
    });
  };

  const applyCellChanges = () => {
    if (editedRows.length === 0) {
      alert('Düzenlenmiş hücre yok!');
      return;
    }
    
    setLogs([]);
    logOperation('Hücre Değişiklikleri', 'Uygulanıyor...');
    
    const newRows = rows.map((row, index) => {
      if (editedRows[index]) {
        const updatedRow = { ...row };
        Object.entries(editedRows[index]).forEach(([col, value]) => {
          updatedRow[col] = value;
          logSuccess('Hücre Değişikliği', `Satır ${index + 1}, Sütun "${col}": "${row[col]}" → "${value}"`);
        });
        return updatedRow;
      }
      return row;
    });
    
    setRows(newRows);
    setEditedRows([]);
    logSuccess('Hücre Değişiklikleri', 'Tüm değişiklikler uygulandı');
  };

  // Gelişmiş veritabanı kaydetme
  const saveToDatabaseAdvanced = async (dbType) => {
    if (rows.length === 0) return alert("Önce Excel dosyası seç.");
    if (Object.keys(columnMappings).length === 0) return alert("Önce sütun analizi yap.");
    
    setProgress(0);
    setLogs([]);
    
    try {
      logOperation('Veritabanı Kayıt', `${dbType.toUpperCase()} başlatılıyor...`);
      logOperation('Dosya Bilgisi', `${fileName} → ${sheetName}`);
      
      // Veriyi dönüştür
      const activeColumns = Object.entries(columnMappings).filter(([col, mapping]) => mapping.enabled);
      const renamedRows = rows.map(row => {
        const newRow = {};
        activeColumns.forEach(([oldColumn, mapping]) => {
          const newColumnName = columnRenames[oldColumn] || oldColumn;
          newRow[newColumnName] = row[oldColumn];
        });
        return newRow;
      });
      
      setProgress(20);
      logSuccess('Veri Hazırlama', `${renamedRows.length} satır hazırlandı`);
      
      // Kaydetme modunu belirle
      const tableName = saveMode === 'new' ? null : selectedTable;
      logOperation('Kaydetme Modu', saveMode === 'new' ? 'Yeni Tablo' : `Mevcut Tablo: ${selectedTable}`);
      
      // Veritabanına kaydet
      const endpoint = dbType === 'mssql' ? '/save' : 
                      dbType === 'postgres' ? '/save-pg' :
                      dbType === 'mysql' ? '/save-mysql' : '/save-sqlite';
      
      const res = await axios.post(`${BACKEND_URL}${endpoint}`, {
        rows: renamedRows,
        fileName: `transformed_${fileName}`,
        sheetName: sheetName,
        tableName: tableName,
        mode: saveMode
      });
      
      setProgress(80);
      logSuccess('Veritabanı Kayıt', `${res.data.saved} satır başarıyla kaydedildi`);
      logSuccess('Tablo Bilgisi', `Tablo: ${res.data.tableName}, Sütun: ${res.data.columns}`);
      
      setProgress(100);
      logSuccess('İşlem Tamamlandı', `${dbType.toUpperCase()} kayıt başarılı!`);
      
    } catch (err) {
      logError('Veritabanı Kayıt', err.response?.data?.error || err.message);
      alert(`${dbType.toUpperCase()} kayıt hatası: ${err.response?.data?.error || err.message}`);
    }
  };

  // ------------------ UI ------------------
  return (
    <div
      style={{
        padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#e7e7e7",
        background: "#121212",
        minHeight: "100vh",
      }}
    >
      <h2 style={{ marginBottom: 8 }}>
        React + Excel → Veritabanı (MSSQL / PostgreSQL / MySQL / SQLite)
      </h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Excel seç → JSON'a çevir → MSSQL'e yaz. Her Excel için ayrı tablo oluşturulur.
      </p>

      {/* Backend'e ping */}
      <div style={{ margin: "12px 0 16px" }}>
        <button onClick={pingBackend} style={{ padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>Backend'e bağlan (ping)</button>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {backendMsg ? `Cevap: ${backendMsg}` : ""}
        </span>
      </div>

      {/* DB bağlantı testi + kaydet/oku */}
      <div style={{ marginTop: 12 }}>
        <button onClick={testDbConnection} style={{ padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>MSSQL Bağlantıyı test et</button>
        <span style={{ marginLeft: 8 }}>{dbHealth}</span>

        <button onClick={testPg} style={{ marginLeft: 10, padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>PostgreSQL test</button>
        <span style={{ marginLeft: 8 }}>{pgHealth}</span>

        <button onClick={testMy} style={{ marginLeft: 10, padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>MySQL test</button>
        <span style={{ marginLeft: 8 }}>{myHealth}</span>

        <div style={{ display: 'inline-block', marginLeft: 10 }}>
          <select
            onChange={(e) => {
              if (e.target.value) {
                saveToDatabaseAdvanced(e.target.value);
                e.target.value = ''; // Reset selection
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              background: '#1f2937',
              color: '#f9fafb',
              border: '1px solid #4b5563',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            defaultValue=""
          >
            <option value="" disabled>💾 Veritabanına Kaydet</option>
            <option value="mssql">📊 MSSQL Server</option>
            <option value="postgres">🐘 PostgreSQL</option>
            <option value="mysql">🐬 MySQL</option>
            <option value="sqlite">📁 SQLite</option>
          </select>
        </div>

        {lastTableName && (
          <button onClick={fetchLastTableRows} style={{ marginLeft: 10, padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>
            Son tabloyu getir
          </button>
        )}

        <button onClick={fetchBatches} style={{ marginLeft: 10, padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }}>
          Yüklenen tabloları listele
        </button>

        <button onClick={analyzeColumns} style={{ marginLeft: 10, padding: '8px 16px', borderRadius: '6px', background: '#8b5cf6', color: 'white', cursor: 'pointer' }}>
          📊 Sütun Analizi
        </button>

        <button onClick={applyDataTransformations} style={{ marginLeft: 10, padding: '8px 16px', borderRadius: '6px', background: '#8b5cf6', color: 'white', cursor: 'pointer' }}>
          🎯 Dönüşümleri Uygula
        </button>

        <button onClick={transformData} style={{ marginLeft: 10, padding: '8px 16px', borderRadius: '6px', background: '#f59e0b', color: 'white', cursor: 'pointer' }}>
          🔄 Veri Dönüştür
        </button>

        <button onClick={exportToExcel} style={{ marginLeft: 10, padding: '8px 16px', borderRadius: '6px', background: '#10b981', color: 'white', cursor: 'pointer' }}>
          📥 Excel İndir
        </button>



        {lastTableName && (
          <span style={{ marginLeft: 10, opacity: 0.8 }}>
            Tablo: {lastTableName}
          </span>
        )}
      </div>

      {/* Drag and Drop Excel Upload */}
      <div style={{ marginTop: 24 }}>
        <div
          {...getRootProps()}
          style={{
            border: `2px dashed ${isDragActive ? '#3b82f6' : '#4b5563'}`,
            borderRadius: 8,
            padding: 40,
            textAlign: 'center',
            background: isDragActive ? '#1e3a8a' : '#1f2937',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <input {...getInputProps()} />
          {isDragActive ? (
            <p style={{ margin: 0, fontSize: 18, color: '#60a5fa' }}>
              Excel dosyasını buraya bırakın...
            </p>
          ) : (
            <div>
              <p style={{ margin: '0 0 16px 0', fontSize: 18 }}>
                Excel dosyasını sürükleyip bırakın
              </p>
              <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
                veya tıklayarak dosya seçin
              </p>
              <p style={{ margin: '8px 0 0 0', opacity: 0.5, fontSize: 12 }}>
                .xlsx, .xls dosyaları desteklenir
              </p>
            </div>
          )}
        </div>

        {/* Fallback File Input */}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px 0', opacity: 0.7 }}>veya</p>
          <button style={{ padding: '8px 16px', border: '1px solid #4b5563', borderRadius: '6px', background: '#1f2937', color: '#f9fafb', cursor: 'pointer' }} onClick={() => document.getElementById('file-input').click()}>
            Dosya Seç
          </button>
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
        </div>

        {/* File Info */}
        {fileName && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ margin: 0 }}>
              <b>Seçilen dosya:</b> {fileName}
              {sheetName ? ` | Sheet: ${sheetName}` : ""}
            </p>
            {rows.length > 0 && (
              <p style={{ margin: '4px 0 0 0', opacity: 0.8 }}>
                {rows.length} satır, {columns.length} sütun bulundu
              </p>
            )}
          </div>
        )}
      </div>

      {/* Hata mesajı */}
      {error && (
        <div style={{ color: "#ff8a8a", marginTop: 16, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Excel Preview Table */}
      {previewRows.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            Excel Önizleme (İlk 5 Satır)
          </h3>
          
          <div style={{ overflow: 'auto', borderRadius: 8, border: '1px solid #374151' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {columns.map((column) => (
                      <td key={column} style={{ 
                        background: rowIndex % 2 === 0 ? '#111827' : '#1f2937',
                        color: '#e5e7eb',
                        padding: '12px',
                        border: '1px solid #374151'
                      }}>
                        {String(row[column] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* JSON önizleme */}
      {rows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            JSON Önizleme (İlk 5 Satır)
          </h3>
          <pre
            style={{
              background: "#1e1e1e",
              padding: 16,
              borderRadius: 8,
              margin: '0 auto',
              overflow: "auto",
              maxHeight: 300,
              maxWidth: '90%',
              border: '1px solid #374151'
            }}
          >
            {JSON.stringify(previewRows, null, 2)}
          </pre>
        </div>
      )}

      {/* Son getirilen kayıtları göster */}
      {lastRows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            Son Getirilen Kayıtlar (Örnek 5)
          </h3>
          <pre
            style={{
              background: "#1e1e1e",
              padding: 16,
              borderRadius: 8,
              margin: '0 auto',
              overflow: "auto",
              maxHeight: 250,
              maxWidth: '90%',
              border: '1px solid #374151'
            }}
          >
            {JSON.stringify(lastRows.slice(0, 5), null, 2)}
          </pre>
        </div>
      )}

      {/* Basitleştirilmiş Veri Düzenleme Paneli */}
      {columnAnalysis && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            Veri Düzenleme Ayarları
          </h3>
          
          {/* Genel Ayarlar */}
          <div style={{ 
            border: '1px solid #374151', 
            padding: '16px', 
            background: '#1f2937',
            marginBottom: '16px',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>📋 Genel Ayarlar</h4>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id="global-trim"
                  onChange={(e) => {
                    const newMappings = { ...columnMappings };
                    Object.keys(newMappings).forEach(col => {
                      if (newMappings[col]) {
                        newMappings[col].transformations.trim.enabled = e.target.checked;
                      }
                    });
                    setColumnMappings(newMappings);
                  }}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="global-trim" style={{ color: '#e5e7eb', fontSize: '14px' }}>
                  ✂️ Tüm sütunlarda boşlukları temizle
                </label>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id="global-uppercase"
                  onChange={(e) => {
                    const newMappings = { ...columnMappings };
                    Object.keys(newMappings).forEach(col => {
                      if (newMappings[col]) {
                        newMappings[col].transformations.uppercase.enabled = e.target.checked;
                        newMappings[col].transformations.lowercase.enabled = false;
                      }
                    });
                    setColumnMappings(newMappings);
                  }}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="global-uppercase" style={{ color: '#e5e7eb', fontSize: '14px' }}>
                  🔤 Tüm sütunları büyük harfe çevir
                </label>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id="global-lowercase"
                  onChange={(e) => {
                    const newMappings = { ...columnMappings };
                    Object.keys(newMappings).forEach(col => {
                      if (newMappings[col]) {
                        newMappings[col].transformations.lowercase.enabled = e.target.checked;
                        newMappings[col].transformations.uppercase.enabled = false;
                      }
                    });
                    setColumnMappings(newMappings);
                  }}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="global-lowercase" style={{ color: '#e5e7eb', fontSize: '14px' }}>
                  🔤 Tüm sütunları küçük harfe çevir
                </label>
              </div>
            </div>
            
            <button
              onClick={applyGeneralSettings}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '12px'
              }}
            >
              ✅ Genel Ayarları Uygula
            </button>
          </div>
          
          {/* Tablo Yönetimi */}
          <div style={{ 
            border: '1px solid #374151', 
            padding: '16px', 
            background: '#1f2937',
            marginBottom: '16px',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>🗄️ Tablo Yönetimi</h4>
            <p style={{ margin: '0 0 16px 0', color: '#9ca3af', fontSize: '14px' }}>
              Veriyi nasıl kaydetmek istiyorsun?
            </p>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  id="new-table"
                  name="saveMode"
                  value="new"
                  checked={saveMode === 'new'}
                  onChange={(e) => setSaveMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="new-table" style={{ color: '#e5e7eb', fontSize: '14px' }}>
                  🆕 Yeni Tablo Oluştur
                </label>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  id="append-table"
                  name="saveMode"
                  value="append"
                  checked={saveMode === 'append'}
                  onChange={(e) => setSaveMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="append-table" style={{ color: '#e5e7eb', fontSize: '14px' }}>
                  ➕ Mevcut Tabloya Ekle
                </label>
              </div>
            </div>
            
            {saveMode === 'append' && (
              <div style={{ marginTop: '12px' }}>
                <label style={{ color: '#e5e7eb', fontSize: '14px', marginRight: '8px' }}>
                  Mevcut Tablo:
                </label>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    background: '#374151',
                    color: '#f9fafb',
                    border: '1px solid #4b5563',
                    fontSize: '14px',
                    minWidth: '200px'
                  }}
                >
                  <option value="">Tablo seç...</option>
                  {batches.map((batch, i) => (
                    <option key={i} value={batch.TableName}>
                      {batch.TableName} ({batch.RowCount} satır)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Sütun Yeniden Adlandırma */}
          <div style={{ 
            border: '1px solid #374151', 
            padding: '16px', 
            background: '#1f2937',
            marginBottom: '16px',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>✏️ Sütun İsimlerini Düzenle</h4>
            <p style={{ margin: '0 0 16px 0', color: '#9ca3af', fontSize: '14px' }}>
              Sütun isimlerini değiştir veya boş sütunları gizle:
            </p>
            
            <div style={{ overflow: "auto", maxHeight: '200px', marginBottom: '16px' }}>
              {Object.entries(columnAnalysis.analysis).map(([columnName, analysis], i) => (
                <div key={i} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '8px', 
                  background: i % 2 === 0 ? '#111827' : '#1f2937',
                  marginBottom: '4px',
                  borderRadius: '4px'
                }}>
                  <input
                    type="checkbox"
                    checked={columnMappings[columnName]?.enabled || false}
                    onChange={(e) => {
                      const newMappings = { ...columnMappings };
                      newMappings[columnName].enabled = e.target.checked;
                      setColumnMappings(newMappings);
                    }}
                    style={{ marginRight: '12px' }}
                  />
                  <span style={{ color: '#e5e7eb', fontSize: '13px', minWidth: '120px' }}>
                    {columnName.startsWith('_EMPTY') ? '❌ Boş Sütun' : '✅ Dolu Sütun'}:
                  </span>
                  <input
                    type="text"
                    value={columnRenames[columnName] || columnName}
                    onChange={(e) => {
                      const newRenames = { ...columnRenames };
                      newRenames[columnName] = e.target.value;
                      setColumnRenames(newRenames);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: '#374151',
                      color: '#f9fafb',
                      border: '1px solid #4b5563',
                      fontSize: '12px',
                      flex: 1,
                      marginRight: '8px'
                    }}
                    placeholder="Yeni sütun adı"
                  />
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    background: analysis.type === 'string' ? '#3b82f6' : 
                              analysis.type === 'number' ? '#10b981' :
                              analysis.type === 'date' ? '#f59e0b' :
                              analysis.type === 'boolean' ? '#8b5cf6' : '#6b7280',
                    color: 'white'
                  }}>
                    {analysis.type === 'string' ? 'Metin' : 
                     analysis.type === 'number' ? 'Sayı' :
                     analysis.type === 'date' ? 'Tarih' :
                     analysis.type === 'boolean' ? 'E/H' : '?'}
                  </span>
                </div>
              ))}
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const newRenames = { ...columnRenames };
                  Object.keys(columnAnalysis.analysis).forEach(col => {
                    if (col.startsWith('_EMPTY')) {
                      newRenames[col] = `Sütun_${col.replace('_EMPTY', '').replace('_', '') || '1'}`;
                    }
                  });
                  setColumnRenames(newRenames);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                🔄 Boş Sütunları Otomatik Adlandır
              </button>
              
              <button
                onClick={() => {
                  const newMappings = { ...columnMappings };
                  Object.keys(columnAnalysis.analysis).forEach(col => {
                    if (col.startsWith('_EMPTY')) {
                      newMappings[col].enabled = false;
                    }
                  });
                  setColumnMappings(newMappings);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                🚫 Boş Sütunları Gizle
              </button>

              <button
                onClick={applyColumnChanges}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ✅ Değişiklikleri Uygula
              </button>
            </div>
          </div>
          
          {/* Hücre Düzenleme */}
          <div style={{ 
            border: '1px solid #374151', 
            padding: '16px', 
            background: '#1f2937',
            marginBottom: '16px',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>📝 Hücre Düzenleme</h4>
            <p style={{ margin: '0 0 16px 0', color: '#9ca3af', fontSize: '14px' }}>
              Tek tek hücreleri düzenle (İlk 10 satır gösteriliyor):
            </p>
            
            <div style={{ overflow: "auto", maxHeight: '300px', marginBottom: '16px' }}>
              {rows.slice(0, 10).map((row, rowIndex) => (
                <div key={rowIndex} style={{ 
                  border: '1px solid #374151', 
                  padding: '8px', 
                  background: rowIndex % 2 === 0 ? '#111827' : '#1f2937',
                  marginBottom: '4px',
                  borderRadius: '4px'
                }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    Satır {rowIndex + 1}:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {Object.entries(row).slice(0, 5).map(([columnName, value], colIndex) => (
                      <div key={colIndex} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#6b7280', minWidth: '60px' }}>
                          {columnName}:
                        </span>
                        <input
                          type="text"
                          value={editedRows[rowIndex]?.[columnName] ?? value}
                          onChange={(e) => editCell(rowIndex, columnName, e.target.value)}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            background: '#374151',
                            color: '#f9fafb',
                            border: '1px solid #4b5563',
                            fontSize: '11px',
                            width: '80px'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={applyCellChanges}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              ✅ Hücre Değişikliklerini Uygula
            </button>
          </div>

          {/* Sütun Bazlı Ayarlar */}
          <div style={{ 
            border: '1px solid #374151', 
            padding: '16px', 
            background: '#1f2937',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>🎯 Sütun Bazlı Ayarlar</h4>
            <p style={{ margin: '0 0 16px 0', color: '#9ca3af', fontSize: '14px' }}>
              Hangi sütunları işlemek istediğini seç ve her sütun için özel ayarlar yap:
            </p>
            
            <div style={{ overflow: "auto", maxHeight: '300px' }}>
              {Object.entries(columnAnalysis.analysis).map(([columnName, analysis], i) => (
                <div key={i} style={{ 
                  border: '1px solid #374151', 
                  padding: '12px', 
                  background: i % 2 === 0 ? '#111827' : '#1f2937',
                  marginBottom: '8px',
                  borderRadius: '6px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={columnMappings[columnName]?.enabled || false}
                      onChange={(e) => {
                        const newMappings = { ...columnMappings };
                        if (!newMappings[columnName]) {
                          newMappings[columnName] = {
                            enabled: true,
                            targetType: analysis.type,
                            transformations: {
                              trim: { enabled: false },
                              uppercase: { enabled: false },
                              lowercase: { enabled: false },
                              date_format: { enabled: false, format: 'YYYY-MM-DD' },
                              regex_replace: { enabled: false, pattern: '', replacement: '' },
                              constant: { enabled: false, value: '' },
                              formula: { enabled: false, expression: '' }
                            }
                          };
                        }
                        newMappings[columnName].enabled = e.target.checked;
                        setColumnMappings(newMappings);
                      }}
                      style={{ marginRight: '12px' }}
                    />
                    <h5 style={{ margin: 0, color: '#f9fafb', flex: 1, fontSize: '14px' }}>{columnName}</h5>
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      background: analysis.type === 'string' ? '#3b82f6' : 
                                analysis.type === 'number' ? '#10b981' :
                                analysis.type === 'date' ? '#f59e0b' :
                                analysis.type === 'boolean' ? '#8b5cf6' : '#6b7280',
                      color: 'white',
                      marginRight: '8px'
                    }}>
                      {analysis.type === 'string' ? 'Metin' : 
                       analysis.type === 'number' ? 'Sayı' :
                       analysis.type === 'date' ? 'Tarih' :
                       analysis.type === 'boolean' ? 'Evet/Hayır' : 'Bilinmiyor'}
                    </span>
                  </div>
                  
                  {columnMappings[columnName]?.enabled && (
                    <div style={{ marginLeft: '24px', fontSize: '13px' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ color: '#e5e7eb', marginRight: '8px' }}>Veri Tipi:</label>
                        <select
                          value={columnMappings[columnName]?.targetType || 'string'}
                          onChange={(e) => {
                            const newMappings = { ...columnMappings };
                            newMappings[columnName].targetType = e.target.value;
                            setColumnMappings(newMappings);
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: '#374151',
                            color: '#f9fafb',
                            border: '1px solid #4b5563',
                            fontSize: '12px'
                          }}
                        >
                          <option value="string">Metin</option>
                          <option value="number">Sayı</option>
                          <option value="date">Tarih</option>
                          <option value="boolean">Evet/Hayır</option>
                        </select>
                      </div>
                      
                      <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={columnMappings[columnName]?.transformations?.constant?.enabled || false}
                          onChange={(e) => {
                            const newMappings = { ...columnMappings };
                            newMappings[columnName].transformations.constant.enabled = e.target.checked;
                            setColumnMappings(newMappings);
                          }}
                          style={{ marginRight: '6px' }}
                        />
                        <span style={{ color: '#e5e7eb', marginRight: '6px' }}>Sabit Değer:</span>
                        <input
                          type="text"
                          value={columnMappings[columnName]?.transformations?.constant?.value || ''}
                          onChange={(e) => {
                            const newMappings = { ...columnMappings };
                            newMappings[columnName].transformations.constant.value = e.target.value;
                            setColumnMappings(newMappings);
                          }}
                          disabled={!columnMappings[columnName]?.transformations?.constant?.enabled}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: '#374151',
                            color: '#f9fafb',
                            border: '1px solid #4b5563',
                            width: '150px',
                            fontSize: '12px'
                          }}
                          placeholder="Değer girin"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <button
              onClick={applyColumnSettings}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '12px'
              }}
            >
              ✅ Sütun Ayarlarını Uygula
            </button>
          </div>
        </div>
      )}

      {/* Sütun Analizi Sonuçları */}
      {columnAnalysis && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            Sütun Analizi ve Tip Tahmini
          </h3>
          <div style={{ overflow: "auto", borderRadius: 8, border: '1px solid #374151' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Sütun Adı</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Tahmin Edilen Tip</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Güven (%)</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Boş Değer (%)</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Örnek Değerler</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(columnAnalysis.analysis).map(([columnName, analysis], i) => (
                  <tr key={i}>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151',
                      fontWeight: 'bold'
                    }}>
                      {columnName}
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        background: analysis.type === 'string' ? '#3b82f6' : 
                                  analysis.type === 'number' ? '#10b981' :
                                  analysis.type === 'date' ? '#f59e0b' :
                                  analysis.type === 'boolean' ? '#8b5cf6' : '#6b7280',
                        color: 'white'
                      }}>
                        {analysis.type.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {analysis.confidence}%
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {analysis.nullPercentage}%
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151',
                      fontSize: '12px'
                    }}>
                      {analysis.sampleValues.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Yüklenen tablolar listesi */}
      {batches.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            Yüklenen Tablolar (Son 50)
          </h3>
          <div style={{ overflow: "auto", borderRadius: 8, border: '1px solid #374151' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Tablo Adı</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Orijinal Dosya</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Satır Sayısı</th>
                  <th style={{ background: '#1f2937', color: '#f9fafb', padding: '12px', textAlign: 'left', border: '1px solid #374151' }}>Oluşturulma Tarihi</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch, i) => (
                  <tr key={i}>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {batch.TableName}
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {batch.OriginalFileName}
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {batch.RowCount}
                    </td>
                    <td style={{ 
                      background: i % 2 === 0 ? '#111827' : '#1f2937',
                      color: '#e5e7eb',
                      padding: '12px',
                      border: '1px solid #374151'
                    }}>
                      {new Date(batch.CreatedAt).toLocaleString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Progress Bar ve Loglar */}
      {(progress > 0 || logs.length > 0) && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>
            📊 İşlem Durumu ve Loglar
          </h3>
          
          {/* Progress Bar */}
          {progress > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ 
                width: '100%', 
                height: '20px', 
                background: '#374151', 
                borderRadius: '10px', 
                overflow: 'hidden',
                marginBottom: '8px'
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: progress === 100 ? '#10b981' : '#3b82f6',
                  transition: 'width 0.3s ease',
                  borderRadius: '10px'
                }}></div>
              </div>
              <div style={{ textAlign: 'center', color: '#e5e7eb', fontSize: '14px' }}>
                {progress}% tamamlandı
              </div>
            </div>
          )}
          
          {/* Loglar */}
          {logs.length > 0 && (
            <div style={{ 
              background: '#1f2937', 
              border: '1px solid #374151', 
              borderRadius: '8px', 
              padding: '16px',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#f9fafb' }}>📝 Detaylı İşlem Logları</h4>
              {logs.map((log, index) => (
                <div key={log.id || index} style={{ 
                  marginBottom: '6px', 
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: log.type === 'error' ? '#1f2937' : 
                             log.type === 'success' ? '#064e3b' : '#1f2937',
                  border: `1px solid ${log.type === 'error' ? '#ef4444' : 
                                     log.type === 'success' ? '#10b981' : '#374151'}`
                }}>
                  <div style={{ 
                    color: '#9ca3af', 
                    fontSize: '10px', 
                    marginBottom: '2px' 
                  }}>
                    {log.timestamp}
                  </div>
                  <div style={{ 
                    color: log.type === 'error' ? '#ef4444' : 
                           log.type === 'success' ? '#10b981' : '#e5e7eb'
                  }}>
                    {log.message}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setLogs([])}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    background: '#dc2626',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  🗑️ Logları Temizle
                </button>
                <button
                  onClick={() => {
                    const logText = logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
                    navigator.clipboard.writeText(logText);
                    alert('Loglar kopyalandı!');
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    background: '#059669',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  📋 Logları Kopyala
                </button>
                <button
                  onClick={() => {
                    const successCount = logs.filter(log => log.type === 'success').length;
                    const errorCount = logs.filter(log => log.type === 'error').length;
                    alert(`📊 Log Özeti:\n✅ Başarılı: ${successCount}\n❌ Hata: ${errorCount}\n📝 Toplam: ${logs.length}`);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  📊 Log Özeti
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No file selected message */}
      {!fileName && (
        <div style={{ marginTop: 32, textAlign: 'center', opacity: 0.6 }}>
          <p>Bir Excel dosyası seçtiğinde, ilk sayfasını JSON'a çevirip burada göstereceğim.</p>
        </div>
      )}
    </div>
  );
}
