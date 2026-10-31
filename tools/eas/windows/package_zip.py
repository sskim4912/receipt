"""Wrap an approved installer in a regular, unencrypted download ZIP."""
import argparse
import hashlib
from pathlib import Path
import zipfile

README = '''Aurora EAS 간편 설치 안내

1. AuroraEAS-Setup.zip 파일을 다운로드합니다.
2. ZIP을 마우스 오른쪽으로 누르고 '모두 압축 풀기'를 선택합니다.
3. 압축을 푼 폴더에서 AuroraEAS-Setup.exe를 실행합니다.
4. 설치 후 영수증관리 시스템의 'EAS 보조 프로그램으로 연결'을 누릅니다.

Python과 Selenium을 따로 설치할 필요는 없습니다.
Windows 10/11 64비트와 Microsoft Edge가 필요합니다.
최초 연결 시 EdgeDriver 자동 준비를 위해 인터넷 접속이 필요합니다.
최초 로그인 및 세션 만료 시 회사 인증은 직접 진행합니다.

이 설치기는 미서명 초기 검증 버전입니다.
회사 보안 정책으로 실행이 차단되면 IT 담당자에게 확인해주세요.
압축은 파일 전달 방식일 뿐이며 회사 보안 정책을 해제하거나 우회하지 않습니다.
'''


def package(installer, destination, expected_sha256):
    installer, destination = Path(installer), Path(destination)
    data = installer.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha256 or not data.startswith(b'MZ'):
        raise ValueError('The installer does not match the approved executable.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    files = {
        'AuroraEAS-Setup.exe': data,
        '설치안내.txt': README.encode('utf-8-sig'),
        'SHA256SUMS.txt': (digest + '  AuroraEAS-Setup.exe\r\n').encode('ascii'),
    }
    with zipfile.ZipFile(destination, 'w') as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 31, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert archive.read('AuroraEAS-Setup.exe') == data
    return hashlib.sha256(destination.read_bytes()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installer', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    print(package(args.installer, args.output, args.sha256))
