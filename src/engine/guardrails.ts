import { splitIntoSentences } from '../services/tts/TTSService';

/**
 * Deterministic guardrails that run in the ConversationEngine around the LLM
 * call. The on-device model is a 1.5B instruct model — its behaviour cannot be
 * relied on from a prose system prompt alone, so crisis handling, a narrow
 * hard-block, and output shape are enforced in code.
 *
 * The system prompt (see constants/modes.ts) remains the primary control for
 * tone and instruction hierarchy; this module is defence in depth.
 */

// --- Self-harm / suicide crisis detection ----------------------------------

// Intent-anchored patterns. Idioms ("this traffic is killing me", "dying to see
// it") are deliberately excluded by requiring a first-person target plus an
// intent verb, or an unambiguous term ("suicidal", "self-harm").
const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(?:ing)?\s+my\s?self\b/i,
  /\b(?:end|ending|take|taking)\s+my\s+(?:own\s+)?life\b/i,
  /\bi\s+(?:want|wanna|need|plan|planning|am going|'m going)\s+to\s+(?:die|be\s+dead)\b/i,
  /\bi\s+just\s+want\s+to\s+die\b/i,
  /\bi\s+don'?t\s+want\s+to\s+(?:be\s+here|live|be\s+alive|wake\s+up)\b/i,
  /\b(?:commit|committing|attempt(?:ing)?)\s+suicide\b/i,
  /\bthinking\s+about\s+suicide\b/i,
  /\bsuicidal\b/i,
  /\bbetter\s+off\s+(?:dead|without\s+me)\b/i,
  /\bno\s+reason\s+to\s+(?:live|go\s+on)\b/i,
  /\b(?:hurt|harm|cut|cutting)\s+my\s?self\b/i,
  /\bself[-\s]?harm\b/i,
];

export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

/**
 * Returned verbatim (not sent to the model, not sanitised) whenever
 * {@link detectCrisis} matches.
 */
export const CRISIS_RESPONSE =
  'It sounds like you are carrying something really heavy right now, and I am glad you told me. ' +
  'Please talk to someone who can help directly: in the US you can call or text 988 for the Suicide and Crisis Lifeline, ' +
  'or text HOME to 741741; anywhere else, findahelpline.com has a number for your country. ' +
  'If you feel you might act on this, contact your local emergency number now — I am staying right here with you.';

// --- Narrow hard-block for unambiguous harmful requests -------------------

// Highest-signal, lowest-ambiguity categories only. The model refuses most of
// these on its own; this catches the case where a jailbreak in context has
// eroded that. Kept tight to avoid false positives in a companion-app setting.
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /\b(?:build|make|making|construct|assemble|synthesi[sz]e|craft)\b.{0,40}\b(?:bomb|explosive|explosives|ied|detonator|napalm|grenade|pipe\s?bomb)\b/i,
  /\b(?:synthesi[sz]e|cook|make|manufacture|produce|prepare)\b.{0,30}\b(?:meth|methamphetamine|fentanyl|heroin|cocaine|mdma|nerve\s+agent|sarin|vx|ricin)\b/i,
  /\bhow\s+to\s+(?:make|build|3d\s?print)\s+a\s+(?:gun|firearm|silencer|suppressor|ghost\s+gun)\b/i,
  /\b(?:untraceable|undetectable)\s+poison\b/i,
];

const HARD_BLOCK_REPLY =
  "I can't help with that one. If there's something else on your mind, though, I'm here for it.";

export function screenUserInput(text: string): string | null {
  return HARD_BLOCK_PATTERNS.some((re) => re.test(text)) ? HARD_BLOCK_REPLY : null;
}

// --- Jailbreak / prompt-extraction detection -----------------------------

