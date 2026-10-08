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

function labeledLocation(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const label = /(?:\[\s*)?(?:사업장\s*주소|가맹점\s*주소|주소|소재지|사용\s*장소|장소)(?:\s*\])?\s*[:：]?\s*/i;
  const contactOrOtherField = /\s+(?=(?:TEL|전화|대표자|사업자(?:등록)?번호|승인(?:번호|일시)|거래(?:일시|일자)|계산일자|대표번호)\s*[:：]?)/i;
  const clean = (value) => value
    .replace(contactOrOtherField, '\n')
    .split(/\n/)[0]
    .replace(/[|｜]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const plausible = (value) => {
    if (value.length < 5 || value.length > 160 || !/[가-힣]/.test(value)) return false;
    if (/(?:사업자|등록번호|승인|매출|영수|결제|카드|전화|TEL|대표자|담당자|품명|금액|일시|일자)/i.test(value)) return false;
    return /(?:특별시|광역시|특별자치시|특별자치도|충청남도|충청북도|경상남도|경상북도|전라남도|전라북도|충남|충북|경남|경북|전남|전북|강원|경기|제주|서울|부산|대구|인천|광주|대전|울산|세종|서산|천안|당진|아산)/.test(value) &&
      /(?:시|군|구|읍|면|동|리|로|길|번길|대로)/.test(value);
  };

  // Prefer a labeled address. Some receipt layouts put the value on the next OCR line.
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(label);
    if (!match) continue;
    const sameLine = clean(lines[i].slice(match[0].length));
    if (plausible(sameLine)) return sameLine.slice(0, 160);
    if (!sameLine) {
      const next = clean(lines[i + 1] || '');
      if (plausible(next)) return next.slice(0, 160);
    }
  }

  // Many Korean card slips have no address label. Find a region + locality/road
  // pattern, while rejecting dates, phone numbers, business IDs and payment rows.
  const candidates = [];
  for (const rawLine of lines) {
    const withoutLabel = rawLine.replace(label, '').trim();
    const value = clean(withoutLabel);
    if (!plausible(value)) continue;
    const score = (/(?:특별시|광역시|특별자치도|충청남도|충청북도|경상남도|경상북도|전라남도|전라북도|충남|충북|경남|경북|전남|전북|강원|경기|제주)/.test(value) ? 3 : 0) +
      (/(?:읍|면|동|리)/.test(value) ? 2 : 0) +
      (/(?:로|길|번길|대로)\s*\S+/.test(value) ? 2 : 0) +
      (/\d/.test(value) ? 1 : 0) +
      (/(?:주소|소재지)/.test(rawLine) ? 4 : 0);
    candidates.push({ value, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value.slice(0, 160) || '';
}

function labeledAmount(text) {
  const priorities = [
    /총\s*승인\s*(?:금액|총액)/,
    /승인\s*총\s*(?:금액|액)/,
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
    location: labeledLocation(text),
    receiptDate:
      explicitDates.length === 1
        ? explicitDates[0]
        : explicitDates.length === 0 && allDates.length === 1
          ? allDates[0]
          : '',
  };
}
