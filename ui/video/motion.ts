export interface PoseSample { readonly pose: number; readonly sway: number; readonly breath: number }
export type PoseSampler = (quarter: number, model: number) => PoseSample;

export async function loadPoseSampler(): Promise<PoseSampler> {
  const response = await fetch(new URL('./wasm/video-pose.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Pose module could not load (${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const { vp_pose, vp_sway, vp_breath } = instance.exports;
  if (typeof vp_pose !== 'function' || typeof vp_sway !== 'function' || typeof vp_breath !== 'function') throw new Error('Pose module has an incompatible interface');
  return (quarter, model) => ({ pose: Number(vp_pose(quarter, model)), sway: Number(vp_sway(quarter, model)), breath: Number(vp_breath(quarter, model)) });
}
