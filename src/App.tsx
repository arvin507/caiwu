import { App as AntApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from '@/layouts/MainLayout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Accounts from '@/pages/Accounts'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import Invoices from '@/pages/Invoices'
import { useAppStore } from '@/store/useAppStore'

/**
 * 应用根组件
 *
 * 1. ConfigProvider：antd 的全局配置容器，设置中文 locale 与主题（亮/暗跟随 store）。
 * 2. AntApp：提供 message/notification 的上下文（antd v6 推荐用法，避免静态调用告警）。
 * 3. 路由守卫：未登录渲染 <Login/>，登录后才渲染带路由的 <MainLayout/> 系统。
 * 4. Router：嵌套路由，所有页面都包在 MainLayout 里，共享侧边栏。
 */
export default function App() {
  const themeMode = useAppStore((s) => s.preferences.themeMode)
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' },
      }}
    >
      <AntApp>
        {isAuthenticated ? (
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<MainLayout />}>
                {/* 访问根路径自动跳到仪表盘 */}
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                {/* 未匹配的路径也回到仪表盘 */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        ) : (
          <Login />
        )}
      </AntApp>
    </ConfigProvider>
  )
}
