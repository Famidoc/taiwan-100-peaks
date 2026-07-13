import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import sharp from 'sharp';

// 確保路徑定義正確
const SOURCE_DIR = 'D:/電子相本/01小百岳搜奇';
const EXCEL_PATH = path.join(SOURCE_DIR, '小百岳搜奇.xlsx');

// 自動尋找適當的 KML 檔名
let kmlFileName = '小百岳搜奇.kml';
if (!fs.existsSync(path.join(SOURCE_DIR, kmlFileName))) {
  if (fs.existsSync(path.join(SOURCE_DIR, '小百岳搜奇--收齊小百岳.kml'))) {
    kmlFileName = '小百岳搜奇--收齊小百岳.kml';
  }
}
const KML_PATH = path.join(SOURCE_DIR, kmlFileName);

const OUTPUT_DATA_DIR = path.resolve('public/data');
const OUTPUT_IMAGES_DIR = path.resolve('public/images');

// 確保輸出目錄存在
if (!fs.existsSync(OUTPUT_DATA_DIR)) {
  fs.mkdirSync(OUTPUT_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUT_IMAGES_DIR)) {
  fs.mkdirSync(OUTPUT_IMAGES_DIR, { recursive: true });
}

// 檢查必要檔案
if (!fs.existsSync(EXCEL_PATH) || !fs.existsSync(KML_PATH)) {
  console.error('\n❌ 找不到必要的資料檔案！');
  console.log(`請確認您已下載並將以下檔案放置於: ${SOURCE_DIR}`);
  console.log(`- 1. Excel 表: 小百岳搜奇.xlsx (目前狀態: ${fs.existsSync(EXCEL_PATH) ? '✅ 已放置' : '❌ 未找到'})`);
  console.log(`- 2. KML 地圖: 小百岳搜奇.kml (目前狀態: ${fs.existsSync(KML_PATH) ? '✅ 已放置' : '❌ 未找到'})`);
  console.log('\n請完成上述步驟後，再次執行此腳本。\n');
  process.exit(1);
}

// 解析 KML 地圖座標
function parseKml(kmlPath) {
  console.log('🔍 正在解析 KML 地圖檔案...');
  const kmlContent = fs.readFileSync(kmlPath, 'utf8');
  const placemarks = [];
  
  // 使用正則表達式解析 Placemark
  const placemarkRegex = /<Placemark[\s\S]*?>([\s\S]*?)<\/Placemark>/g;
  const nameRegex = /<name>([\s\S]*?)<\/name>/;
  const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/;
  
  let match;
  while ((match = placemarkRegex.exec(kmlContent)) !== null) {
    const content = match[1];
    const nameMatch = nameRegex.exec(content);
    const coordMatch = coordRegex.exec(content);
    
    if (nameMatch && coordMatch) {
      const name = nameMatch[1].trim();
      const coordStr = coordMatch[1].trim();
      // 座標格式通常是 "lng,lat,alt" 或 "lng,lat"
      const parts = coordStr.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        placemarks.push({ name, lat, lng });
      }
    }
  }
  
  console.log(`✅ KML 解析完成，共尋找到 ${placemarks.length} 個標記點位。`);
  return placemarks;
}

// 解析 Excel 檔案
function parseExcel(excelPath) {
  console.log('🔍 正在解析 Excel 紀錄表...');
  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // 轉成 JSON 陣列
  const rawData = xlsx.utils.sheet_to_json(sheet);
  console.log(`✅ Excel 解析完成，共載入 ${rawData.length} 筆列紀錄。`);
  return rawData;
}

// 壓縮照片為 WebP (加入快取機制避免重複壓縮)
async function processImages(dirPath, peakId) {
  const files = fs.readdirSync(dirPath);
  // 過濾出圖片檔案
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const imageFiles = files
    .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })); // 按檔名排序

  if (imageFiles.length === 0) {
    return { routeImage: null, photos: [] };
  }

  const targetDir = path.join(OUTPUT_IMAGES_DIR, peakId);
  
  // ==========================================
  // ⚡ 快取檢查：若照片皆已處理過，則直接跳過，省去 99% 的轉檔時間
  // ==========================================
  const hasRouteImages = fs.existsSync(path.join(targetDir, 'route.webp')) && 
                         fs.existsSync(path.join(targetDir, 'route_thumb.webp'));

  if (fs.existsSync(targetDir) && hasRouteImages) {
    let allExist = true;
    const cachedPhotos = [];
    
    for (let i = 1; i < imageFiles.length; i++) {
      const destName = `img_${i}`;
      const largePath = path.join(targetDir, `${destName}.webp`);
      const thumbPath = path.join(targetDir, `${destName}_thumb.webp`);
      
      if (!fs.existsSync(largePath) || !fs.existsSync(thumbPath)) {
        allExist = false;
        break;
      }
      
      cachedPhotos.push({
        large: `/images/${peakId}/${destName}.webp`,
        thumb: `/images/${peakId}/${destName}_thumb.webp`
      });
    }
    
    if (allExist) {
      console.log(`⚡ [No.${peakId}] 照片已存在，使用快取跳過壓縮。`);
      return {
        routeImage: {
          large: `/images/${peakId}/route.webp`,
          thumb: `/images/${peakId}/route_thumb.webp`
        },
        photos: cachedPhotos
      };
    }
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const result = {
    routeImage: null, // 首圖 (路線圖)
    photos: []       // 其他風景照
  };

  console.log(`📸 正在壓縮小百岳編號 ${peakId} 的照片 (共 ${imageFiles.length} 張)...`);

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const srcPath = path.join(dirPath, file);
    
    // 第一張照片作為登山路線圖（首圖）
    const isRoute = i === 0;
    const destName = isRoute ? 'route' : `img_${i}`;
    
    const largeDestPath = path.join(targetDir, `${destName}.webp`);
    const thumbDestPath = path.join(targetDir, `${destName}_thumb.webp`);

    try {
      // 壓縮大圖 (最大寬度 1200px, 質量 80%)
      await sharp(srcPath)
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .toFormat('webp', { quality: 80 })
        .toFile(largeDestPath);

      // 壓縮縮圖 (最大寬度 400px, 質量 70%)
      await sharp(srcPath)
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .toFormat('webp', { quality: 70 })
        .toFile(thumbDestPath);

      const paths = {
        large: `/images/${peakId}/${destName}.webp`,
        thumb: `/images/${peakId}/${destName}_thumb.webp`
      };

      if (isRoute) {
        result.routeImage = paths;
      } else {
        result.photos.push(paths);
      }
    } catch (err) {
      console.error(`❌ 壓縮照片失敗 ${file}:`, err.message);
    }
  }

  return result;
}

