import './style.css';
import L from 'leaflet';

// 確保 Leaflet 預設 icon 的路徑正確
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// 全域狀態管理
let peaksData = [];
let filteredPeaks = [];
let map = null;
let markers = [];
let currentCarouselIndex = 0;
let carouselPhotos = [];

// ==========================================================================
// 數據適配器 (適配用戶自訂的 Excel 欄位)
// ==========================================================================
function getDetailsValue(details, keys) {
  if (!details) return '';
  for (const key of keys) {
    // 模糊匹配欄位名稱，去除空格
    const matchedKey = Object.keys(details).find(k => 
      k.replace(/\s+/g, '').includes(key.replace(/\s+/g, ''))
    );
    if (matchedKey && details[matchedKey] !== undefined) {
      return String(details[matchedKey]).trim();
    }
  }
  return '';
}

// 試圖轉換 Excel 日期數值
function formatExcelDate(dateStr) {
  if (!dateStr) return '';
  // 檢查是否是 Excel 的日期序列值 (五位數數字)
  if (/^\d{5}$/.test(dateStr)) {
    const serial = parseInt(dateStr);
    const date = new Date((serial - 25569) * 86400 * 1000);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }
  
  // 嘗試拿掉時間部分 (e.g. 2021/01/20 00:00:00)
  const spaceIdx = dateStr.indexOf(' ');
  if (spaceIdx > 0) {
    dateStr = dateStr.substring(0, spaceIdx);
  }
  return dateStr.replace(/-/g, '/');
}

function adaptPeak(peak) {
  const details = peak.details || {};
  
  // 適配常見的欄位名稱
  const rawDate = getDetailsValue(details, ['完登日期', '日期', '時間', '登頂日期', '完登時間']) || peak.folderDate || '';
  const dateFormatted = formatExcelDate(rawDate);
  const height = getDetailsValue(details, ['海拔高度', '高度', '海拔', '高度(m)', '高度(公尺)', '高度']) || '—';
  const region = getDetailsValue(details, ['行政區域', '行政區', '縣市', '區域', '地區', '行政']) || '台灣';
  const rawDiff = getDetailsValue(details, ['難度', '難易度', '難度評級', '星級']) || '';
  let difficulty = '⭐';

  if (rawDiff) {
    // 移除所有空白字元與 non-breaking space
    const cleanDiff = String(rawDiff).replace(/[\s\u00A0]+/g, '');
    // 匹配前導浮點數，例如 "1.5(0.2)" -> "1.5"
    const match = cleanDiff.match(/^(\d+(?:\.\d+)?)/);
    if (match) {
      const val = parseFloat(match[1]);
      if (val < 1.0) {
        difficulty = '⭐';
      } else if (val < 2.0) {
        difficulty = '⭐⭐';
      } else {
        difficulty = '⭐⭐⭐';
      }
    } else {
      // 容錯中文描述
      if (cleanDiff.includes('高') || cleanDiff.includes('難') || cleanDiff.includes('三')) {
        difficulty = '⭐⭐⭐';
      } else if (cleanDiff.includes('中') || cleanDiff.includes('二')) {
        difficulty = '⭐⭐';
      } else {
        difficulty = '⭐';
      }
    }
  }
  
  const diary = getDetailsValue(details, ['心得', '登山隨筆', '感想', '備註', '攀登心得']) || '未填寫心得記錄。';
  
  return {
    ...peak,
    adapted: {
      date: dateFormatted,
      height: height.includes('m') ? height : `${height}m`,
      region,
      difficulty,
      diary
    }
  };
}

