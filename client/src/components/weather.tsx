import { getWeather } from '@/api';
import type { WeatherDTO } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Cloud,
  CloudDrizzle,
  CloudSnow,
  Cloudy,
  Sun,
} from 'lucide-react';
import { FC, useEffect, useMemo, useState } from 'react';

interface WeatherProps {
  className?: string;
}

const WEATHER_POLL_INTERVAL_MS = 5 * 60 * 1000;

export const Weather: FC<WeatherProps> = ({ className = '' }) => {
  const [weather, setWeather] = useState<WeatherDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      try {
        const data = await getWeather();
        if (cancelled) return;
        setWeather(data);
      } catch (error) {
        logger.error('获取天气数据失败:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchWeather();
    const timer = window.setInterval(() => {
      void fetchWeather();
    }, WEATHER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const icon = useMemo(() => {
    const iconSize = 19;

    switch (weather?.weatherType) {
      case 'cloudy':
        return <Cloudy size={iconSize} className="text-slate-500" />;
      case 'rainy':
        return <CloudDrizzle size={iconSize} className="text-sky-500" />;
      case 'snowy':
        return <CloudSnow size={iconSize} className="text-sky-300" />;
      case 'partlyCloudy':
        return <Cloud size={iconSize} className="text-slate-400" />;
      case 'sunny':
      default:
        return <Sun size={iconSize} className="text-amber-500" />;
    }
  }, [weather?.weatherType]);

  if (loading && !weather) {
    return (
      <div className={`flex min-w-[96px] items-center gap-2 ${className}`}>
        <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100" />
        <div className="flex flex-col gap-1">
          <div className="h-3 w-12 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-14 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  const temperature = weather?.temperature;
  const humidity = weather?.humidity;
  const temperatureText = Number.isFinite(temperature)
    ? `${Math.round(temperature as number)}°C`
    : '--°C';
  const humidityText = Number.isFinite(humidity)
    ? `${Math.round(humidity as number)}%`
    : '--%';

  return (
    <div className={`flex min-w-[96px] items-center gap-2 ${className}`}>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50">
        {icon}
      </div>
      <div className="min-w-0 text-sm text-slate-700">
        <div className="truncate text-base font-medium tabular-nums">{temperatureText}</div>
        <div className="truncate text-xs text-slate-500">湿度 {humidityText}</div>
      </div>
    </div>
  );
};
