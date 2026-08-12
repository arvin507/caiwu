import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// antd v6 原生支持 React 19，无需 v5 的 findDOMNode 补丁
// antd 样式重置（归一化浏览器默认样式，必须在业务样式之前引入）
import 'antd/dist/reset.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