// ==========================================================================
// 初始化與資料加載
// ==========================================================================
async function initApp() {
  try {
    const response = await fetch('/data/peaks.json');
    if (!response.ok) {
      throw new Error('無法讀取 peaks.json 資料');
    }
    const rawData = await response.json();
    
    // 按編號排序 (昇冪)
    peaksData = rawData
      .map(adaptPeak)
      .sort((a, b) => parseInt(a.id) - parseInt(b.id));
    
    filteredPeaks = [...peaksData];

    // 初始化 UI
    initMap();
    renderStats();
    populateFilters();
    renderViews();
    setupEventListeners();

  } catch (error) {
    console.error('初始化失敗:', error);
    document.getElementById('peaks-grid-container').innerHTML = `
      <div class="error-placeholder" style="grid-column: 1/-1; text-align: center; padding: 3rem; background: #FFFFFF; border-radius: 12px; border: 1px solid var(--color-border);">
        <p style="font-size: 1.2rem; color: var(--color-wood-dark); font-weight: 700;">⚠️ 尚未產生小百岳資料庫</p>
        <p style="color: var(--color-wood-mid); font-size: 0.9rem; margin-top: 0.5rem;">
          請確保您已將 <b>小百岳搜奇.xlsx</b> 與 <b>小百岳搜奇.kml</b> 下載並放置在 <code>D:\\電子相本\\01小百岳搜奇\\</code>，<br>
          並在本機專案根目錄中執行命令 <code>npm run build:data</code> 來壓縮照片與編譯資料。
        </p>
      </div>
    `;
  }
}

// ==========================================================================
// 地圖模組 (Leaflet Map)
// ==========================================================================
function initMap() {
  // 設定台灣中心點，預設縮放值 7.5
  map = L.map('map', {
    scrollWheelZoom: true,
    zoomSnap: 0.5,
  }).setView([23.7, 120.95], 7.5);

  // 採用 CartoDB Voyager 底圖，這是一款溫暖米白色、極簡且富有質感的免費圖磚，非常適合大自然山林風
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  updateMapMarkers();
}

