import { validDate } from './domain.js';

function dateValues(text) {
  const values = [];
  const re =
    /(?<!\d)(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?|(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g;
  for (const match of text.matchAll(re)) {
    const [, y1, m1, d1, y2, m2, d2] = match;
    const date = `${y1 || y2}-${(m1 || m2).padStart(2, '0')}-${(d1 || d2).padStart(2, '0')}`;
    if (validDate(date) && !values.includes(date)) values.push(date);
  }
  return values;
}

function labeledMerchant(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /(?:\[\s*)?(?:상호(?:명)?|업체명|매장명|가맹점명)(?:\s*\])?\s*[:：]?\s*(.+)$/,
    );
    if (!match) continue;
    const value = match[1]
      .replace(/\s{2,}.*$/, '')
      .replace(/[|｜]+$/, '')
      .trim();
    if (value.length > 1 && /[가-힣A-Za-z]/.test(value) && !/^[^가-힣A-Za-z]*$/.test(value))
      return value.slice(0, 160);
  }
  return '';
}

function labeledAmount(text) {
  const priorities = [
    /승인\s*금액/,
    /영수\s*금액/,
    /결제\s*(?:총액|금액)/,
    /매출\s*합계/,
    /받을\s*금액/,
    /받은\s*금액/,
    /주문\s*총액/,
    /주문\s*합계/,
    /합계\s*금액/,
    /총\s*합계/,
    /카드\s*금액/,
    /총\s*액/,
    /합\s*계/,
  ];
  const lines = text.split(/\r?\n/);
  for (const label of priorities) {
    const values = [];
    for (const line of lines) {
      if (!label.test(line) || /부가세|부가\s*세|공급가|과세물품|봉사료/.test(line)) continue;
      const matches = [...line.matchAll(/(?:₩\s*)?(\d[\d,]{2,})\s*(?:원)?/g)];
      const raw = matches.at(-1)?.[1];
      if (!raw) continue;
      const value = Number(raw.replaceAll(',', ''));
      if (Number.isSafeInteger(value) && value > 0 && !values.includes(value)) values.push(value);
    }
    if (values.length === 1) return String(values[0]);
    if (values.length > 1) return '';
  }
  return '';
}

export function parseReceiptText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const labeledDateLines = lines.filter((line) =>
    /승인\s*일시|승인\s*일자|거래\s*일시|거래\s*일자|계산\s*일자|매출\s*일자|사용\s*일자|발행\s*일시/.test(
      line,
    ),
  );
  const explicitDates = [...new Set(labeledDateLines.flatMap(dateValues))];
  const allDates = dateValues(text);
  return {
    merchantName: labeledMerchant(text),
    amount: labeledAmount(text),
    receiptDate:
      explicitDates.length === 1
        ? explicitDates[0]
        : explicitDates.length === 0 && allDates.length === 1
          ? allDates[0]
          : '',
  };
}
