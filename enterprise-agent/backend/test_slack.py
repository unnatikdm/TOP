import urllib.parse, urllib.request, json, subprocess, re

res_slack = subprocess.run(['wsl', '-d', 'Ubuntu-24.04', '--', 'cat', '/root/.config/coral/workspaces/default/sources/slack/secrets.env'], capture_output=True, text=True, timeout=15)
match = re.search(r'SLACK_TOKEN=["\']?([^"\'\n\s]+)', res_slack.stdout)
token = match.group(1) if match else None
print('Token:', bool(token))

params = urllib.parse.urlencode({'query': 'Collate Product Demo Series', 'count': 5})
req = urllib.request.Request(f'https://slack.com/api/search.messages?{params}', headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(resp.read().decode('utf-8'))
except Exception as e:
    print('Error:', e)
