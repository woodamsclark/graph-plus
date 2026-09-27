export interface GraphColorV2 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const TRANSPARENT_GRAPH_COLOR_V2: GraphColorV2 = graphColorV2(0, 0, 0, 0);

export function graphColorV2(r: number, g: number, b: number, a = 1): GraphColorV2 {
  return Object.freeze({ r: channel(r), g: channel(g), b: channel(b), a: channel(a) });
}

export function parseGraphColorV2(value: string): GraphColorV2 | undefined {
  const source = value.trim().toLowerCase();
  if (!source) return undefined;
  if (source === 'transparent') return TRANSPARENT_GRAPH_COLOR_V2;
  if (source.startsWith('#')) return parseHex(source);
  const functionMatch = /^(rgba?|hsla?)\((.*)\)$/.exec(source);
  if (!functionMatch) return undefined;
  return functionMatch[1].startsWith('rgb')
    ? parseRgb(functionMatch[2])
    : parseHsl(functionMatch[2]);
}

export function requireGraphColorV2(value: string, fallback: GraphColorV2): GraphColorV2 {
  return parseGraphColorV2(value) ?? fallback;
}

export function graphColorToCssV2(color: GraphColorV2, opacity = 1): string {
  const alpha = channel(color.a * channel(opacity));
  const red = Math.round(channel(color.r) * 255);
  const green = Math.round(channel(color.g) * 255);
  const blue = Math.round(channel(color.b) * 255);
  return alpha >= 1
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${trim(alpha)})`;
}

export function multiplyGraphColorAlphaV2(color: GraphColorV2, opacity: number): GraphColorV2 {
  return graphColorV2(color.r, color.g, color.b, color.a * channel(opacity));
}

export function desaturateGraphColorV2(color: GraphColorV2, amount: number): GraphColorV2 {
  const mix = channel(amount);
  const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return graphColorV2(
    color.r + (gray - color.r) * mix,
    color.g + (gray - color.g) * mix,
    color.b + (gray - color.b) * mix,
    color.a,
  );
}

export function graphColorsEqualV2(left: GraphColorV2, right: GraphColorV2): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
}

function parseHex(value: string): GraphColorV2 | undefined {
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return undefined;
  const expanded = hex.length <= 4 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex;
  return graphColorV2(
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  );
}

function parseRgb(value: string): GraphColorV2 | undefined {
  const [channelsSource, slashAlpha] = splitSlash(value);
  const parts = splitComponents(channelsSource);
  let alphaSource = slashAlpha;
  if (parts.length === 4 && alphaSource === undefined) alphaSource = parts.pop();
  if (parts.length !== 3) return undefined;
  const channels = parts.map(parseRgbChannel);
  const alpha = alphaSource === undefined ? 1 : parseAlpha(alphaSource);
  if (channels.some((entry) => entry === undefined) || alpha === undefined) return undefined;
  return graphColorV2(channels[0]!, channels[1]!, channels[2]!, alpha);
}

function parseHsl(value: string): GraphColorV2 | undefined {
  const [channelsSource, slashAlpha] = splitSlash(value);
  const parts = splitComponents(channelsSource);
  let alphaSource = slashAlpha;
  if (parts.length === 4 && alphaSource === undefined) alphaSource = parts.pop();
  if (parts.length !== 3) return undefined;
  const hue = parseAngle(parts[0]);
  const saturation = parsePercent(parts[1]);
  const lightness = parsePercent(parts[2]);
  const alpha = alphaSource === undefined ? 1 : parseAlpha(alphaSource);
  if (hue === undefined || saturation === undefined || lightness === undefined || alpha === undefined) return undefined;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] = sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
      : sector < 3 ? [0, chroma, x]
        : sector < 4 ? [0, x, chroma]
          : sector < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = lightness - chroma / 2;
  return graphColorV2(red + match, green + match, blue + match, alpha);
}

function splitSlash(value: string): [string, string | undefined] {
  const parts = value.split('/');
  return [parts[0].trim(), parts.length === 2 ? parts[1].trim() : undefined];
}

function splitComponents(value: string): string[] {
  return value.includes(',') ? value.split(',').map((part) => part.trim()) : value.trim().split(/\s+/);
}

function parseRgbChannel(value: string): number | undefined {
  if (value.endsWith('%')) return parsePercent(value);
  const number = Number(value);
  return Number.isFinite(number) ? channel(number / 255) : undefined;
}

function parseAlpha(value: string): number | undefined {
  if (value.endsWith('%')) return parsePercent(value);
  const number = Number(value);
  return Number.isFinite(number) ? channel(number) : undefined;
}

function parsePercent(value: string): number | undefined {
  if (!value.endsWith('%')) return undefined;
  const number = Number(value.slice(0, -1));
  return Number.isFinite(number) ? channel(number / 100) : undefined;
}

function parseAngle(value: string): number | undefined {
  const match = /^(-?[0-9]+(?:\.[0-9]+)?)(deg|grad|rad|turn)?$/.exec(value);
  if (!match) return undefined;
  const number = Number(match[1]);
  const degrees = match[2] === 'grad' ? number * 0.9
    : match[2] === 'rad' ? number * 180 / Math.PI
      : match[2] === 'turn' ? number * 360
        : number;
  return ((degrees % 360) + 360) % 360;
}

function channel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}
