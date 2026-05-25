SELECT
    gr.name as repo_name,
    gr.stargazers_count as stars,
    gr.forks_count as forks,
    gr.open_issues_count as open_issues,
    gr.updated_at as last_updated,
    gr.html_url as url,
    'Safe' as safety_rating
FROM github.repos gr
WHERE gr.owner = '{{ OWNER }}' AND gr.name = '{{ REPO }}' AND gr.team_id = 0
ORDER BY gr.stargazers_count DESC
LIMIT 1;