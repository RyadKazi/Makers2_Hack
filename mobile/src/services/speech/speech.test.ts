import { StaticSpeechToText } from './stt';
import { StaticTextToSpeech } from './tts';

describe('static speech prototypes', () => {
  afterEach(() => jest.useRealTimers());

  it('returns a clearly labeled sample transcript after the demo delay', async () => {
    jest.useFakeTimers();
    const service = new StaticSpeechToText();
    const result = service.startDemo('en');
    jest.advanceTimersByTime(2200);
    await expect(result).resolves.toContain('sample transcript');
  });

  it('cancels a pending sample when the student stops the demo', async () => {
    jest.useFakeTimers();
    const service = new StaticSpeechToText();
    const result = service.startDemo('en');
    service.stop();
    await expect(result).resolves.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('simulates play, pause, resume and stop without producing audio', () => {
    jest.useFakeTimers();
    const ended = jest.fn();
    const handle = new StaticTextToSpeech().createPreview('Hello there', { locale: 'en', speed: 1, voice: 'demo' }, ended);
    handle.pause();
    jest.advanceTimersByTime(2000);
    expect(ended).not.toHaveBeenCalled();
    handle.resume();
    handle.stop();
    jest.runOnlyPendingTimers();
    expect(ended).not.toHaveBeenCalled();
  });
});
