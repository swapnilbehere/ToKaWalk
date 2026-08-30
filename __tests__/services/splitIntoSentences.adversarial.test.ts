/**
 * splitIntoSentences feeds both TTS chunking and the guardrail sentence cap.
 * Degenerate input must not throw, hang (Hermes lookbehind), or lose text.
 */
import { splitIntoSentences } from '../../src/services/tts/TTSService';

describe('splitIntoSentences — degenerate input', () => {
  it('empty / whitespace -> []', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   \n\t ')).toEqual([]);
  });

  it('no sentence punctuation -> one chunk, content preserved', () => {
    const s = 'this is a long thought with no ending punctuation at all whatsoever';
    expect(splitIntoSentences(s)).toEqual([s]);
  });

  it('every chunk concatenates back to the original words', () => {
    const src = 'First. Second! Third? NASA. Then U.S. things. Done.';
    const parts = splitIntoSentences(src);
    expect(parts.join(' ')).toBe(src);
  });

  it('does not split decimals or version numbers', () => {
    expect(splitIntoSentences('It is 3.5 miles. Then 2.0 more.')).toEqual([
      'It is 3.5 miles.',
      'Then 2.0 more.',
    ]);
  });

  it('handles a huge single run-on quickly and without throwing', () => {
    const huge = 'word '.repeat(100_000);
    const t0 = Date.now();
    const parts = splitIntoSentences(huge);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(parts).toHaveLength(1);
  });

  it('handles many short sentences quickly', () => {
    // Splitter only breaks after a letter+punctuation, so end each with a word.
    const many = Array.from({ length: 5000 }, (_, i) => `line number ${i} ends here.`).join(' ');
    const t0 = Date.now();
    const parts = splitIntoSentences(many);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(parts.length).toBeGreaterThan(1000);
  });

  it('known limitation: a digit before the period does not trigger a split', () => {
    // Documents current behaviour so a future change is a conscious choice.
    expect(splitIntoSentences('Point 1. Point 2.')).toEqual(['Point 1. Point 2.']);
  });

  it('tolerates unicode, emoji, and newlines mid-text', () => {
    expect(() => splitIntoSentences('Nice walk 🚶‍♀️ today.\nThe air is crisp. Enjoy!')).not.toThrow();
    const parts = splitIntoSentences('Nice walk today. The air is crisp. Enjoy!');
    expect(parts).toEqual(['Nice walk today.', 'The air is crisp.', 'Enjoy!']);
  });

  it('only-punctuation input does not throw', () => {
    expect(() => splitIntoSentences('... !!! ??? .')).not.toThrow();
  });
});
