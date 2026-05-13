import { useIsMobile } from '@/hooks/use-mobile';
import { NavLink } from '@lark-apaas/client-toolkit/components/NavLink';
import { TruncatedTitle } from '@lark-apaas/client-toolkit/components/TruncatedTitle';
import { useAppInfo } from '@lark-apaas/client-toolkit/hooks/useAppInfo';
import { ActivitySquare, BellRing, ClipboardCheck, ClipboardList, Menu, ShieldCheck, X, type LucideProps } from 'lucide-react';
import { FC, ReactNode, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { ServiceStatus } from '@/components/service-status';
import { TimeDisplay } from '@/components/time-display';
import { Weather } from '@/components/weather';

interface NavItem {
  title: string;
  url?: string;
  icon?: FC<LucideProps>;
}

const menu: NavItem[] = [
  { title: '风险排查', url: '/', icon: ShieldCheck },
  { title: '变更进展', url: '/change', icon: ClipboardList },
  { title: '演练推进', url: '/drill', icon: ActivitySquare },
  { title: '事件追踪', url: '/event', icon: BellRing },
  { title: '巡检拉取', url: '/inspect', icon: ClipboardCheck },
];

const APP_NAME = '智航任务同步进度一览';
const APP_SUBTITLE = '内网数据采集与飞书同步';
const PAGE_TITLE = '智航数据自动同步工具';

function BrandBadge({
  appLogo,
  compact = false,
}: {
  appLogo?: string;
  compact?: boolean;
}) {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(!appLogo);

  useEffect(() => {
    setLogoLoaded(false);
    setLogoFailed(!appLogo);
  }, [appLogo]);

  const containerSize = compact ? 'h-10 w-10' : 'h-11 w-11';
  const monogramClass = compact ? 'text-sm' : 'text-base';
  const hasVisibleLogo = Boolean(appLogo) && logoLoaded && !logoFailed;

  return (
    <div
      className={`relative flex ${containerSize} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sky-100 bg-sky-50 shadow-sm`}
    >
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center bg-sky-50 text-sky-700 transition-opacity ${
          hasVisibleLogo ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <span className={`${monogramClass} font-medium leading-none`}>智</span>
        <span className="mt-0.5 text-[10px] leading-none text-sky-500">航</span>
      </div>

      {appLogo ? (
        <img
          src={appLogo}
          alt=""
          className={`relative z-10 h-full w-full object-cover transition-opacity ${
            hasVisibleLogo ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setLogoLoaded(true)}
          onError={() => setLogoFailed(true)}
        />
      ) : null}
    </div>
  );
}

function NavBrand() {
  const { appLogo } = useAppInfo();

  return (
    <NavLink to="/" className="block">
      <div className="flex min-w-0 items-center gap-3">
        <BrandBadge appLogo={appLogo} />
        <div className="min-w-0">
          <div className="truncate text-base font-medium text-slate-900">
            <TruncatedTitle text={APP_NAME} />
          </div>
          <div className="truncate text-xs text-slate-500">{APP_SUBTITLE}</div>
        </div>
      </div>
    </NavLink>
  );
}

function HeaderPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-[60px] items-center rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

function DesktopTopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="grid w-full grid-cols-[minmax(250px,360px)_minmax(430px,560px)_minmax(684px,1fr)] items-center gap-3 px-8 py-3">
        <div className="flex min-w-0 items-center">
          <NavBrand />
        </div>

        <nav className="grid w-full grid-cols-5 items-center gap-1 justify-self-center rounded-lg border border-slate-200 bg-slate-50 p-1">
          {menu.map((item) => (
            item.url ? (
              <NavLink key={item.title} to={item.url} className="block">
                {({ isActive }) => (
                  <div
                    className={`flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm transition-all duration-150 ${
                      isActive
                        ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-100'
                        : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                    }`}
                  >
                    {item.icon ? <item.icon size={16} /> : null}
                    <span>{item.title}</span>
                  </div>
                )}
              </NavLink>
            ) : null
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end">
          <ServiceStatus className="w-[430px]" />
          <HeaderPanel className="w-[126px] justify-center">
            <TimeDisplay className="min-w-0 items-center text-center" />
          </HeaderPanel>
          <HeaderPanel className="w-[112px] justify-center">
            <Weather className="min-w-0 justify-center" />
          </HeaderPanel>
        </div>
      </div>
    </header>
  );
}

function MobileSetting({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 top-16 z-50 translate-x-full overflow-auto bg-white p-3 transition-transform duration-300 ease-out data-[state=open]:translate-x-0"
      data-state={visible ? 'open' : 'close'}
    >
      <nav className="flex flex-col">
        {menu.map((item) =>
          item.url ? (
            <NavLink key={item.title} to={item.url} className="block">
              {({ isActive }) => (
                <div
                  className={`flex h-14 items-center gap-3 px-3 text-base ${isActive ? 'text-sky-600' : 'text-slate-800'}`}
                  onClick={onClose}
                >
                  {item.icon ? <item.icon size={20} /> : null}
                  <span className="flex-1 truncate">{item.title}</span>
                </div>
              )}
            </NavLink>
          ) : (
            <div
              key={item.title}
              className="flex h-14 items-center gap-3 px-3 text-base text-slate-800"
            >
              {item.icon ? <item.icon size={20} /> : null}
              <span className="flex-1 truncate">{item.title}</span>
            </div>
          ),
        )}
      </nav>
    </div>
  );
}

function MobileTopBar({
  menuOpen,
  onSettingClick,
}: {
  menuOpen: boolean;
  onSettingClick: () => void;
}) {
  const { appLogo } = useAppInfo();

  return (
    <header className="fixed top-0 z-50 flex min-h-[68px] w-full items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
      <div className="min-w-0 flex flex-1 items-center gap-3">
        <BrandBadge appLogo={appLogo} compact />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">智航任务同步</div>
          <div className="truncate text-xs text-slate-500">内网采集与飞书同步</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <HeaderPanel className="min-h-0 px-2.5 py-2">
          <TimeDisplay className="min-w-0 scale-90 origin-right items-center text-center" />
        </HeaderPanel>
        <HeaderPanel className="min-h-0 px-2.5 py-2">
          <Weather className="min-w-0 scale-90 origin-right justify-center" />
        </HeaderPanel>
        {menu.length > 0 &&
          (menuOpen ? (
            <X className="text-slate-700" onClick={onSettingClick} />
          ) : (
            <Menu className="text-slate-700" onClick={onSettingClick} />
          ))}
      </div>
    </header>
  );
}

function DesktopLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50/35">
      <DesktopTopBar />
      <main className="flex-1 bg-background">
        <Outlet />
      </main>
    </div>
  );
}

function MobileLayout() {
  const [openSetting, setOpenSetting] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-slate-50/35">
      <MobileTopBar
        menuOpen={openSetting}
        onSettingClick={() => setOpenSetting((value) => !value)}
      />
      <main
        id="rootContainer"
        className="fixed inset-x-0 bottom-0 top-16 overflow-auto bg-background"
      >
        <Outlet />
      </main>
      <MobileSetting
        visible={openSetting}
        onClose={() => setOpenSetting(false)}
      />
    </div>
  );
}

export default function Layout2() {
  const isMobile = useIsMobile();

  useEffect(() => {
    const applyTitle = () => {
      if (document.title !== PAGE_TITLE) {
        document.title = PAGE_TITLE;
      }
    };

    applyTitle();
    const titleElement = document.querySelector('title');
    const observer = titleElement
      ? new MutationObserver(applyTitle)
      : null;
    observer?.observe(titleElement as HTMLTitleElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const timer = window.setInterval(applyTitle, 1000);

    return () => {
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return isMobile ? <MobileLayout /> : <DesktopLayout />;
}
