declare const ShowToolsMusicXmlServer: typeof import('./server.js');

function onOpen(): void { ShowToolsMusicXmlServer.onOpen(); }
function showMusicXmlExport(): void { ShowToolsMusicXmlServer.showMusicXmlExport(); }
function getMusicXmlSelection() { return ShowToolsMusicXmlServer.getMusicXmlSelection(); }
