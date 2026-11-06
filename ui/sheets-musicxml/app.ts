import { prepareSelectedMusicXml } from './export.js';

declare const google: { script: { run: {
  withSuccessHandler(handler: (value: unknown) => void): {
    withFailureHandler(handler: (error: { message: string }) => void): { getMusicXmlSelection(): void };
  };
} } };

const status = document.querySelector('#status'), summary = document.querySelector('#summary'), download = document.querySelector('#download');
const musicianSection = document.querySelector('#musician-section'), musicianLinks = document.querySelector('#musician-links');
if (!(status instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(download instanceof HTMLAnchorElement)
  || !(musicianSection instanceof HTMLElement) || !(musicianLinks instanceof HTMLUListElement)) throw new Error('Export dialog is incomplete.');
const urls: string[] = [];
const fail = (error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  status.setAttribute('role', 'alert');
  download.hidden = true;
};
window.addEventListener('pagehide', () => { for (const url of urls) URL.revokeObjectURL(url); });

google.script.run.withSuccessHandler((payload: unknown) => {
  status.textContent = 'Converting the captured chart…';
  void prepareSelectedMusicXml(payload).then(result => {
    const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' }));
    urls.push(url);
    summary.textContent = `${result.report.parts.map(part => part.name).join(', ')} · ${result.report.measureCount} bars`;
    status.textContent = 'Complete song ready. Selected musician sheets are listed below.';
    download.href = url;
    download.download = result.filename;
    download.hidden = false;
    for (const sheet of result.musicianSheets) {
      const item = document.createElement('li');
      for (const file of [
        { text: `${sheet.name}: printable notes sheet`, contents: sheet.html, type: 'text/html;charset=utf-8', suffix: 'html' },
        { text: 'MusicXML', contents: sheet.xml, type: 'application/vnd.recordare.musicxml+xml;charset=utf-8', suffix: 'musicxml' },
      ]) {
        const link = document.createElement('a');
        const href = URL.createObjectURL(new Blob([file.contents], { type: file.type })); urls.push(href);
        link.href = href; link.download = `${sheet.stem}.${file.suffix}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = file.text;
        if (item.childNodes.length) item.append(' · ');
        item.append(link);
      }
      musicianLinks.append(item);
    }
    musicianSection.hidden = result.musicianSheets.length === 0;
  }).catch(fail);
}).withFailureHandler(error => fail(new Error(error.message))).getMusicXmlSelection();
