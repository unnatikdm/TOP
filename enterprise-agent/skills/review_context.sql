SELECT
    pr.number,
    pr.title,
    pr.user__login as author,
    pr.state,
    pr.created_at,
    pr.html_url as url
FROM github.pulls pr
WHERE pr.owner = '{{ OWNER }}' AND pr.repo = '{{ REPO }}' AND pr.state = 'closed'
ORDER BY pr.created_at DESC
LIMIT 20;