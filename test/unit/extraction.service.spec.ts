import { ExtractionService } from '../../server/modules/extraction/extraction.service';

describe('ExtractionService', () => {
  const service = new ExtractionService({} as any, {} as any);

  it('extracts configured nested fields from JSON responses', () => {
    const result = (service as any).processResponse(
      {
        data: {
          list: [{ id: 'risk-1' }],
          count: 1,
        },
      },
      {
        format: 'json',
        extractFields: ['data.count', 'data.list'],
      },
    );

    expect(JSON.parse(result)).toEqual({
      'data.count': 1,
      'data.list': [{ id: 'risk-1' }],
    });
  });

  it('returns undefined instead of throwing for invalid stored JSON', () => {
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    expect((service as any).safeParseJson('{broken-json')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
