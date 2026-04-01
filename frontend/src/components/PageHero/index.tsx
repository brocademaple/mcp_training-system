import React from 'react';
import { Typography } from 'antd';
import './index.css';

type PageHeroProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
};

const PageHero: React.FC<PageHeroProps> = ({ title, subtitle, icon, extra, className }) => {
  return (
    <div className={`page-hero ${className || ''}`}>
      <div className="page-hero-main">
        {icon ? <span className="page-hero-icon">{icon}</span> : null}
        <div className="page-hero-text">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Text type="secondary" className="page-hero-subtitle">
              {subtitle}
            </Typography.Text>
          ) : null}
        </div>
      </div>
      {extra ? <div className="page-hero-extra">{extra}</div> : null}
    </div>
  );
};

export default PageHero;
