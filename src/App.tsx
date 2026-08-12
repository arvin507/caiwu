import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from '@/layouts/MainLayout'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Accounts from '@/pages/Accounts'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import { useAppStore } from '@/store/useAppStore'

/**
 * 应用根组件
 *
 * 1. ConfigProvider：antd 的全局配置容器，这里设置：
 *    - locale=zhCN：日期选择器、分页等组件显示中文
 *    - theme：主题算法（亮/暗）跟随 store 里的偏好，体现「状态驱动 UI」
 * 2. Router：用嵌套路由，所有页面都包在 MainLayout 里，共享侧边栏。
 */
export default function App() {
  const themeMode = useAppStore((s) => s.preferences.themeMode)

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            {/* 访问根路径自动跳到仪表盘 */}
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            {/* 未匹配的路径也回到仪表盘 */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
