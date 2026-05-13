import { getServiceHealth } from '@/api';
import type { AutoSyncStatusDTO, ServiceHealthResponseDTO } from '@shared/api.interface';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface ServiceStatusProps {
  className?: string;
}

const POLL_INTERVAL_MS = 15000;
const POLL_FAILURE_THRESHOLD = 3;

function formatDateTime(value?: string) {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function formatScheduleText(schedule?: AutoSyncStatusDTO) {
  if (!schedule?.enabled) {
    return '已关闭';
  }

  const scheduleText = Array.isArray(schedule.scheduleTimes) && schedule.scheduleTimes.length > 0
    ? schedule.scheduleTimes.join(' / ')
    : formatDateTime(schedule.nextRunAt);

  if (schedule.running) {
    return `执行中 · ${scheduleText}`;
  }

  if (schedule.queued) {
    return `排队中 · ${scheduleText}`;
  }

  if (schedule.lastError) {
    return `异常 · ${scheduleText}`;
  }

  return scheduleText;
}

function getRunningSyncTitle(
  riskAutoSync?: AutoSyncStatusDTO,
  changeAutoSync?: AutoSyncStatusDTO,
  drillAutoSync?: AutoSyncStatusDTO,
  eventAutoSync?: AutoSyncStatusDTO,
  inspectAutoSync?: AutoSyncStatusDTO,
) {
  const runningLabels = [
    riskAutoSync?.running ? '风险同步中' : '',
    changeAutoSync?.running ? '变更同步中' : '',
    drillAutoSync?.running ? '演练同步中' : '',
    eventAutoSync?.running ? '事件拉取中' : '',
    inspectAutoSync?.running ? '巡检同步中' : '',
  ].filter(Boolean);

  if (runningLabels.length === 0) {
    const queuedLabels = [
      riskAutoSync?.queued ? '风险排队中' : '',
      changeAutoSync?.queued ? '变更排队中' : '',
      drillAutoSync?.queued ? '演练排队中' : '',
      eventAutoSync?.queued ? '事件排队中' : '',
      inspectAutoSync?.queued ? '巡检排队中' : '',
    ].filter(Boolean);

    if (queuedLabels.length === 0) {
      return '';
    }

    return queuedLabels.length === 1 ? queuedLabels[0] : '多任务排队中';
  }

  if (runningLabels.length === 1) {
    return runningLabels[0];
  }

  return '多任务同步中';
}

export function ServiceStatus({ className = '' }: ServiceStatusProps) {
  const [health, setHealth] = useState<ServiceHealthResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const failureCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const response = await getServiceHealth();
        if (cancelled) return;
        failureCountRef.current = 0;
        setHealth(response);
        setError('');
      } catch {
        if (cancelled) return;
        failureCountRef.current += 1;
        if (failureCountRef.current >= POLL_FAILURE_THRESHOLD) {
          setError('状态读取失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchHealth();
    const timer = window.setInterval(() => {
      void fetchHealth();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const summary = useMemo(() => {
    if (loading) {
      return {
        icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
        title: '读取中',
        toneClass: 'border-sky-200 bg-sky-50 text-sky-700',
        statusMessage: '',
        lastRefresh: '--',
        nextRefresh: '--',
        riskAutoSync: '--',
        changeAutoSync: '--',
        drillAutoSync: '--',
        eventAutoSync: '--',
        inspectAutoSync: '--',
      };
    }

    if (!health) {
      return {
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        title: '状态未知',
        toneClass: 'border-amber-200 bg-amber-50 text-amber-700',
        statusMessage: error,
        lastRefresh: '--',
        nextRefresh: '--',
        riskAutoSync: '无法读取',
        changeAutoSync: '无法读取',
        drillAutoSync: '无法读取',
        eventAutoSync: '无法读取',
        inspectAutoSync: '无法读取',
      };
    }

    const keepAlive = health.keepAlive;
    const autoSync = health.autoSync;
    const changeAutoSync = health.changeAutoSync;
    const drillAutoSync = health.drillAutoSync;
    const eventAutoSync = health.eventAutoSync;
    const inspectAutoSync = health.inspectAutoSync;
    const hasPollingError = Boolean(error);
    const hasKeepAliveError = Boolean(keepAlive?.lastError);
    const hasKeepAliveWarning = Boolean(keepAlive?.lastWarning);
    const keepAliveStatus = keepAlive?.status || '';
    const runningSyncTitle = getRunningSyncTitle(autoSync, changeAutoSync, drillAutoSync, eventAutoSync, inspectAutoSync);
    if (hasPollingError) {
      return {
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        title: '状态延迟',
        toneClass: 'border-amber-200 bg-amber-50 text-amber-700',
        statusMessage: '本地 API 状态读取失败，当前页面可能是上一次状态；请确认内网电脑上的本地服务进程仍在运行。',
        lastRefresh: formatDateTime(keepAlive?.lastSuccessAt),
        nextRefresh: '--',
        riskAutoSync: '状态延迟',
        changeAutoSync: '状态延迟',
        drillAutoSync: '状态延迟',
        eventAutoSync: '状态延迟',
        inspectAutoSync: '状态延迟',
      };
    }

    const title = !keepAlive?.enabled
      ? '已关闭'
      : keepAlive.running || keepAliveStatus === 'checking'
        ? '心跳检测中'
        : keepAliveStatus === 'waiting'
          ? '浏览器待就绪'
        : keepAliveStatus === 'paused'
          ? (runningSyncTitle || '同步即将开始')
          : hasKeepAliveError || keepAliveStatus === 'degraded'
            ? '保活降级'
            : hasKeepAliveWarning || keepAliveStatus === 'partial'
              ? '部分保活'
              : '待刷新';
    const toneClass = hasKeepAliveError || keepAliveStatus === 'degraded'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : hasKeepAliveWarning || keepAliveStatus === 'partial' || keepAliveStatus === 'paused'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : keepAlive?.enabled
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-600';
    const icon = keepAlive?.running || keepAliveStatus === 'checking'
      ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      : hasKeepAliveError || keepAliveStatus === 'degraded'
        ? <AlertCircle className="h-3.5 w-3.5" />
        : <CheckCircle2 className="h-3.5 w-3.5" />;

    return {
      icon,
      title,
      toneClass,
      statusMessage: keepAlive?.statusMessage || keepAlive?.lastError || keepAlive?.lastWarning || '',
      lastRefresh: formatDateTime(keepAlive?.lastSuccessAt),
      nextRefresh: formatDateTime(keepAlive?.nextRunAt),
      riskAutoSync: formatScheduleText(autoSync),
      changeAutoSync: formatScheduleText(changeAutoSync),
      drillAutoSync: formatScheduleText(drillAutoSync),
      eventAutoSync: formatScheduleText(eventAutoSync),
      inspectAutoSync: formatScheduleText(inspectAutoSync),
    };
  }, [error, health, loading]);

  const rows = [
    { label: '风险定时', value: summary.riskAutoSync },
    { label: '变更定时', value: summary.changeAutoSync },
    { label: '演练定时', value: summary.drillAutoSync },
    { label: '事件定时', value: summary.eventAutoSync },
    { label: '巡检定时', value: summary.inspectAutoSync },
  ];

  return (
    <div className={`grid min-w-[430px] grid-cols-[140px_282px] gap-2 ${className}`}>
      <div className="flex min-h-[76px] flex-col justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div
          className={`inline-flex max-w-full items-center gap-1.5 self-start rounded-full border px-2 py-0.5 text-xs font-medium ${summary.toneClass}`}
          title={summary.statusMessage}
        >
          {summary.icon}
          <span className="truncate">{summary.title}</span>
        </div>
        <div className="grid gap-0.5 text-xs leading-4 text-slate-600">
          <div className="grid grid-cols-[26px_1fr] gap-2">
            <span className="text-slate-500">上次</span>
            <span className="truncate text-right tabular-nums text-slate-800">{summary.lastRefresh}</span>
          </div>
          <div className="grid grid-cols-[26px_1fr] gap-2">
            <span className="text-slate-500">下次</span>
            <span className="truncate text-right tabular-nums text-slate-800">{summary.nextRefresh}</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-[76px] flex-col justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="text-xs font-medium leading-4 text-slate-600">定时同步</div>
        <div className="grid gap-0.5 text-xs leading-4 text-slate-600">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[52px_1fr] gap-2">
              <span className="text-slate-500">{row.label}</span>
              <span className="truncate text-right tabular-nums text-slate-800">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
