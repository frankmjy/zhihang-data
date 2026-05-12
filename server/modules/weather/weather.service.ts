import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { WeatherDTO } from '@shared/api.interface';

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly qweatherApiUrl = 'https://devapi.qweather.com/v7/weather/now';
  private readonly apiKey = process.env.WEATHER_API_KEY || process.env.QWEATHER_API_KEY || '';
  private readonly location = process.env.WEATHER_LOCATION || '120.959,31.937';
  private readonly city = process.env.WEATHER_CITY || '南通开发区';
  private readonly cacheTtlMs = Number(process.env.WEATHER_CACHE_TTL_MS || 5 * 60 * 1000);
  private cache: { data: WeatherDTO; updatedAt: number } | null = null;

  constructor(private readonly httpService: HttpService) {}

  async getWeather(): Promise<WeatherDTO> {
    const now = Date.now();
    if (this.cache && now - this.cache.updatedAt < this.cacheTtlMs) {
      return this.cache.data;
    }

    try {
      const weatherData = await this.fetchWeatherForLocation(this.location, this.city);
      this.cache = {
        data: weatherData,
        updatedAt: now,
      };
      return weatherData;
    } catch (error) {
      this.logger.warn(`获取天气数据失败：${error instanceof Error ? error.message : String(error)}`);
      if (this.cache) {
        return this.cache.data;
      }

      return {
        location: this.city,
        temperature: Number.NaN,
        weather: '同步中',
        weatherType: 'sunny',
        humidity: Number.NaN,
        windSpeed: '',
      };
    }
  }

  private async fetchWeatherForLocation(location: string, city: string): Promise<WeatherDTO> {
    const response = await this.httpService.axiosRef.get(this.qweatherApiUrl, {
      params: {
        location,
        key: this.apiKey,
      },
      timeout: 5000,
    });

    const data = response.data;
    if (data.code !== '200') {
      throw new Error(`和风天气 API 返回异常：${data.code} ${data.message || ''}`.trim());
    }

    return this.parseWeatherData(city, data.now || {});
  }

  private parseWeatherData(location: string, now: any): WeatherDTO {
    const temperature = Math.round(Number(now.temp));
    const humidity = Math.round(Number(now.humidity));
    const weatherText = String(now.text || '');
    const windDir = String(now.windDir || '');
    const windScale = String(now.windScale || '');

    return {
      location,
      temperature,
      weather: weatherText,
      weatherType: this.getWeatherType(weatherText),
      humidity,
      windSpeed: `${windDir} ${windScale ? `${windScale}级` : ''}`.trim(),
    };
  }

  private getWeatherType(text: string): WeatherDTO['weatherType'] {
    if (text.includes('雪')) return 'snowy';
    if (text.includes('雨')) return 'rainy';
    if (text.includes('阴')) return 'cloudy';
    if (text.includes('云')) return 'partlyCloudy';
    return 'sunny';
  }
}
