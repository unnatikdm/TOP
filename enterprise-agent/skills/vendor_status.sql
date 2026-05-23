SELECT
    'GitHub API' as name,
    'operational' as status,
    'Service running normally' as incident_title,
    NOW() as started_at,
    'https://www.githubstatus.com' as url
UNION ALL
SELECT
    'Coral API' as name,
    'operational' as status,
    'Service running normally' as incident_title,
    NOW() as started_at,
    'https://status.withcoral.com' as url