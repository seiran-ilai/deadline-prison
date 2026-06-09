import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // 不採用 React Compiler 系列的嚴格檢查:本專案刻意使用
      //   - mount 時 useEffect(() => { load() }, []) 做初次載入(會同步 setState)
      //   - render 中讀 Date.now() 算番茄鐘即時倒數(元件每秒 re-tick)
      // 這些是有意的模式,非 bug,故關閉這兩條規則避免雜訊。
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // Vercel serverless functions 跑在 Node 環境(process / fetch 等)
    files: ['api/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