// 主執行流程
async function main() {
  try {
    const kmlData = parseKml(KML_PATH);
    const excelData = parseExcel(EXCEL_PATH);
    
    // 讀取本地的子資料夾
    const items = fs.readdirSync(SOURCE_DIR);
    const subDirs = items
      .filter(item => {
        const itemPath = path.join(SOURCE_DIR, item);
        return fs.statSync(itemPath).isDirectory() && /^\d{3}/.test(item);
      })
      .sort();

    console.log(`📂 偵測到 ${subDirs.length} 個符合編號格式的小百岳資料夾。`);

    const finalPeaks = [];

    for (const dirName of subDirs) {
      // 解析資料夾名稱，格式例如: "001三汀山@20210120" 或 "024紅毛埤山地20210921" 或 "100紅頭山@20230405~07"
      // 使用 regex 匹配編號與名字
      const match = dirName.match(/^(\d{3})([^\@]+)(?:@(.*))?$/);
      if (!match) continue;

      const peakId = match[1];
      const peakName = match[2].trim();
      const folderDate = match[3] ? match[3].trim() : '';

      console.log(`\n----------------------------------------`);
      console.log(`⛰️ [${peakId}] ${peakName} (資料夾日期: ${folderDate})`);

      // 1. 處理照片
      const dirPath = path.join(SOURCE_DIR, dirName);
      const imagesInfo = await processImages(dirPath, peakId);

      // 2. 匹配 KML 中的點位
      // 優先使用 KML 名稱括號中的「小百岳編號」進行 100% 精確匹配 (例如: "小百岳搜001")
      let matchedLocation = kmlData.find(loc => {
        const idMatch = loc.name.match(/小百岳搜(?:奇)?(\d+)/);
        if (idMatch) {
          return parseInt(idMatch[1]) === parseInt(peakId);
        }
        return false;
      });

      // 如果用編號配對不到，再使用名稱模糊匹配作為備用方案 (支援「子/仔」互換)
      if (!matchedLocation) {
        matchedLocation = kmlData.find(loc => {
          const cleanKmlName = loc.name.replace(/\s+/g, '');
          const normalize = str => str.replace(/仔/g, '子');
          const normKml = normalize(cleanKmlName);
          const normPeak = normalize(peakName);
          return normKml.includes(normPeak) || normPeak.includes(normKml);
        });
      }

      const location = matchedLocation 
        ? { lat: matchedLocation.lat, lng: matchedLocation.lng } 
        : { lat: null, lng: null };

      if (!location.lat) {
        console.warn(`⚠️ 警告: 未在地圖 KML 中找到與「${peakName}」完全匹配的點位，請確認地圖中是否有此標記。`);
      }

      // 3. 匹配 Excel 中的數據。我們假設 Excel 中有類似「編號」或「山名」的欄位
      // 我們會在轉換時列印出 Excel 的第一筆資料欄位，讓使用者了解匹配狀況
      const matchedExcelRow = excelData.find(row => {
        // 檢查是否有欄位值與編號匹配
        const keys = Object.keys(row);
        
        // 檢查是否有欄位值與編號匹配
        const idMatch = keys.some(key => {
          const val = String(row[key]).trim();
          // 去除前導零進行比較，例如 "001" 與 "1"
          return parseInt(val) === parseInt(peakId);
        });

        // 或者是名稱匹配
        const nameMatch = keys.some(key => {
          const val = String(row[key]).trim();
          return val.includes(peakName) || peakName.includes(val);
        });

        return idMatch || nameMatch;
      }) || {};

      finalPeaks.push({
        id: peakId,
        name: peakName,
        folderDate,
        location: {
          lat: matchedLocation.lat,
          lng: matchedLocation.lng
        },
        routeImage: imagesInfo.routeImage,
        photos: imagesInfo.photos,
        details: matchedExcelRow // 完整的 Excel 欄位資訊
      });
    }

    // 輸出最終的 JSON 檔案
    const outputPath = path.join(OUTPUT_DATA_DIR, 'peaks.json');
    fs.writeFileSync(outputPath, JSON.stringify(finalPeaks, null, 2), 'utf8');
    console.log(`\n🎉 轉換完成！已成功產生 ${finalPeaks.length} 筆小百岳資料庫。`);
    console.log(`💾 輸出檔案位置: ${outputPath}`);

  } catch (err) {
    console.error('❌ 執行過程中發生錯誤:', err);
  }
}

main();
