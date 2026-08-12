import { useState } from 'react'
import { Layout, Menu, Typography } from 'antd'
import {
  BarChartOutlined,
  DashboardOutlined,
  SettingOutlined,
  SwapOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Sider, Header, Content } = Layout

/**
 * 主布局：经典的「左侧菜单 + 顶部栏 + 右侧内容区」中后台框架。
 *
 * - Sider：导航菜单，点击切换路由
 * - Header：顶部信息栏（可放用户名、主题切换等）
 * - Content：通过 <Outlet /> 渲染当前路由对应的页面
 *
 * 菜单选中态与地址栏联动：用 useLocation 读取当前路径，用 useNavigate 跳转。
 */
export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  // 菜单数据：key 直接对应路由 path，方便与 location 比对
  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/transactions', icon: <SwapOutlined />, label: '账单明细' },
    { key: '/accounts', icon: <WalletOutlined />, label: '账户管理' },
    { key: '/reports', icon: <BarChartOutlined />, label: '统计报表' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ]

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
        <Header style={{ background: '#fff', paddingInline: 24 }}>
          <Typography.Title level={4} style={{ margin: '14px 0' }}>
            财务管理系统
          </Typography.Title>
        </Header>
        <Content style={{ margin: 24 }}>
          {/* 路由出口：当前页面渲染在这里 */}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
