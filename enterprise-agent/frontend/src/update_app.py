import re

with open('App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# State definitions
content = content.replace("const [slackChannels, setSlackChannels]", "const [discordChannels, setDiscordChannels]")
content = content.replace("slack: localStorage.getItem('coral_slack_token') || ''", "discord: localStorage.getItem('coral_discord_token') || '',\n      discord_guild_id: localStorage.getItem('coral_discord_guild_id') || ''")

# Init connections fetch logic
old_fetch = """      const savedSlack = localStorage.getItem('coral_slack_token');
      if (savedSlack) {
        await fetch('http://127.0.0.1:8000/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'Slack', token: savedSlack })
        }).catch(() => { });
      }"""
new_fetch = """      const savedDiscord = localStorage.getItem('coral_discord_token');
      if (savedDiscord) {
        const savedDiscordGuildId = localStorage.getItem('coral_discord_guild_id');
        await fetch('http://127.0.0.1:8000/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'Discord', token: savedDiscord, discord_guild_id: savedDiscordGuildId })
        }).catch(() => { });
      }"""
content = content.replace(old_fetch, new_fetch)

# String replacements
content = content.replace(".n-slack", ".n-discord")
content = content.replace(".debug-source-title.slack", ".debug-source-title.discord")
content = content.replace("Sentry, Slack, GitHub", "Sentry, Discord, GitHub")
content = content.replace("Identified 3 Slack conversations", "Identified 3 Discord conversations")
content = content.replace("Jira, GitHub, Slack, and Sentry", "Jira, GitHub, Discord, and Sentry")
content = content.replace('node n-discord">Slack', 'node n-discord">Discord')
content = content.replace('catLower.includes(\'slack\')', 'catLower.includes(\'discord\')')
content = content.replace("'slack_mentions'", "'discord_mentions'")
content = content.replace("res.slack_mentions", "res.discord_mentions")
content = content.replace("Slack Mentions", "Discord Mentions")
content = content.replace("GitHub, Slack, etc.", "GitHub, Discord, etc.")
content = content.replace("Sentry exceptions, Slack messages", "Sentry exceptions, Discord messages")
content = content.replace("slack/jira link", "discord/jira link")
content = content.replace("Sentry issues, Slack channels", "Sentry issues, Discord channels")
content = content.replace("Slack Discussion", "Discord Discussion")
content = content.replace("includes('Slack')", "includes('Discord')")
content = content.replace("sectionClass = 'slack'", "sectionClass = 'discord'")
content = content.replace("'GitHub', 'Slack',", "'GitHub', 'Discord',")
content = content.replace("Slack Channels to Monitor", "Discord Channels to Monitor")
content = content.replace("value={slackChannels}", "value={discordChannels}")
content = content.replace("setSlackChannels", "setDiscordChannels")

# Setup connection mapping
old_map = """                        } else if (item === 'Sentry') {"""
new_map = """                        } else if (item === 'Discord') {
                          const guildIdVal = prompt("Enter Discord Guild (Server) ID:");
                          if (guildIdVal) {
                            handleConnect(item, tokenVal, { discord_guild_id: guildIdVal });
                          }
                        } else if (item === 'Sentry') {"""
content = content.replace(old_map, new_map)

with open('App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
