import { useState } from 'react'
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Space } from 'antd'
import {
  BarChartOutlined,
  ContainerOutlined,
  DashboardOutlined,
  FileTextOutlined,
  LogoutOutlined,
  ReconciliationOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'

const { Sider, Header, Content } = Layout

// 路由 path -> 菜单标题（用于顶栏面包屑）
const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/transactions': '账单明细',
  '/accounts': '账户管理',
  '/invoices': '发票管理',
  '/reimbursements': '报销管理',
  '/deductions': '进项抵扣',
  '/reports': '统计报表',
  '/settings': '系统设置',
  '/users': '用户管理',
  '/change-password': '修改密码',
}

/**
 * 主布局：经典的「左侧菜单 + 顶部栏 + 右侧内容区」中后台框架。
 *
 * - Sider：导航菜单，点击切换路由
 * - Header：顶部栏。右侧展示当前登录用户，点击可退出登录
 * - Content：通过 <Outlet /> 渲染当前路由对应的页面
 *
 * 菜单选中态与地址栏联动：用 useLocation 读取当前路径，用 useNavigate 跳转。
 */
export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const currentUser = useAppStore((s) => s.currentUser)
  const logout = useAppStore((s) => s.logout)

  // 菜单数据：key 直接对应路由 path，方便与 location 比对
  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/transactions', icon: <SwapOutlined />, label: '账单明细' },
    { key: '/accounts', icon: <WalletOutlined />, label: '账户管理' },
    { key: '/invoices', icon: <FileTextOutlined />, label: '发票管理' },
    { key: '/reimbursements', icon: <ReconciliationOutlined />, label: '报销管理' },
    { key: '/deductions', icon: <ContainerOutlined />, label: '进项抵扣' },
    { key: '/reports', icon: <BarChartOutlined />, label: '统计报表' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
    // 仅超级管理员可见：用户管理（普通用户不显示此项，且后端也会拒绝访问）
    ...(currentUser?.role === 'admin'
      ? [{ key: '/users', icon: <TeamOutlined />, label: '用户管理' }]
      : []),
  ]

  // 当前页面标题（面包屑末项）
  const currentTitle = PAGE_TITLES[location.pathname] ?? '仪表盘'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div
          style={{
            height: 48,
            margin: 16,
            color: '#fff',
            fontWeight: 700,
            fontSize: collapsed ? 14 : 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {collapsed ? '财' : '财务管理系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            paddingInline: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            zIndex: 1,
          }}
        >
          <Breadcrumb
            items={[{ title: '财务管理系统' }, { title: currentTitle }]}
            style={{ fontSize: 14 }}
          />

          {/* 右侧：当前登录用户 + 修改密码 / 退出 */}
          <Dropdown
            menu={{
              items: [
                { key: 'change-password', icon: <SettingOutlined />, label: '修改密码' },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
              ],
              onClick: ({ key }) => {
                if (key === 'logout') logout()
                else if (key === 'change-password') navigate('/change-password')
              },
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar style={{ backgroundColor: '#1677ff' }}>
                {currentUser?.name?.charAt(0)?.toUpperCase() ?? 'U'}
              </Avatar>
              <span>{currentUser?.name ?? '未登录'}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, background: '#f0f2f5' }}>
          {/* 路由出口：当前页面渲染在这里 */}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
