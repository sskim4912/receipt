import { validDate } from './domain.js';

// Only explicit receipt labels are used for amounts/approval numbers. Never use
// the largest arbitrary number (which may be a phone/card/business number).
export function parseReceiptText(text = '') {
  const lines = text
    .normalize('NFKC')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fields = {};
  const dates = [];
  for (const line of lines) {
    for (const match of line.matchAll(
      /\b(20\d{2}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?:\s*일)?\b/g,
    )) {
      const year = match[1].length === 2 ? '20' + match[1] : match[1];
      const date = `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      if (validDate(date)) dates.push(date);
    }
    const time = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
    if (time && !fields.receiptTime) fields.receiptTime = `${time[1].padStart(2, '0')}:${time[2]}`;
  }
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 1) fields.receiptDate = uniqueDates[0];

  const labelled = (pattern) => {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      const compact = lines[i].replace(/\s/g, '').replace(/^[*#·=_.-]+/, '');
      const match = compact.match(pattern);
      if (!match) continue;
      // A value can be on the following line, but only when the label line has
      // no value, never when it contains an unrecognizable/ambiguous value.
      const suffix = compact
        .slice(match.index + match[0].length)
        .replace(/^(?:\([^)]*\))+/g, '')
        .replace(/^[:：=₩￦]+/, '');
      const value = suffix || (lines[i + 1] || '').replace(/\s/g, '');
      // Korean OCR sometimes reads the unit 원 as 운. This does not change
      // any digits; amounts still require an explicit total/tax label.
      const money = value.match(/^([0-9]+(?:,[0-9]{3})*)(?:원|운|KRW)?$/i);
      if (money) {
        const number = Number(money[1].replaceAll(',', ''));
        if (Number.isSafeInteger(number) && number > 0 && number <= 999999999999)
          candidates.push(number);
      }
    }
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? String(unique[0]) : '';
  };
  const total = labelled(
    /^(?:총결제금액|실결제금액|총승인금액|총합계금액|합계금액|결제금액|결제합계|승인금액|매출합계|주문합계|영수금액|판매합계|받을금액|총금액|합계|총액|TOTAL(?:AMOUNT)?)/i,
  );
  if (total) fields.amount = total;
  const supply = labelled(/^(?:공급가액|공급가|과세금액)/);
  const vat = labelled(/^(?:부가세|부가가치세|VAT)/i);
  if (supply) fields.supplyAmount = supply;
  if (vat) fields.vatAmount = vat;

  const approvals = lines.flatMap((line) => {
    const match = line
      .replace(/\s/g, '')
      .match(/(?:승인번호|인번호|APPROVAL(?:NO|NUMBER)?)[：:#-]?(\d{1,40})(?:$|[^\d])/i);
    return match ? [match[1]] : [];
  });
  if (new Set(approvals).size === 1) {
    fields.approvalNumber = approvals[0];
    fields.approvalState = 'present';
  }
  const businessNumbers = lines
    .map((line) => line.match(/(\d{3}\s*-\s*\d{2}\s*-\s*\d{5})/))
    .filter(Boolean);
  if (businessNumbers.length) fields.businessNumber = businessNumbers[0][1].replace(/\s/g, '');
  const businessMerchant = lines
    .map((line) => line.match(/^(.{2,80}?)(?:\s*)(\d{3}\s*-\s*\d{2}\s*-\s*\d{5})/))
    .find(
      (match) =>
        match &&
        /[가-힣A-Za-z]/.test(match[1]) &&
        !/(사업자|등록번호|TEL|전화|주소|대표|번호)/i.test(match[1]),
    );
  const explicitMerchant = lines
    .map((line) =>
      line.match(/^(?:상\s*호(?:\s*명)?|가\s*맹\s*점(?:\s*명)?|업\s*체\s*명)\s*[:：]?\s*(.+)$/),
    )
    .find(Boolean);
  if (explicitMerchant) fields.merchantName = explicitMerchant[1].trim().slice(0, 160);
  else if (businessMerchant) {
    fields.merchantName = businessMerchant[1].replace(/^[*#=\s]+|[*#=\s]+$/g, '').slice(0, 160);
  } else {
    const heading = lines
      .slice(0, 5)
      .find(
        (line) =>
          /[가-힣A-Za-z]/.test(line) &&
          !/영수증|매출|전표|고객|보관|사업자|대표|주소|전화|TEL|RECEIPT|INVOICE|VISA|MASTER|카드|승인|\d{2,}/i.test(
            line,
          ) &&
          !/^[\s*#=._-]+$/.test(line) &&
          line.length >= 2 &&
          line.length <= 80,
      );
    if (heading) fields.merchantName = heading.replace(/^[*#=\s]+|[*#=\s]+$/g, '');
  }
  const complete = ['receiptDate', 'merchantName', 'amount', 'approvalNumber'].every(
    (key) => fields[key],
  );
  return { fields, complete };
}
