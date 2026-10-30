/** BT.709 display luminance in encoded RGB; alpha and pixel geometry unchanged. */
export function grayscaleRgba(pixels: Uint8Array | Uint8ClampedArray): void {
  if (pixels.length % 4 !== 0) throw new Error('RGBA pixels require complete four-channel tuples');
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const gray = Math.round(.2126 * pixels[offset] + .7152 * pixels[offset + 1] + .0722 * pixels[offset + 2]);
    pixels[offset] = gray; pixels[offset + 1] = gray; pixels[offset + 2] = gray;
  }
}
