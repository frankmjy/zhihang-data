import React from 'react';
import { createRoot } from "react-dom/client";
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Toaster } from 'sonner';

import RoutesComponent from "./app.tsx";
import './index.css';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';
const PAGE_TITLE = '智航数据自动同步工具';

document.title = PAGE_TITLE;

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-sm text-[#1F2329]">
      页面出错了，请刷新后重试
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Toaster richColors position="top-center" />
      {children}
    </>
  );
}

const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <AppShell>
        <ErrorBoundary
          fallbackRender={() => <ErrorFallback />}
        >
          <RoutesComponent />
        </ErrorBoundary>
      </AppShell>
    </BrowserRouter>
  );
};

createRoot(document.getElementById("root")!).render(<MainApp />);
