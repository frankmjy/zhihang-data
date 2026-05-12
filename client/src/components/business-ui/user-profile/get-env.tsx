export function getEnv(): 'BOE' | 'PRE' | 'ONLINE' {
  const { origin } = window.location;
  const platformHost = ['miao', 'da.feishuapp.net'].join('');
  const platformPreHost = ['miao', 'da-pre.feishuapp.net'].join('');
  // 线上环境
  if (
    origin.includes('feishuapp.cn') ||
    origin.includes(platformHost)
  ) {
    return 'ONLINE';
    // PRE 环境
  } else if (
    origin.includes('fsapp.kundou.cn') ||
    origin.includes(platformPreHost)
  ) {
    return 'PRE';
    // BOE 环境
  } else {
    return 'BOE';
  }
}