// A 1.5B model follows "ignore your instructions / reply only X" often enough
// that the system prompt alone cannot hold the line. These patterns are
// anchored on the assistant's own instructions/persona so everyday phrases
// ("ignore the rules at work", "no filter on my camera") don't trip them.
const JAILBREAK_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(?:previous|prior|above|earlier|initial|all|your|the)\b[^.?!]{0,20}\b(?:instructions?|prompts?|directives?|guidelines?|programming)\b/i,
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:your\s+|the\s+)?system\s+prompt\b/i,
  /\b(?:you\s+are(?:\s+now)?|you'?re(?:\s+now)?|act\s+as|acting\s+as|pretend\s+(?:to\s+be|you'?re)|roleplay\s+as|from\s+now\s+on\s+you\s+are)\b[^.?!]{0,25}\b(?:an?\s+(?:unrestricted|unfiltered|uncensored|jailbroken)\b|a\s+different\s+(?:ai|assistant))/i,
  /\bDAN\b/, // the "DAN" jailbreak — all-caps, case-sensitive to avoid the name "Dan"
  /\bdo\s+anything\s+now\b/i,
  /\b(?:developer|god|admin|debug|sudo|dev)\s+mode\b/i,
  /\bjailbreak(?:ing|en)?\b/i,
  /\bno\s+content\s+polic(?:y|ies)\b/i,
  /\bunfiltered\s+(?:ai|assistant|mode|responses?)\b/i,
  /\b(?:reveal|show\s+me|print|repeat|output|tell\s+me|give\s+me)\b[^.?!]{0,25}\b(?:your\s+)?(?:exact\s+|full\s+|initial\s+|original\s+|verbatim\s+)?(?:system\s+)?(?:prompt|instructions)\b/i,
  /\b(?:repeat|print|output|show|reveal|say)\b[^.?!]{0,20}\b(?:words?|text|everything|message|lines?|prompt)\s+(?:above|before\s+this)\b/i,
  /\bstarting\s+with\s+["'“]?\s*you\s+are\b/i,
  /\bwhat\s+(?:exactly\s+)?(?:were|are)\s+you\s+(?:told|instructed|programmed|prompted)\b/i,
];

const JAILBREAK_REPLY =
  "I'm just Nova here — nothing hidden, nothing to unlock. What's actually on your mind?";

export function detectJailbreak(text: string): boolean {
  return JAILBREAK_PATTERNS.some((re) => re.test(text));
}

export function screenForJailbreak(text: string): string | null {
  return detectJailbreak(text) ? JAILBREAK_REPLY : null;
}

// --- Output shaping -------------------------------------------------------

/** Persona target: "usually 1-2 sentences, occasionally 3". */
export const MAX_REPLY_SENTENCES = 3;

/**
 * Strips markdown and clamps the reply to `maxSentences`. The on-device model
 * ignores "no markdown / keep it short" instructions often enough that this has
 * to be enforced after generation — the app is eyes-free and the reply is read
 * aloud by TTS.
 */
export function sanitizeResponse(
  text: string,
  maxSentences: number = MAX_REPLY_SENTENCES,
): string {
  let out = text;

  // Fenced code blocks: drop the fences, keep the inner text.
  out = out.replace(/```[a-zA-Z0-9]*\n?/g, '').replace(/```/g, '');
  // Inline code.
  out = out.replace(/`([^`]*)`/g, '$1');
  // Headings (# ...) and bold-only lines (**...**) used as pseudo-headings ->
  // a standalone sentence. Add terminal punctuation if missing so the text is
  // not glued onto the following sentence by the splitter.
  const asSentence = (_m: string, h: string) => (/[.!?:]$/.test(h) ? h : `${h}.`);
  out = out.replace(/^\s{0,3}#{1,6}\s+(.*?)\s*$/gm, asSentence);
  out = out.replace(/^\s{0,3}\*\*\s*(.+?)\s*\*\*\s*$/gm, asSentence);
  // Blockquotes.
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  // Bullet / numbered list markers at line start.
  out = out.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '');
  // Markdown links -> link text.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bold / italic / strikethrough wrappers around content.
  out = out.replace(/(\*\*|__|\*|_|~~)(?=\S)(.*?\S)\1/g, '$2');
  // Stray emphasis lines / leftover markers.
  out = out.replace(/^\s*[*_~]{1,3}\s*$/gm, '');
  // Collapse newlines and runs of spaces into single spaces.
  out = out.replace(/\s*\n+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();

  const sentences = splitIntoSentences(out);
  if (sentences.length > maxSentences) {
    out = sentences.slice(0, maxSentences).join(' ').trim();
  }

  // Never hand back an empty string for a non-empty input.
  if (!out && text.trim()) {
    return text.replace(/\s+/g, ' ').trim();
  }
  return out;
}
