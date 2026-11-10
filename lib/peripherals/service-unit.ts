function argument(value: string) {
	if (!value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Peripheral service paths must be absolute without control characters');
	return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$$$') + '"';
}

export function renderPeripheralUnit(executable: string, config: string) {
	return `[Unit]\nDescription=Show Tools peripheral controller\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\nExecStart=${argument(executable)} serve --config ${argument(config)}\nRestart=on-abnormal\nRestartSec=3s\nKillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
}
