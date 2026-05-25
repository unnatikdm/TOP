SELECT
    gi.title,
    gi.state,
    gi.created_at,
    gi.html_url as url
FROM github.issues gi
WHERE gi.owner = '{{ OWNER }}' AND gi.repo = '{{ REPO }}'
ORDER BY gi.created_at DESC
LIMIT 20;