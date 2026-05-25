SELECT
    pr.number,
    pr.title,
    pr.user__login as author,
    pr.merged_at,
    pr.html_url as url
FROM github.pulls pr
WHERE pr.owner = '{{ OWNER }}' AND pr.repo = '{{ REPO }}' AND pr.merged_at IS NOT NULL
ORDER BY pr.merged_at DESC
LIMIT 20;