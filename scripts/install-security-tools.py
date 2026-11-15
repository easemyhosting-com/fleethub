"""Install the verified pinned gitleaks release into a caller-selected tool directory."""
import hashlib
import io
from pathlib import Path
import sys
import tarfile
import subprocess

VERSION = '8.30.1'
SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
URL = f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_linux_x64.tar.gz'


def main():
    if len(sys.argv) != 2:
        return 2
    destination = Path(sys.argv[1])
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '60', '--max-filesize', '31457280', '--proto', '=https', '--proto-redir', '=https', URL], check=True, capture_output=True)
    data = result.stdout
    if len(data) > 30 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError('Pinned tool checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        member = archive.getmember('gitleaks')
        if not member.isfile() or member.size > 100 * 1024 * 1024:
            raise ValueError('Invalid tool archive member')
        binary = archive.extractfile(member)
        if binary is None:
            raise ValueError('Missing tool binary')
        destination.mkdir(parents=True, exist_ok=True)
        output = destination / 'gitleaks'
        if output.is_symlink():
            raise ValueError('Refusing tool symlink')
        output.write_bytes(binary.read())
        output.chmod(0o755)
    print('Installed checksum-verified gitleaks 8.30.1')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
