import { splitIntoSentences } from '../../src/services/tts/TTSService';

describe('splitIntoSentences', () => {
  it('splits on period followed by space', () => {
    expect(splitIntoSentences('Hello world. How are you.')).toEqual([
      'Hello world.', 'How are you.',
    ]);
  });

  it('splits on question mark', () => {
    expect(splitIntoSentences('What is this? It is great!')).toEqual([
      'What is this?', 'It is great!',
    ]);
  });

  it('does not greedily split U.S. mid-word', () => {
    expect(splitIntoSentences('The U.S. is large. Really.')).toEqual([
      'The U.S. is large.', 'Really.',
    ]);
  });

  it('returns single item for text with no sentence boundary', () => {
    expect(splitIntoSentences('hello world')).toEqual(['hello world']);
  });

  it('returns empty array for empty string', () => {
    expect(splitIntoSentences('')).toEqual([]);
  });
});
