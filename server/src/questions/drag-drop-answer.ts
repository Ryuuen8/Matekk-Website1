// Reads drag-and-drop questions imported from the 9tut PDFs, whose answer key is stored as text.
export interface DragDropAnswer {
  items: string[];
  choices: string[];
  answer: number[];
}

const MOJIBAKE: Array<[string, string]> = [
  ['â€“', '–'], ['â€”', '—'], ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€\u009d', '”'], ['â€³', '”'],
  ['â€¦', '…'], ['â€¢', '•'], ['Â ', ' '], ['Â', ''],
];

function cleanText(text: string): string {
  let result = text;
  for (const [bad, good] of MOJIBAKE) result = result.split(bad).join(good);
  result = result.replace(/\+?\s*\w*mium Member:?\s*(?:You can test your knowledge[^\n]*)?/gi, '');
  return result
    .split('\n')
    .filter((line) => !/^\s*=+.*=+\s*$/.test(line) && !/New Questions \(added on/i.test(line))
    .join('\n')
    .trim();
}

function stableShuffle<T extends { key: string }>(items: T[], seed: string): T[] {
  const hash = (text: string) => [...text].reduce(
    (value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) | 0,
    7,
  );
  return [...items].sort((first, second) => hash(seed + first.key) - hash(seed + second.key));
}

function parseGroups(answerText: string, seed: string): DragDropAnswer | null {
  const lines = answerText.split('\n').map((line) => line.trim()).filter(Boolean);
  const groups: Array<{ name: string; items: string[] }> = [];
  lines.forEach((line, index) => {
    const isBullet = line.startsWith('+');
    const nextIsBullet = (lines[index + 1] ?? '').startsWith('+');
    const isHeader = !isBullet && ((line.endsWith(':') && line.length <= 60) || nextIsBullet);
    if (isHeader) groups.push({ name: line.replace(/:$/, '').trim(), items: [] });
    else if (groups.length) groups[groups.length - 1].items.push(line.replace(/^\+\s*/, '').trim());
  });
  if (groups.length < 2 || groups.some((group) => !group.items.length)) return null;
  const all = groups.flatMap((group, groupIndex) =>
    group.items.map((item) => ({ key: item, item, groupIndex })),
  );
  const shuffled = stableShuffle(all, seed);
  return {
    items: shuffled.map(({ item }) => item),
    choices: groups.map(({ name }) => name),
    answer: shuffled.map(({ groupIndex }) => groupIndex),
  };
}

function parsePairs(answerText: string): DragDropAnswer | null {
  const lines = answerText
    .replace(/\s\+\s(?=[^:+\n]{1,150}:\s)/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\+\s*/, '').trim())
    .filter(Boolean);
  const pairs = lines.map((line) => {
    const match = /^(.{1,150}?)\s*(?::\s+|\s+:\s*|\s+[–-]\s+)(.+)$/.exec(line);
    return match ? { left: match[1].trim(), right: match[2].trim() } : null;
  });
  if (pairs.length < 2 || pairs.some((pair) => !pair)) return null;
  const lefts = pairs.map((pair) => pair!.left);
  const rights = pairs.map((pair) => pair!.right);
  if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) return null;
  return { items: lefts, choices: rights, answer: rights.map((_, index) => index) };
}

export function parseDragDropAnswer(
  correctAnswer: string | null | undefined,
  questionId: number,
): DragDropAnswer | null {
  const answerText = cleanText(String(correctAnswer ?? ''));
  if (!answerText) return null;
  const parsed = parseGroups(answerText, String(questionId)) ?? parsePairs(answerText);
  if (
    !parsed ||
    parsed.items.length < 2 ||
    parsed.items.length > 8 ||
    parsed.choices.length < 2 ||
    parsed.choices.length > 8
  ) {
    return null;
  }
  if (parsed.items.every((item) => /^\d+$/.test(item))) {
    return { ...parsed, items: parsed.items.map((item) => `Step ${item}`) };
  }
  return parsed;
}
