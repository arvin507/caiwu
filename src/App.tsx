import { useEffect } from 'react'
import { App as AntApp, ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

// DatePicker/月份选择面板的「月份」文字来自 dayjs 的 locale（antd 的 zh_CN 不含月份面板文案），
// 不设置 dayjs locale 会导致月份弹窗显示英文月份。这里全局激活中文 locale。
dayjs.locale('zh-cn')
import MainLayout from '@/layouts/MainLayout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Accounts from '@/pages/Accounts'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import Invoices from '@/pages/Invoices'
import Reimbursements from '@/pages/Reimbursements'
import Deductions from '@/pages/Deductions'
import UserManagement from '@/pages/UserManagement'
import ChangePassword from '@/pages/ChangePassword'
import { useAppStore } from '@/store/useAppStore'

/**
 * 应用根组件
 *
 * 1. ConfigProvider：antd 的全局配置容器，设置中文 locale 与主题（亮/暗跟随 store）。
 * 2. AntApp：提供 message/notification 的上下文（antd v6 推荐用法，避免静态调用告警）。
 * 3. 路由守卫：未登录渲染 <Login/>，登录后才渲染带路由的 <MainLayout/> 系统。
 * 4. 刷新保持登录：挂载时 restoreSession 用本地 token 调 /api/auth/me 恢复登录态。
 */
export default function App() {
  const themeMode = useAppStore((s) => s.preferences.themeMode)
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const authReady = useAppStore((s) => s.authReady)
  const restoreSession = useAppStore((s) => s.restoreSession)

  // 首次挂载：用本地 token 恢复登录态（含角色），完成前显示加载态避免闪烁
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          colorBgLayout: '#f0f2f5',
          controlHeight: 36,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Card: { borderRadiusLG: 12 },
          Menu: { itemBorderRadius: 8, itemMarginInline: 8, itemHeight: 44 },
          Table: { headerBg: '#fafafa', headerColor: '#1f2329' },
          Statistic: { contentFontSize: 28 },
        },
      }}
    >
      <AntApp>
        {!authReady ? (
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spin size="large" tip="加载中…">
              <div style={{ width: 1, height: 1 }} />
            </Spin>
          </div>
        ) : isAuthenticated ? (
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<MainLayout />}>
                {/* 访问根路径自动跳到仪表盘 */}
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="reimbursements" element={<Reimbursements />} />
                <Route path="deductions" element={<Deductions />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                {/* 用户管理：仅超级管理员可见（前端隐藏 + 后端强制校验） */}
                <Route path="users" element={<UserManagement />} />
                {/* 修改密码：所有已登录用户可用 */}
                <Route path="change-password" element={<ChangePassword />} />
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
