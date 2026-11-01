import { prepareSelectedMusicXml } from './export.js';

declare const google: { script: { run: {
  withSuccessHandler(handler: (value: unknown) => void): {
    withFailureHandler(handler: (error: { message: string }) => void): { getMusicXmlSelection(): void };
  };
} } };

const status = document.querySelector('#status'), summary = document.querySelector('#summary'), download = document.querySelector('#download');
if (!(status instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(download instanceof HTMLAnchorElement)) throw new Error('Export dialog is incomplete.');
let url: string | null = null;
const fail = (error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  status.setAttribute('role', 'alert');
  download.hidden = true;
};
window.addEventListener('pagehide', () => { if (url) URL.revokeObjectURL(url); });

google.script.run.withSuccessHandler((payload: unknown) => {
  status.textContent = 'Converting the captured chart…';
  void prepareSelectedMusicXml(payload).then(result => {
    url = URL.createObjectURL(new Blob([result.xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' }));
    summary.textContent = `${result.report.parts.map(part => part.name).join(', ')} · ${result.report.measureCount} bars`;
    status.textContent = 'Ready to download.';
    download.href = url;
    download.download = result.filename;
    download.hidden = false;
  }).catch(fail);
}).withFailureHandler(error => fail(new Error(error.message))).getMusicXmlSelection();
