import { Controller, Get } from '@nestjs/common';
import { WeatherDTO } from '@shared/api.interface';
import { WeatherService } from './weather.service';

@Controller('api/weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get()
  async getWeather(): Promise<WeatherDTO> {
    return this.weatherService.getWeather();
  }
}
