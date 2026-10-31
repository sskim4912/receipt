export const EAS_INSTALLER = {
  fileName: 'AuroraEAS-Setup.exe',
  path: '/downloads/AuroraEAS-Setup.exe?v=ad24daf9c2b5',
  fallback:
    'https://raw.githubusercontent.com/sskim4912/receipt/6efb50d0b2f3518d10a24574dd0070b877cd82e1/public/downloads/AuroraEAS-Setup.exe',
  size: 18291233,
  sha256: 'ad24daf9c2b50660aba8935f5f88b0eb13c2cbfaafc0320fe3677a2a5ac2f4bc',
};

export async function fetchEasInstaller(fetcher = fetch) {
  for (const url of [EAS_INSTALLER.path, EAS_INSTALLER.fallback]) {
    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== EAS_INSTALLER.size) continue;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
        '',
      );
      if (hex !== EAS_INSTALLER.sha256) continue;
      return new Blob([bytes], { type: 'application/octet-stream' });
    } catch {
      // A missing asset, HTML fallback, corrupt file or network failure can use
      // the pinned copy. Never download unverified bytes as an executable.
    }
  }
  throw new Error(
    '설치 파일을 받지 못했습니다. 잠시 후 다시 시도하거나 아래 도움말의 대체 다운로드를 이용해주세요.',
  );
}

export async function downloadEasInstaller() {
  const blob = await fetchEasInstaller();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = EAS_INSTALLER.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
