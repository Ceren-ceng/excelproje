# 📊 Excel → Veritabanı Dönüştürme Projesi

Bu proje, Excel dosyalarını çeşitli veritabanlarına (MSSQL, PostgreSQL, MySQL, SQLite) dönüştürmek için geliştirilmiş kapsamlı bir web uygulamasıdır.

## 🚀 Özellikler

### ✅ Tamamlanan Özellikler
- **Çoklu Veritabanı Desteği**: MSSQL, PostgreSQL, MySQL, SQLite
- **Excel İşleme**: Drag & drop, dosya seçimi, JSON dönüştürme
- **Sütun Analizi**: Otomatik tip tahmini, güven oranları
- **Veri Dönüştürme**: Trim, uppercase, lowercase, tarih formatı
- **Veri Doğrulama**: Otomatik validation kuralları, kalite skoru
- **Veri Temizleme**: Otomatik düzeltmeler, hata giderme
- **Tablo Yönetimi**: Yeni tablo oluşturma, mevcut tabloya ekleme
- **Excel Export**: Dönüştürülmüş verileri Excel olarak indirme
- **Progress Tracking**: İşlem durumu ve detaylı loglar
- **Hücre Düzenleme**: Tek tek hücre değiştirme
- **Sütun Yeniden Adlandırma**: Boş sütunları gizleme/adlandırma

### 🔄 Devam Edilebilecek Özellikler
- Gelişmiş filtreleme ve arama
- Bulk operations (toplu güncelleme)
- Veri görselleştirme (grafikler)
- API documentation
- Authentication sistemi
- Performance optimizasyonları

## 🛠️ Kurulum

### Gereksinimler
- Node.js (v16 veya üzeri)
- Veritabanı bağlantıları (MSSQL, PostgreSQL, MySQL, SQLite)

### 1. Projeyi İndirin
```bash
git clone <repository-url>
cd excel-proje
```

### 2. Backend Bağımlılıklarını Yükleyin
```bash
cd server
npm install
```

### 3. Frontend Bağımlılıklarını Yükleyin
```bash
cd ../client
npm install
```

### 4. Veritabanı Ayarlarını Yapılandırın
`server/index.js` dosyasında veritabanı bağlantı ayarlarını düzenleyin:

```javascript
// MSSQL Ayarları
const MSSQL_ENABLED = true;
const MSSQL_SERVER = "localhost";
const MSSQL_DATABASE = "ExcelDemo";
const MSSQL_USER = "appuser";
const MSSQL_PASSWORD = "9876.";

// PostgreSQL Ayarları
const POSTGRES_ENABLED = true;
const POSTGRES_HOST = "localhost";
const POSTGRES_PORT = 5432;
const POSTGRES_DATABASE = "ExcelDemoPG";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "1234";

// MySQL Ayarları
const MYSQL_ENABLED = true;
const MYSQL_HOST = "localhost";
const MYSQL_PORT = 3306;
const MYSQL_DATABASE = "ExcelDemoMySQL";
const MYSQL_USER = "root";
const MYSQL_PASSWORD = "1234";

// SQLite Ayarları
const SQLITE_ENABLED = true;
const SQLITE_DATABASE = "./excel_demo.sqlite";
```

## 🚀 Çalıştırma

### 1. Backend'i Başlatın
```bash
cd server
node index.js
```
Backend http://localhost:5000 adresinde çalışacaktır.

### 2. Frontend'i Başlatın
```bash
cd client
npm run dev
```
Frontend http://localhost:5173 adresinde çalışacaktır.

## 📖 Kullanım

### 1. Excel Dosyası Yükleme
- Excel dosyasını sürükleyip bırakın veya "Dosya Seç" butonuna tıklayın
- Desteklenen formatlar: .xlsx, .xls

### 2. Veri Analizi
- "📊 Sütun Analizi" butonuna tıklayın
- Otomatik tip tahmini ve güven oranlarını görün

### 3. Veri Doğrulama
- "🔍 Veri Doğrula" butonuna tıklayın
- Veri kalitesi skorunu ve hataları görün
- "🧹 Veri Temizle" ile otomatik düzeltmeler yapın

