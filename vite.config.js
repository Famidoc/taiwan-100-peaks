import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // 使用相對路徑，保證部署到 GitHub Pages 的任何專案名稱下皆能正常載入
});
