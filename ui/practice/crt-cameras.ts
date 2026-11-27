import type { CrtCamera, CrtCameraSnapshot } from '../../lib/remote-performance/crt-camera-schema.js';
import type { RemoteDesk } from './remote-session.js';

type CameraDesk = Pick<RemoteDesk, 'cameraSnapshot' | 'cutCamera'>;
type Connection = { desk: CameraDesk; lifetime: AbortController };
type CameraView = CrtCameraSnapshot | { kind: 'unavailable'; cameras: readonly CrtCamera[] };
const POLL_INTERVAL_MS = 1500;

export function mountCrtCameras(elements: {
  panel: HTMLElement;
  pads: HTMLElement;
  status: HTMLElement;
  header: HTMLElement;
}, lifetime: AbortSignal) {
  const { panel, pads, status, header } = elements;
  const desktopParent = panel.parentNode;
  const desktopNext = panel.nextSibling;
  const restorePanel = () => desktopParent?.insertBefore(panel, desktopNext);
  const phone = matchMedia('(max-width: 700px)');
  const placePanel = () => phone.matches ? header.after(panel) : restorePanel();
  phone.addEventListener('change', placePanel, { signal: lifetime });
  placePanel();

  let connection: Connection | undefined;
  let view: CameraView = { kind: 'disabled' };
  let poll: AbortController | undefined;
  let nextPoll: ReturnType<typeof setTimeout> | undefined;
  let pendingCut: CrtCamera | undefined;
  let failedCut: CrtCamera | undefined;
  let buttons: { camera: CrtCamera; button: HTMLButtonElement; live: HTMLElement }[] = [];

  function render() {
    panel.hidden = lifetime.aborted || view.kind === 'disabled';
    const cameras = view.kind === 'disabled' ? [] : view.cameras;
    if (cameras.length !== buttons.length || cameras.some((camera, index) =>
      camera.id !== buttons[index].camera.id || camera.label !== buttons[index].camera.label)) {
      buttons = cameras.map(camera => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'crt-camera-pad';
        const label = document.createElement('span');
        label.textContent = camera.label;
        const live = document.createElement('span');
        live.className = 'crt-camera-live';
        live.textContent = 'LIVE';
        live.setAttribute('aria-hidden', 'true');
        button.append(label, live);
        button.addEventListener('click', () => void cut(camera), { signal: lifetime });
        return { camera, button, live };
      });
      pads.replaceChildren(...buttons.map(({ button }) => button));
    }
    const selectedId = connection && view.kind === 'ready' ? view.selectedId : null;
    const canCut = connection && view.kind === 'ready' && !pendingCut;
    for (const { camera, button, live } of buttons) {
      const selected = selectedId === camera.id;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-disabled', String(!canCut));
      live.hidden = !selected;
    }

    const selectedCamera = cameras.find(camera => camera.id === selectedId);
    const cameraStatus = panel.hidden ? ''
      : !connection ? 'Hardware desk disconnected.'
      : view.kind === 'offline' ? 'Configured OBS cameras unavailable.'
      : view.kind === 'unavailable' ? 'Cameras unavailable.'
      : selectedCamera ? `${selectedCamera.label} is live.`
      : 'No confirmed CRT camera.';
    const message = pendingCut ? `Cutting to ${pendingCut.label}…`
      : failedCut ? `Cut to ${failedCut.label} unconfirmed. ${cameraStatus}`
      : cameraStatus;
    if (status.textContent !== message) status.textContent = message;
  }

  function cancelPoll() {
    clearTimeout(nextPoll);
    poll?.abort();
    poll = undefined;
  }

  async function refresh(current: Connection) {
    const request = new AbortController();
    poll = request;
    try {
      const snapshot = await current.desk.cameraSnapshot(request.signal);
      if (poll === request) {
        view = snapshot;
        if (snapshot.kind === 'ready' && snapshot.selectedId === failedCut?.id) failedCut = undefined;
      }
    } catch {
      if (poll === request) view = { kind: 'unavailable', cameras: view.kind === 'disabled' ? [] : view.cameras };
    } finally {
      if (poll === request) {
        poll = undefined;
        render();
        if (view.kind !== 'disabled') nextPoll = setTimeout(() => void refresh(current), POLL_INTERVAL_MS);
      }
    }
  }

  async function cut(camera: CrtCamera) {
    const current = connection;
    if (!current || view.kind !== 'ready' || pendingCut) return;
    const cameras = view.cameras;
    cancelPoll();
    pendingCut = camera;
    failedCut = undefined;
    render();
    try {
      const snapshot = await current.desk.cutCamera(camera.id, current.lifetime.signal);
      if (connection === current) view = snapshot;
    } catch {
      if (connection === current) {
        failedCut = camera;
        view = { kind: 'unavailable', cameras };
      }
    } finally {
      if (connection === current) {
        pendingCut = undefined;
        render();
        if (failedCut) void refresh(current);
        else nextPoll = setTimeout(() => void refresh(current), POLL_INTERVAL_MS);
      }
    }
  }

  function setDesk(desk: CameraDesk | undefined) {
    if (lifetime.aborted) desk = undefined;
    if (connection?.desk === desk) return;
    connection?.lifetime.abort();
    cancelPoll();
    pendingCut = undefined;
    failedCut = undefined;
    connection = desk ? { desk, lifetime: new AbortController() } : undefined;
    if (connection) {
      view = { kind: 'disabled' };
      void refresh(connection);
    }
    render();
  }

  lifetime.addEventListener('abort', () => {
    setDesk(undefined);
    panel.hidden = true;
    restorePanel();
  }, { once: true });
  return setDesk;
}