### 4. Veri Düzenleme
- Sütun isimlerini değiştirin
- Hücre değerlerini düzenleyin
- Genel ayarları uygulayın

### 5. Veritabanına Kaydetme
- Hedef veritabanını seçin (MSSQL, PostgreSQL, MySQL, SQLite)
- "💾 Veritabanına Kaydet" butonuna tıklayın
- Yeni tablo oluşturun veya mevcut tabloya ekleyin

### 6. Excel Export
- "📥 Excel İndir" butonuna tıklayın
- Dönüştürülmüş verileri Excel formatında indirin

## 🔧 API Endpoints

### Temel Endpoints
- `GET /test` - Backend durumu
- `GET /health` - Veritabanı bağlantısı
- `POST /save` - MSSQL'e kaydet
- `POST /save-pg` - PostgreSQL'e kaydet
- `POST /save-mysql` - MySQL'e kaydet
- `POST /save-sqlite` - SQLite'a kaydet

### Analiz Endpoints
- `POST /analyze-columns` - Sütun analizi
- `POST /transform-data` - Veri dönüştürme
- `POST /export-excel` - Excel export

### Validation Endpoints
- `POST /validate-data` - Veri doğrulama
- `POST /clean-data` - Veri temizleme
- `GET /validation-types` - Validation tipleri

### Veri Endpoints
- `GET /rows?table=<tableName>` - Tablo verilerini getir
- `GET /batches` - Yüklenen tabloları listele

## 📊 Veri Doğrulama Sistemi

### Desteklenen Validation Tipleri
- `required` - Zorunlu alan
- `email` - Email formatı
- `phone` - Telefon numarası
- `url` - URL formatı
- `min_length` - Minimum uzunluk
- `max_length` - Maksimum uzunluk
- `min_value` - Minimum değer
- `max_value` - Maksimum değer
- `regex` - Regex pattern
- `date_range` - Tarih aralığı
- `enum` - Enum değerleri

### Örnek Validation Rule
```javascript
{
  "email": [
    {
      "type": "required",
      "message": "Email is required"
    },
    {
      "type": "email",
      "message": "Must be a valid email address"
    }
  ],
  "age": [
    {
      "type": "min_value",
      "params": 0,
      "message": "Age must be positive"
    },
    {
      "type": "max_value",
      "params": 120,
      "message": "Age must be less than 120"
    }
  ]
}
```

## 🎯 Sonraki Adımlar

### Kısa Vadeli (1-2 Hafta)
1. **Gelişmiş Filtreleme**: Tarih aralığı, sayısal filtreleme
2. **Bulk Operations**: Toplu veri güncelleme
3. **UI/UX İyileştirmeleri**: Dark/light theme, responsive design

### Orta Vadeli (1-2 Ay)
1. **Dashboard**: Veri kalitesi metrikleri
2. **Template System**: Önceden tanımlı dönüşüm şablonları
3. **Collaboration**: Kullanıcı yönetimi, rol tabanlı erişim

### Uzun Vadeli (3+ Ay)
1. **AI/ML Integration**: Otomatik veri temizleme
2. **Enterprise Features**: SSO, advanced security
3. **Scalability**: Microservices, cloud deployment

## 🐛 Sorun Giderme

### Backend Bağlantı Sorunları
1. Veritabanı ayarlarını kontrol edin
2. Veritabanının çalıştığından emin olun
3. Firewall ayarlarını kontrol edin

### Frontend Sorunları
1. Node.js sürümünü kontrol edin
2. Bağımlılıkları yeniden yükleyin: `npm install`
3. Browser cache'ini temizleyin

### Veri Doğrulama Sorunları
1. Excel dosyasının formatını kontrol edin
2. Sütun analizini tekrar çalıştırın
3. Validation kurallarını gözden geçirin

## 📝 Lisans

Bu proje MIT lisansı altında lisanslanmıştır.

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push yapın (`git push origin feature/amazing-feature`)
5. Pull Request oluşturun

## 📞 İletişim

Sorularınız için issue açabilir veya email gönderebilirsiniz.

