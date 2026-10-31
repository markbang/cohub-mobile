// Han, kana, Hangul, and their punctuation are written without spaces between words.
const CJK = /[\u2e80-\u2fdf\u3000-\u30ff\u3100-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;
const CJK_PUNCTUATION = /[\u3000-\u303f\uff00-\uff0f\uff1a-\uff20]/u;

/** Appends dictated text to the draft, keeping the user's own trailing whitespace and line breaks. */
export function appendVoiceText(current: string, dictated: string) {
  const addition = dictated.trim();
  if (!addition) return current;
  if (!current || /\s$/u.test(current)) return current + addition;
  const before = current.slice(-1);
  const after = addition.slice(0, 1);
  const joined = CJK_PUNCTUATION.test(before) || (CJK.test(before) && CJK.test(after));
  return joined ? current + addition : `${current} ${addition}`;
}
