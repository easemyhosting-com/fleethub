"""Only report scanner counts; never emit match strings, snippets or raw output."""
import json
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 3:
        return 2
    tool, name = sys.argv[1:]
    data = json.loads(Path(name).read_text())
    if tool == 'semgrep':
        count = len(data['results'])
        errors = len(data.get('errors', []))
        print(f'Semgrep: {count} findings; {errors} parser/scan errors. Review private output.')
    elif tool == 'trivy':
        count = sum(len(result.get('Secrets', [])) + len(result.get('Vulnerabilities', [])) + len(result.get('Misconfigurations', [])) for result in data.get('Results', []))
        print(f'Trivy: {count} findings. Raw output is retained only in temporary storage.')
    else:
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
