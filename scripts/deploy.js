import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const distPath = path.resolve('dist');
const gitPath = path.join(distPath, '.git');

console.log('🚀 開始執行自訂 Git 增量部署流程...');

// 1. 確保 dist 資料夾存在
if (!fs.existsSync(distPath)) {
  console.error('❌ 找不到 dist 資料夾，請先確認已編譯成功！');
  process.exit(1);
}

// 2. 在 dist 資料夾內執行 git 指令
try {
  const options = { cwd: distPath, stdio: 'inherit' };
  
  console.log('📦 初始化或讀取暫時的 Git 倉庫...');
  execSync('git init', options);
  
  // 嘗試切換到 gh-pages 分支，若不存在則建立它
  try {
    execSync('git checkout gh-pages', options);
  } catch (e) {
    execSync('git checkout -b gh-pages', options);
  }
  
  // 自動配置暫時倉庫的 Git 身分，防止主機未設定 git global config 而報錯
  execSync('git config user.email "deploy@action.com"', options);
  execSync('git config user.name "Auto Deployer"', options);
  
  console.log('📝 比對並新增檔案中...');
  execSync('git add .', options);
  
  // 檢查是否有變更需要提交，防止無變更時 commit 報錯
  try {
    execSync('git commit -m "deploy: update website"', options);
  } catch (e) {
    console.log('ℹ️ 沒有檢測到任何檔案變更，將直接進行推送。');
  }
  
  console.log('🔗 連結遠端 GitHub 倉庫...');
  try {
    execSync('git remote add origin https://github.com/Famidoc/taiwan-100-peaks.git', options);
  } catch (e) {
    // 遠端連結已存在，則更新 URL 確保正確
    execSync('git remote set-url origin https://github.com/Famidoc/taiwan-100-peaks.git', options);
  }
  
  console.log('📤 增量推送至 GitHub gh-pages 分支...');
  execSync('git push origin gh-pages --force', options);
  
  console.log('🎉 網頁發布成功！');
} catch (err) {
  console.error('❌ 部署過程中發生錯誤：', err.message);
} finally {
  // 保留暫時的 .git 資料夾，使下一次發布能直接進行增量快取更新 (1 秒內完成)
}
