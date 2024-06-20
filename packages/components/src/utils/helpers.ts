import { BtnStyle } from '../types/index.js';

export function detectDevice(userAgent: string) {
  const userAgentLowerCase = userAgent.toLowerCase();

  if (/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgentLowerCase)) {
    return 'mobile';
  }

  if (/mac|win/i.test(userAgentLowerCase)) {
    return 'laptop';
  }

  return 'unknown';
}

export const getBtnThemeStyle = (btnStyle?: BtnStyle) => {
  const themeStyle = sessionStorage.getItem('theme_style') ?? '';
  const parseThemeStyle = themeStyle && JSON.parse(themeStyle);

  const mappingThemeStyle = {
    color: btnStyle?.color ?? parseThemeStyle?.secondaryColor,
    backgroundColor: btnStyle?.backgroundColor ?? parseThemeStyle?.primaryColor,
  };
  return mappingThemeStyle;
};
