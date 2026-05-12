import { FC, useEffect, useState } from 'react';

interface ClockProps {
  className?: string;
}

export const Clock: FC<ClockProps> = ({ className = '' }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourDegrees = (hours % 12) * 30 + minutes * 0.5;
  const minuteDegrees = minutes * 6;
  const secondDegrees = seconds * 6;

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
  };

  const formatTime = (date: Date) => {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const renderNumbers = () => {
    return Array.from({ length: 12 }, (_, i) => {
      const hour = i === 0 ? 12 : i;
      const angle = i * 30;
      const radius = 32;
      const x = Math.sin((angle * Math.PI) / 180) * radius;
      const y = -Math.cos((angle * Math.PI) / 180) * radius;
      
      return (
        <div
          key={hour}
          className="absolute text-[10px] font-medium text-foreground"
          style={{
            left: `calc(50% + ${x}px)`,
            top: `calc(50% + ${y}px)`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {hour}
        </div>
      );
    });
  };

  const renderTicks = () => {
    return Array.from({ length: 60 }, (_, i) => {
      const angle = i * 6;
      const isHour = i % 5 === 0;
      const length = isHour ? 6 : 3;
      const width = isHour ? 1 : 0.5;
      const distance = 36;
      
      return (
        <div
          key={i}
          className="absolute bg-muted-foreground"
          style={{
            left: '50%',
            top: '50%',
            width: `${width}px`,
            height: `${length}px`,
            transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${distance}px)`,
            transformOrigin: 'center 0',
          }}
        />
      );
    });
  };

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="text-sm text-foreground">
        <div className="text-xs text-muted-foreground">{formatDate(now)}</div>
        <div className="font-medium">{formatTime(now)}</div>
      </div>

      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border-2 border-primary bg-card overflow-visible">
          {/* 刻度 */}
          {renderTicks()}
          
          {/* 数字 */}
          {renderNumbers()}
          
          {/* 中心点 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-primary z-10" />
          </div>

          {/* 时针 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `rotate(${hourDegrees}deg)`,
            }}
          >
            <div className="h-4 w-0.5 -translate-y-2 bg-foreground rounded-full" />
          </div>

          {/* 分针 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `rotate(${minuteDegrees}deg)`,
            }}
          >
            <div className="h-5 w-0.5 -translate-y-2.5 bg-foreground rounded-full" />
          </div>

          {/* 秒针 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `rotate(${secondDegrees}deg)`,
            }}
          >
            <div className="h-6 w-0.5 -translate-y-3 bg-primary rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};