function updateMapMarkers() {
  // 清除舊的標記
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  // 過濾出有有效經緯度的點位
  filteredPeaks.forEach(peak => {
    if (peak.location && peak.location.lat && peak.location.lng) {
      // 自訂綠色山林風標記圖示
      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="
          background-color: var(--color-forest-dark);
          color: var(--color-accent-gold);
          border: 2px solid var(--color-accent-gold);
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif);
          font-weight: 700;
          font-size: 0.8rem;
          box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        ">${parseInt(peak.id)}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const marker = L.marker([peak.location.lat, peak.location.lng], { icon: customIcon })
        .addTo(map);

      // 建立彈出視窗內容
      const popupContent = document.createElement('div');
      popupContent.className = 'map-popup-card';
      popupContent.innerHTML = `
        <h4>[${peak.id}] ${peak.name}</h4>
        <p>海拔: ${peak.adapted.height} | 完登: ${peak.adapted.date}</p>
        <button class="map-popup-btn" data-id="${peak.id}">查看紀實</button>
      `;

      popupContent.querySelector('.map-popup-btn').addEventListener('click', () => {
        openModal(peak.id);
      });

      marker.bindPopup(popupContent);
      markers.push(marker);
    }
  });

  // 如果有標記，自動縮放地圖包覆所有點位
  if (markers.length > 0) {
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

// ==========================================================================
// 數據統計模組 (Stats Dashboard)
// ==========================================================================
function renderStats() {
  const totalDaysEl = document.getElementById('total-days');
  if (peaksData.length === 0) return;

  // 尋找最早與最晚的完登日期
  const dates = peaksData
    .map(p => p.adapted.date)
    .filter(d => d && d !== '—')
    .map(d => new Date(d))
    .filter(d => !isNaN(d.getTime()));

  if (dates.length > 0) {
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    // 計算相差天數 (含頭尾)
    const diffTime = Math.abs(maxDate - minDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    totalDaysEl.textContent = `${diffDays} 天`;
  } else {
    totalDaysEl.textContent = '—';
  }
}

// ==========================================================================
// 篩選與搜尋模組
// ==========================================================================
function populateFilters() {
  const regionFilter = document.getElementById('region-filter');
  
  // 提取所有不重複的縣市名稱
  // 針對「縣市」文字做簡化，例如 "台中市太平區" 簡化為 "台中市"
  const regions = new Set();
  peaksData.forEach(p => {
    let r = p.adapted.region;
    if (r) {
      // 提取前三個字 (例如 "台中市"、"新北市"、"花蓮縣")
      // 或是適應 "南投縣信義鄉" 等
      const match = r.match(/^(.+?[縣市])/);
      if (match) {
        regions.add(match[1]);
      } else {
        regions.add(r.substring(0, 3));
      }
    }
  });

  // 排序並填入選單
  Array.from(regions)
    .sort()
    .forEach(reg => {
      const opt = document.createElement('option');
      opt.value = reg;
      opt.textContent = reg;
      regionFilter.appendChild(opt);
    });
}

function filterPeaks() {
  const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
  const regionVal = document.getElementById('region-filter').value;
  const difficultyVal = document.getElementById('difficulty-filter').value;

  filteredPeaks = peaksData.filter(peak => {
    // 1. 搜尋文字篩選 (山名、編號、或行政區)
    const matchesSearch = 
      peak.name.toLowerCase().includes(searchQuery) ||
      peak.id.includes(searchQuery) ||
      parseInt(peak.id) === parseInt(searchQuery) ||
      peak.adapted.region.toLowerCase().includes(searchQuery);

    // 2. 行政區篩選
    const matchesRegion = !regionVal || peak.adapted.region.includes(regionVal);

    // 3. 難度篩選
    const matchesDifficulty = !difficultyVal || peak.adapted.difficulty === difficultyVal;

    return matchesSearch && matchesRegion && matchesDifficulty;
  });

  renderViews();
  updateMapMarkers();
}

// ==========================================================================
// 視圖渲染模組 (Grid & Timeline)
// ==========================================================================
function renderViews() {
  renderGrid();
  renderTimeline();
}

// 渲染小百岳圖鑑 (Grid)
function renderGrid() {
  const gridContainer = document.getElementById('peaks-grid-container');
  gridContainer.innerHTML = '';

  if (filteredPeaks.length === 0) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--color-wood-mid);">
        <span style="font-size: 3rem;">🏔️</span>
        <p style="margin-top: 1rem; font-size: 1.1rem;">沒有找到符合篩選條件的小百岳山頭。</p>
      </div>
    `;
    return;
  }

  filteredPeaks.forEach(peak => {
    const card = document.createElement('div');
    card.className = 'peak-card';
    card.dataset.id = peak.id;

    // 首圖 (登山路線圖) 縮圖 URL，若無照片則顯示預設圖片
    const thumbUrl = peak.routeImage ? peak.routeImage.thumb : 'https://picsum.photos/id/1015/400/300';

    card.innerHTML = `
      <div class="card-img-container">
        <img src="${thumbUrl}" alt="${peak.name} 路線圖" loading="lazy" />
        <span class="card-badge">No.${peak.id}</span>
        <span class="card-date-badge">${peak.adapted.date}</span>
      </div>
      <div class="card-info">
        <h3>
          <span>${peak.name}</span>
          <span class="difficulty" style="color: var(--color-accent-gold);">${peak.adapted.difficulty}</span>
        </h3>
        <div class="card-tags">
          <span class="tag-item">${peak.adapted.height}</span>
          <span class="tag-item">${peak.adapted.region.split('區')[0]}</span>
        </div>
        <p class="card-diary-preview">${peak.adapted.diary}</p>
      </div>
    `;

    card.addEventListener('click', () => openModal(peak.id));
    gridContainer.appendChild(card);
  });
}

// 渲染完登時間軸 (Timeline)
function renderTimeline() {
  const timelineContainer = document.getElementById('timeline-container');
  timelineContainer.innerHTML = '';

  if (filteredPeaks.length === 0) {
    timelineContainer.innerHTML = `
      <div style="text-align: center; padding: 4rem; color: var(--color-wood-mid);">
        <p style="font-size: 1.1rem;">沒有找到符合篩選條件的時間軸紀錄。</p>
      </div>
    `;
    return;
  }

  // 複製一份並依完登日期排序 (若日期相同，按編號排序)
  const timelinePeaks = [...filteredPeaks].sort((a, b) => {
    const dateA = new Date(a.adapted.date);
    const dateB = new Date(b.adapted.date);
    
    if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) {
      return parseInt(a.id) - parseInt(b.id);
    }
    if (isNaN(dateA.getTime())) return 1;
    if (isNaN(dateB.getTime())) return -1;
    
    if (dateA.getTime() === dateB.getTime()) {
      return parseInt(a.id) - parseInt(b.id);
    }
    return dateA - dateB;
  });

  timelinePeaks.forEach((peak, index) => {
    const item = document.createElement('div');
    // 左右交錯排列
    const alignment = index % 2 === 0 ? 'left' : 'right';
    item.className = `timeline-item ${alignment}`;

    item.innerHTML = `
      <div class="timeline-node"></div>
      <div class="timeline-card">
        <div class="timeline-date">${peak.adapted.date}</div>
        <div class="timeline-title">[No.${peak.id}] ${peak.name}</div>
        <div class="timeline-meta">海拔: ${peak.adapted.height} | 行政區: ${peak.adapted.region}</div>
      </div>
    `;

    item.querySelector('.timeline-card').addEventListener('click', () => openModal(peak.id));
    timelineContainer.appendChild(item);
  });
}

// ==========================================================================
// 彈出式視窗 (Detail Modal)
// ==========================================================================
function openModal(id) {
  const peak = peaksData.find(p => p.id === id);
  if (!peak) return;

  const modal = document.getElementById('detail-modal');
  
  // 1. 設定文字與標題
  document.getElementById('modal-peak-id').textContent = `No.${peak.id}`;
  document.getElementById('modal-peak-name').textContent = peak.name;
  document.getElementById('modal-peak-height').textContent = `海拔高度：${peak.adapted.height}`;
  document.getElementById('modal-peak-area').textContent = `行政區：${peak.adapted.region}`;
  document.getElementById('modal-peak-date').textContent = `完登日期：${peak.adapted.date}`;
  document.getElementById('modal-peak-diary').textContent = peak.adapted.diary;

  // 2. 渲染 Excel 完整欄位資料
  const detailGrid = document.getElementById('modal-detail-grid');
  detailGrid.innerHTML = '';
  
  if (peak.details) {
    Object.keys(peak.details).forEach(key => {
      // 排除掉已經在 Header 顯示過的欄位，以保持版面乾淨
      const isHeaderField = ['編號', '山名', '完登日期', '海拔高度', '高度', '行政區域', '行政區', '縣市', '心得', '隨筆', '難度'].some(hk => 
        key.includes(hk)
      );

      if (!isHeaderField && peak.details[key] !== undefined && String(peak.details[key]).trim() !== '') {
        const row = document.createElement('div');
        row.className = 'detail-row';
        row.innerHTML = `
          <span class="detail-label">${key}</span>
          <span class="detail-value">${peak.details[key]}</span>
        `;
        detailGrid.appendChild(row);
      }
    });
  }

  // 3. 設定相片與路線圖
  // 路線圖 (也就是子資料夾中的第一張相片)
  const routeImgEl = document.getElementById('modal-route-img');
  const routeUrl = peak.routeImage ? peak.routeImage.large : 'https://picsum.photos/id/1015/1200/800';
  routeImgEl.src = routeUrl;
  routeImgEl.alt = `${peak.name} 登山路線圖`;

  // 完登紀實照片列表 (風景照)
  carouselPhotos = peak.photos || [];
  const track = document.getElementById('carousel-track');
  const dotsContainer = document.getElementById('carousel-dots');
  track.innerHTML = '';
  dotsContainer.innerHTML = '';
  currentCarouselIndex = 0;

  if (carouselPhotos.length === 0) {
    // 若無其他風景照，以路線圖暫代
    track.innerHTML = `
      <div class="carousel-slide">
        <img src="${routeUrl}" alt="${peak.name} 完登紀念" />
      </div>
    `;
    // 隱藏左右箭頭
    document.getElementById('carousel-prev').style.display = 'none';
    document.getElementById('carousel-next').style.display = 'none';
  } else {
    // 顯示左右箭頭
    document.getElementById('carousel-prev').style.display = 'block';
    document.getElementById('carousel-next').style.display = 'block';

    // 動態載入照片 Slides
    carouselPhotos.forEach((photo, idx) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide';
      slide.innerHTML = `<img src="${photo.large}" alt="${peak.name} 完登風景 ${idx+1}" loading="lazy" />`;
      track.appendChild(slide);

      // 動態建立 Dots 指示器
      const dot = document.createElement('span');
      dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
      dot.addEventListener('click', () => {
        setCarouselIndex(idx);
      });
      dotsContainer.appendChild(dot);
    });
  }

  // 4. 重設媒體選擇 Tab (預設開啟 完登紀實)
  setMediaTab('photos');

  // 5. 顯示 Modal
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // 鎖定背景滾動
}

function closeModal() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('active');
  document.body.style.overflow = ''; // 恢復背景滾動

  // 停止大圖加載
  document.getElementById('modal-route-img').src = '';
  document.getElementById('carousel-track').innerHTML = '';
}

// 設置媒體分頁 切換 完登照片 / 路線圖
function setMediaTab(tabName) {
  const buttons = document.querySelectorAll('.media-tab-btn');
  const contents = document.querySelectorAll('.media-content');

  buttons.forEach(btn => {
    if (btn.dataset.media === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  contents.forEach(content => {
    if (content.id === `carousel-${tabName}` || content.id === `${tabName}-photo-view`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// 設定 Carousel 照片索引
function setCarouselIndex(index) {
  if (carouselPhotos.length <= 1) return;
  
  const track = document.getElementById('carousel-track');
  const dots = document.querySelectorAll('.carousel-dot');
  
  currentCarouselIndex = (index + carouselPhotos.length) % carouselPhotos.length;
  
  // 平滑轉場移動
  track.style.transform = `translateX(-${currentCarouselIndex * 100}%)`;
  
  // 更新 Dot 高亮
  dots.forEach((dot, idx) => {
    if (idx === currentCarouselIndex) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

// ==========================================================================
// 事件監聽器 (Event Listeners)
// ==========================================================================
function setupEventListeners() {
  // 1. 搜尋與篩選事件 (防抖處理以提高效能)
  let filterTimeout;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(filterPeaks, 250);
  });
  document.getElementById('region-filter').addEventListener('change', filterPeaks);
  document.getElementById('difficulty-filter').addEventListener('change', filterPeaks);

  // 2. 視圖 Tab 切換事件
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === targetTab) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      
      // 切換視圖時，若是地圖標記改變，重新自適應地圖
      if (map) {
        map.invalidateSize();
      }
    });
  });

  // 3. Modal 關閉事件
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') {
      closeModal();
    }
  });
  
  // 支援 ESC 鍵關閉 Modal 與 LightBox
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const lightbox = document.getElementById('lightbox-modal');
      if (lightbox && lightbox.classList.contains('active')) {
        closeLightbox();
      } else {
        closeModal();
      }
    }
  });

  // 4. Modal 媒體頁籤切換
  document.querySelectorAll('.media-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setMediaTab(btn.dataset.media);
    });
  });

  // 5. Carousel 左右按鈕
  document.getElementById('carousel-prev').addEventListener('click', () => {
    setCarouselIndex(currentCarouselIndex - 1);
  });
  document.getElementById('carousel-next').addEventListener('click', () => {
    setCarouselIndex(currentCarouselIndex + 1);
  });

  // 6. LightBox 全螢幕相片放大事件
  document.getElementById('carousel-track').addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
      openLightbox(e.target.src);
    }
  });

  document.getElementById('modal-route-img').addEventListener('click', (e) => {
    if (e.target.src) {
      openLightbox(e.target.src);
    }
  });

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-modal').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox-modal') {
      closeLightbox();
    }
  });
}

// ==========================================================================
// 全螢幕放大 LightBox 模組
// ==========================================================================
function openLightbox(imgSrc) {
  const lightbox = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  lightboxImg.src = imgSrc;
  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox-modal');
  lightbox.classList.remove('active');
  setTimeout(() => {
    document.getElementById('lightbox-img').src = '';
  }, 300);
}

// 啟動應用程式
document.addEventListener('DOMContentLoaded', initApp);
