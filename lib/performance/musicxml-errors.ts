export class MusicXmlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicXmlValidationError';
  }
}
