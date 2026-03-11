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
  DoubleLeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import './index.css';

const { Sider, Content } = AntLayout;

const STORAGE_THEME_KEY = 'app-theme';
const STORAGE_SIDER_WIDTH_KEY = 'app-sider-width';
const MIN_SIDER_WIDTH = 160;
const MAX_SIDER_WIDTH = 420;
const DEFAULT_SIDER_WIDTH = 220;

type ThemeMode = 'light' | 'dark';

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [siderHidden, setSiderHidden] = useState(false); // 完全收起侧栏（与 collapsed 仅收起到图标不同）
  const [siderWidth, setSiderWidth] = useState(() => {
    const w = localStorage.getItem(STORAGE_SIDER_WIDTH_KEY);
    if (w) {
      const n = parseInt(w, 10);
      if (!Number.isNaN(n) && n >= MIN_SIDER_WIDTH && n <= MAX_SIDER_WIDTH) return n;
    }
    return DEFAULT_SIDER_WIDTH;
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_THEME_KEY) as ThemeMode) || 'light';
  });

  useEffect(() => {
    if (siderWidth >= MIN_SIDER_WIDTH && siderWidth <= MAX_SIDER_WIDTH) {
      localStorage.setItem(STORAGE_SIDER_WIDTH_KEY, String(siderWidth));
    }
  }, [siderWidth]);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = siderWidth;
    const onMove = (e2: MouseEvent) => {
      const dx = e2.clientX - startX;
      setSiderWidth((w) => Math.min(MAX_SIDER_WIDTH, Math.max(MIN_SIDER_WIDTH, startW + dx)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

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
      label: '模型训练',
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
        {siderHidden ? (
          <div
            className="sider-hidden-bar"
            data-theme={themeMode}
            onClick={() => setSiderHidden(false)}
            title="展开侧边栏"
            aria-label="展开侧边栏"
          >
            <RightOutlined className="sider-hidden-arrow" />
          </div>
        ) : (
          <Sider
            width={siderWidth}
            collapsedWidth={64}
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            trigger={null}
            theme={themeMode}
            className="layout-sider"
          >
            <div className="sider-inner">
              {!collapsed && (
                <div
                  className="sider-resizer"
                  onMouseDown={handleResizerMouseDown}
                  title="拖动调整宽度"
                  aria-label="调整侧边栏宽度"
                >
                  <span
                    className="sider-resizer-arrow"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setSiderHidden(true);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="收起侧边栏"
                    aria-label="收起侧边栏"
                  >
                    <DoubleLeftOutlined className="sider-resizer-arrow-icon" />
                  </span>
                </div>
              )}
            <div className="sider-head">
              <div className="sider-logo-wrap">
                <div className="sider-logo">{collapsed ? 'MCP' : 'MCP Training System'}</div>
                {!collapsed && <div className="sider-logo-cn">MCP 训练系统</div>}
              </div>
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
        )}
        <Content className="layout-content">
          <Outlet />
        </Content>
      </AntLayout>
    </ConfigProvider>
  );
};

export default Layout;
