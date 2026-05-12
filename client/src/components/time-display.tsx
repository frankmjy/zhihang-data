import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

export function TimeDisplay({ className }: { className?: string }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}年${month}月${day}日`;
  };

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div
      className={`flex min-w-[112px] flex-col items-end text-right text-slate-700 ${className || ''}`}
    >
      <div className="flex items-center gap-1.5 text-base font-medium tabular-nums">
        <Clock className="h-4 w-4 text-slate-500" />
        <span>{formatTime(currentTime)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500 tabular-nums">
        {formatDate(currentTime)}
      </div>
    </div>
  );
}
