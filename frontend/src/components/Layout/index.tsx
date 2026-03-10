import React, { useState, useEffect } from 'react';
import { Layout as AntLayout, Menu, ConfigProvider, theme } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  CloudServerOutlined,
  BarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import './index.css';

const { Sider, Content } = AntLayout;

const STORAGE_THEME_KEY = 'app-theme';
type ThemeMode = 'light' | 'dark';

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_THEME_KEY) as ThemeMode) || 'light';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, themeMode);
  }, [themeMode]);

  const themeConfig = themeMode === 'dark'
    ? { algorithm: theme.darkAlgorithm }
    : { algorithm: theme.defaultAlgorithm };

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: '仪表盘',
    },
    {
      key: '/datasets',
      icon: <DatabaseOutlined />,
      label: '数据集管理',
    },
    {
      key: '/training',
      icon: <ExperimentOutlined />,
      label: '训练任务',
    },
    {
      key: '/models',
      icon: <CloudServerOutlined />,
      label: '模型管理',
    },
    {
      key: '/evaluation',
      icon: <BarChartOutlined />,
      label: '模型评估',
    },
  ];

  return (
    <ConfigProvider theme={themeConfig}>
      <AntLayout className="app-layout" data-theme={themeMode} style={{ minHeight: '100vh' }}>
        <Sider
          width={220}
          collapsedWidth={64}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          theme={themeMode}
          className="layout-sider"
        >
          <div className="sider-inner">
            <div className="sider-head">
              <div className="sider-logo">{collapsed ? 'MCP' : 'MCP Training System'}</div>
              <span className="sider-trigger" onClick={() => setCollapsed(!collapsed)}>
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </span>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              className="layout-menu"
              style={{ borderRight: 0 }}
              inlineCollapsed={collapsed}
            />
            <div className="sider-footer">
              <span
                className="sider-theme-toggle"
                onClick={() => setThemeMode((t) => (t === 'light' ? 'dark' : 'light'))}
                title={themeMode === 'light' ? '切换到深色模式' : '切换到浅色模式'}
              >
                {themeMode === 'light' ? <MoonOutlined /> : <SunOutlined />}
              </span>
            </div>
          </div>
        </Sider>
        <Content className="layout-content">
          <Outlet />
        </Content>
      </AntLayout>
    </ConfigProvider>
  );
};

export default Layout;
