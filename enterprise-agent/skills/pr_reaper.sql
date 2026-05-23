SELECT
    pr.number,
    pr.title,
    pr.user__login as author,
    pr.created_at,
    pr.updated_at,
    pr.state,
    pr.html_url as url
FROM github.pulls pr
WHERE pr.owner = '{{ OWNER }}' AND pr.repo = '{{ REPO }}' AND pr.state = 'open'
ORDER BY pr.updated_at ASC
LIMIT 20;